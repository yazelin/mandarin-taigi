#!/usr/bin/env python3
"""Build a small, browser-friendly dictionary from MOE ``kautian.ods``.

Only the ``詞目``, ``義項`` and ``例句`` worksheets are read.  The workbook's
text is copied as-is; the builder merely joins rows by their numeric IDs and
nests senses and examples below each entry.

This module deliberately uses only Python's standard library.  ``content.xml``
is parsed directly from the ODS zip with :func:`xml.etree.ElementTree.iterparse`
so the complete XML document is never loaded into memory at once.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from collections.abc import Iterable
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree as ET


NAMESPACES = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
}


def _q(namespace: str, local_name: str) -> str:
    return f"{{{NAMESPACES[namespace]}}}{local_name}"


TABLE = _q("table", "table")
TABLE_ROW = _q("table", "table-row")
TABLE_CELL = _q("table", "table-cell")
COVERED_TABLE_CELL = _q("table", "covered-table-cell")
TEXT_PARAGRAPH = _q("text", "p")
TEXT_SPACE = _q("text", "s")
TEXT_TAB = _q("text", "tab")
TEXT_LINE_BREAK = _q("text", "line-break")

TARGET_COLUMNS = {
    "詞目": (
        "詞目id",
        "詞目類型",
        "漢字",
        "羅馬字",
        "分類",
        "羅馬字音檔檔名",
    ),
    "義項": ("詞目id", "義項id", "詞性", "解說"),
    "例句": (
        "詞目id",
        "義項id",
        "例句順序",
        "漢字",
        "羅馬字",
        "華語",
        "音檔檔名",
    ),
    "詞彙比較": ("華語詞目id", "華語詞目", "腔", "漢字", "羅馬字"),
}

FULL_DICTIONARY_SHEETS = ("詞目", "義項", "例句")
COMPARISON_SHEETS = ("詞目", "義項", "詞彙比較")
COMMON_ENTRY_TYPE = "臺華共同詞"
MAIN_ENTRY_TYPE = "主詞目"

# 依官方釋義推導對照：義項「解說」的第一句必須是 1–6 個漢字的乾淨華語詞，
# 才視為該主詞目的華語對應詞。句子、標點、非漢字一律不收，不做任何模糊猜測。
SENSE_GLOSS_PATTERN = re.compile(r"^[一-鿿]{1,6}$")
# ponytail: 純子字串黑名單擋語法功能描述；出現新的壞 gloss 再加詞即可
SENSE_GLOSS_BLOCKLIST = ("後綴", "前綴", "詞綴", "助詞", "語氣詞")

SOURCE_NAME = "教育部《臺灣台語常用詞辭典》"
SOURCE_URL = "https://sutian.moe.edu.tw/zh-hant/siongkuantsuguan/"


class DictionaryBuildError(ValueError):
    """Raised when the source workbook cannot form a valid dictionary."""


def _positive_repeat(element: ET.Element, attribute: str) -> int:
    raw_value = element.attrib.get(attribute, "1")
    try:
        repeat = int(raw_value)
    except ValueError as error:
        raise DictionaryBuildError(f"Invalid ODS repeat count: {raw_value!r}") from error
    if repeat < 1:
        raise DictionaryBuildError(f"ODS repeat count must be positive: {raw_value!r}")
    return repeat


def _element_text(element: ET.Element) -> str:
    """Return ODF text while retaining encoded spaces, tabs and line breaks."""

    pieces = [element.text or ""]
    for child in element:
        if child.tag == TEXT_SPACE:
            pieces.append(" " * _positive_repeat(child, _q("text", "c")))
        elif child.tag == TEXT_TAB:
            pieces.append("\t")
        elif child.tag == TEXT_LINE_BREAK:
            pieces.append("\n")
        else:
            pieces.append(_element_text(child))
        pieces.append(child.tail or "")
    return "".join(pieces)


def cell_value(cell: ET.Element) -> str:
    """Extract an ODS cell's displayed text or its typed ``office:*`` value.

    Text paragraphs take precedence because they retain the workbook's visible
    spelling and formatting.  Numeric cells frequently omit text nodes, so the
    corresponding ``office:value`` is used as a lossless fallback.
    """

    paragraphs = cell.findall(f".//{TEXT_PARAGRAPH}")
    if paragraphs:
        return "\n".join(_element_text(paragraph) for paragraph in paragraphs)

    value_type = cell.attrib.get(_q("office", "value-type"), "")
    typed_attributes = {
        "float": _q("office", "value"),
        "percentage": _q("office", "value"),
        "currency": _q("office", "value"),
        "date": _q("office", "date-value"),
        "time": _q("office", "time-value"),
        "boolean": _q("office", "boolean-value"),
        "string": _q("office", "string-value"),
    }
    attribute = typed_attributes.get(value_type)
    return cell.attrib.get(attribute, "") if attribute else ""


def row_values(row: ET.Element, max_columns: int | None = None) -> list[str]:
    """Expand repeated ODS cells without expanding trailing blank columns."""

    runs: list[tuple[str, int]] = []
    remaining = max_columns
    for cell in row:
        if cell.tag not in {TABLE_CELL, COVERED_TABLE_CELL}:
            continue

        repeat = _positive_repeat(cell, _q("table", "number-columns-repeated"))
        if remaining is not None:
            repeat = min(repeat, remaining)
        if repeat <= 0:
            break

        runs.append((cell_value(cell), repeat))
        if remaining is not None:
            remaining -= repeat
            if remaining <= 0:
                break

    if max_columns is None:
        while runs and not runs[-1][0]:
            runs.pop()

    values: list[str] = []
    for value, repeat in runs:
        values.extend([value] * repeat)
    return values


def _read_target_tables(
    ods_path: Path,
    target_sheets: Iterable[str],
) -> tuple[dict[str, list[dict[str, str]]], dict[str, tuple[str, ...]]]:
    """Stream target worksheet rows from an ODS archive."""

    selected_sheets = tuple(target_sheets)
    tables: dict[str, list[dict[str, str]]] = {name: [] for name in selected_sheets}
    headers: dict[str, tuple[str, ...]] = {}

    try:
        archive = zipfile.ZipFile(ods_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise DictionaryBuildError(f"Cannot open ODS file {ods_path}: {error}") from error

    with archive:
        try:
            content_xml = archive.open("content.xml")
        except KeyError as error:
            raise DictionaryBuildError("ODS archive does not contain content.xml") from error

        with content_xml:
            current_sheet = ""
            current_header: tuple[str, ...] | None = None
            stack: list[ET.Element] = []

            try:
                events = ET.iterparse(content_xml, events=("start", "end"))
                for event, element in events:
                    if event == "start":
                        stack.append(element)
                        if element.tag == TABLE:
                            current_sheet = element.attrib.get(_q("table", "name"), "")
                            current_header = None
                        continue

                    parent = stack[-2] if len(stack) > 1 else None

                    if element.tag == TABLE_ROW:
                        if current_sheet in tables:
                            limit = len(current_header) if current_header else None
                            values = row_values(element, max_columns=limit)
                            row_repeat = _positive_repeat(
                                element, _q("table", "number-rows-repeated")
                            )

                            if current_header is None:
                                if any(values):
                                    if values:
                                        values[0] = values[0].removeprefix("\ufeff")
                                    current_header = tuple(values)
                                    headers[current_sheet] = current_header
                            elif any(values):
                                padded = values + [""] * (len(current_header) - len(values))
                                record = {
                                    name: padded[index]
                                    for index, name in enumerate(current_header)
                                    if name
                                }
                                for _ in range(row_repeat):
                                    tables[current_sheet].append(record.copy())

                        # Removing processed rows from their parent is what keeps
                        # iterparse memory bounded, including for ignored sheets.
                        if parent is not None:
                            parent.remove(element)
                        element.clear()

                    elif element.tag == TABLE:
                        current_sheet = ""
                        current_header = None
                        element.clear()

                    stack.pop()
            except ET.ParseError as error:
                raise DictionaryBuildError(f"Invalid ODS content.xml: {error}") from error

    return tables, headers


def _validate_headers(
    headers: dict[str, tuple[str, ...]], required_sheets: Iterable[str]
) -> None:
    for sheet in required_sheets:
        required_columns = TARGET_COLUMNS[sheet]
        header = headers.get(sheet)
        if header is None:
            raise DictionaryBuildError(f"Missing required worksheet: {sheet}")
        missing = [column for column in required_columns if column not in header]
        if missing:
            raise DictionaryBuildError(
                f"Worksheet {sheet} is missing required columns: {', '.join(missing)}"
            )


def _id_key(value: str) -> str:
    """Normalize numeric IDs for joins without changing the emitted source text."""

    stripped = value.strip()
    if not stripped:
        return ""
    try:
        number = Decimal(stripped)
    except InvalidOperation:
        return stripped
    if number == number.to_integral_value():
        return format(number.quantize(Decimal(1)), "f")
    return format(number.normalize(), "f")


def _required_id(row: dict[str, str], column: str, sheet: str) -> tuple[str, str]:
    original = row.get(column, "")
    key = _id_key(original)
    if not key:
        raise DictionaryBuildError(f"Worksheet {sheet} contains an empty {column}")
    return original, key


def _add_source_updated(metadata: dict[str, Any], source_updated: str | None) -> None:
    if source_updated is None:
        return
    try:
        parsed = date.fromisoformat(source_updated)
    except ValueError as error:
        raise DictionaryBuildError(
            f"source_updated must use YYYY-MM-DD: {source_updated!r}"
        ) from error
    if parsed.isoformat() != source_updated:
        raise DictionaryBuildError(
            f"source_updated must use YYYY-MM-DD: {source_updated!r}"
        )
    metadata["source_updated"] = source_updated


def build_full_document(
    ods_path: str | os.PathLike[str], *, source_updated: str | None = None
) -> dict[str, Any]:
    """Return the full 詞目/義項/例句 document for secondary consumers."""

    source_path = Path(ods_path)
    tables, headers = _read_target_tables(source_path, FULL_DICTIONARY_SHEETS)
    _validate_headers(headers, FULL_DICTIONARY_SHEETS)

    entries: list[dict[str, Any]] = []
    entries_by_id: dict[str, dict[str, Any]] = {}
    senses_by_id: dict[tuple[str, str], dict[str, Any]] = {}

    for row in tables["詞目"]:
        original_id, entry_key = _required_id(row, "詞目id", "詞目")
        if entry_key in entries_by_id:
            raise DictionaryBuildError(f"Duplicate 詞目id: {original_id}")
        entry: dict[str, Any] = {
            "id": original_id,
            "hanji": row.get("漢字", ""),
            "romanization": row.get("羅馬字", ""),
            "type": row.get("詞目類型", ""),
            "category": row.get("分類", ""),
            "audio": row.get("羅馬字音檔檔名", ""),
            "senses": [],
        }
        entries.append(entry)
        entries_by_id[entry_key] = entry

    sense_count = 0
    for row in tables["義項"]:
        original_entry_id, entry_key = _required_id(row, "詞目id", "義項")
        original_sense_id, sense_key = _required_id(row, "義項id", "義項")
        entry = entries_by_id.get(entry_key)
        if entry is None:
            raise DictionaryBuildError(
                f"義項 {original_sense_id} references missing 詞目id {original_entry_id}"
            )

        joined_key = (entry_key, sense_key)
        if joined_key in senses_by_id:
            raise DictionaryBuildError(
                f"Duplicate 義項id {original_sense_id} for 詞目id {original_entry_id}"
            )
        sense: dict[str, Any] = {
            "id": original_sense_id,
            "part_of_speech": row.get("詞性", ""),
            "definition": row.get("解說", ""),
            "examples": [],
        }
        entry["senses"].append(sense)
        senses_by_id[joined_key] = sense
        sense_count += 1

    example_count = 0
    for row in tables["例句"]:
        original_entry_id, entry_key = _required_id(row, "詞目id", "例句")
        original_sense_id, sense_key = _required_id(row, "義項id", "例句")
        sense = senses_by_id.get((entry_key, sense_key))
        if sense is None:
            raise DictionaryBuildError(
                "例句 references missing 義項id "
                f"{original_sense_id} for 詞目id {original_entry_id}"
            )
        sense["examples"].append(
            {
                "order": row.get("例句順序", ""),
                "hanji": row.get("漢字", ""),
                "romanization": row.get("羅馬字", ""),
                "mandarin": row.get("華語", ""),
                "audio": row.get("音檔檔名", ""),
            }
        )
        example_count += 1

    metadata = {
        "schema_version": 1,
        "source": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "entry_count": len(entries),
        "sense_count": sense_count,
        "example_count": example_count,
    }
    _add_source_updated(metadata, source_updated)
    return {"metadata": metadata, "entries": entries}


def _build_comparison_data(
    ods_path: str | os.PathLike[str],
    *,
    source_updated: str | None = None,
) -> tuple[dict[str, Any], list[tuple[dict[str, Any], str, str]]]:
    """Build exact 華語-to-臺語 comparisons and retain matched audio stems."""

    source_path = Path(ods_path)
    tables, headers = _read_target_tables(source_path, COMPARISON_SHEETS)
    _validate_headers(headers, COMPARISON_SHEETS)

    entry_candidates: dict[tuple[str, str], list[dict[str, str]]] = {}
    common_entries: list[dict[str, Any]] = []
    common_ids: set[str] = set()
    common_hanji: set[str] = set()
    matched_audio: list[tuple[dict[str, Any], str, str]] = []
    main_entries: dict[str, dict[str, str]] = {}
    for row in tables["詞目"]:
        exact_key = (row.get("漢字", ""), row.get("羅馬字", ""))
        if all(exact_key):
            entry_candidates.setdefault(exact_key, []).append(row)

        if row.get("詞目類型") == MAIN_ENTRY_TYPE:
            _, entry_key = _required_id(row, "詞目id", "詞目")
            main_entries.setdefault(entry_key, row)

        if row.get("詞目類型") != COMMON_ENTRY_TYPE:
            continue

        original_id, entry_key = _required_id(row, "詞目id", "詞目")
        hanji, romanization = exact_key
        if not hanji or not romanization:
            raise DictionaryBuildError(
                f"{COMMON_ENTRY_TYPE} {original_id} must have 漢字 and 羅馬字"
            )
        if entry_key in common_ids:
            raise DictionaryBuildError(f"Duplicate {COMMON_ENTRY_TYPE} 詞目id: {original_id}")
        if hanji in common_hanji:
            raise DictionaryBuildError(f"Duplicate {COMMON_ENTRY_TYPE} 漢字: {hanji}")

        common_ids.add(entry_key)
        common_hanji.add(hanji)
        common_entry: dict[str, Any] = {
            "kind": "common",
            "id": original_id,
            "hanji": hanji,
            "romanization": romanization,
            "type": COMMON_ENTRY_TYPE,
            "category": row.get("分類", ""),
        }
        common_entries.append(common_entry)
        audio_stem = row.get("羅馬字音檔檔名", "")
        if audio_stem:
            matched_audio.append((common_entry, audio_stem, "common"))

    # A comparison may receive a term ID only when the exact source spelling
    # and exact romanization resolve to one 詞目.  Ambiguous exact matches are
    # intentionally left unlinked; there is no fuzzy or normalized fallback.
    exact_entries: dict[tuple[str, str], tuple[str, str]] = {}
    for exact_key, candidates in entry_candidates.items():
        candidate_ids: dict[str, str] = {}
        for candidate in candidates:
            original_id, entry_key = _required_id(candidate, "詞目id", "詞目")
            candidate_ids.setdefault(entry_key, original_id)
        if len(candidate_ids) != 1:
            continue

        entry_key, original_id = next(iter(candidate_ids.items()))
        audio_stems = {
            candidate.get("羅馬字音檔檔名", "")
            for candidate in candidates
            if _id_key(candidate.get("詞目id", "")) == entry_key
            and candidate.get("羅馬字音檔檔名", "")
        }
        audio_stem = next(iter(audio_stems)) if len(audio_stems) == 1 else ""
        exact_entries[exact_key] = (original_id, audio_stem)

    terms: list[dict[str, Any]] = []
    terms_by_id: dict[str, dict[str, Any]] = {}
    exact_match_count = 0

    for row in tables["詞彙比較"]:
        original_id, term_key = _required_id(row, "華語詞目id", "詞彙比較")
        mandarin = row.get("華語詞目", "")
        term = terms_by_id.get(term_key)
        if term is None:
            term = {
                "kind": "comparison",
                "id": original_id,
                "mandarin": mandarin,
                "comparisons": [],
            }
            terms.append(term)
            terms_by_id[term_key] = term
        elif term["mandarin"] != mandarin:
            raise DictionaryBuildError(
                f"華語詞目id {original_id} has inconsistent source text: "
                f"{term['mandarin']!r} and {mandarin!r}"
            )

        comparison: dict[str, Any] = {
            "accent": row.get("腔", ""),
            "hanji": row.get("漢字", ""),
            "romanization": row.get("羅馬字", ""),
        }
        exact_entry = exact_entries.get(
            (comparison["hanji"], comparison["romanization"])
        )
        if exact_entry is not None:
            term_id, audio_stem = exact_entry
            comparison["term_id"] = term_id
            exact_match_count += 1
            if audio_stem:
                matched_audio.append((comparison, audio_stem, "comparison"))

        term["comparisons"].append(comparison)

    # 依官方釋義推導的對照：釋義第一句是乾淨華語短詞的主詞目，補進官方
    # 詞彙比較表沒收的華語詞（例：長頸鹿 → 長頷鹿、麒麟鹿）。腔口資訊
    # 源頭沒有，一律留空；音檔直接用主詞目官方錄音。
    comparison_mandarin = {term["mandarin"] for term in terms}
    sense_terms_by_gloss: dict[str, dict[str, Any]] = {}
    sense_entry_keys: dict[str, set[str]] = {}
    for row in tables["義項"]:
        _, entry_key = _required_id(row, "詞目id", "義項")
        entry_row = main_entries.get(entry_key)
        if entry_row is None:
            continue
        gloss = row.get("解說", "").split("。", 1)[0].strip()
        if not SENSE_GLOSS_PATTERN.fullmatch(gloss):
            continue
        if any(blocked in gloss for blocked in SENSE_GLOSS_BLOCKLIST):
            continue
        if gloss in comparison_mandarin or gloss in common_hanji:
            continue
        hanji = entry_row.get("漢字", "")
        romanization = entry_row.get("羅馬字", "")
        if not hanji or not romanization or gloss == hanji:
            continue
        term = sense_terms_by_gloss.get(gloss)
        if term is None:
            term = {
                "kind": "sense",
                "id": f"sense:{gloss}",
                "mandarin": gloss,
                "comparisons": [],
            }
            sense_terms_by_gloss[gloss] = term
            sense_entry_keys[gloss] = set()
        if entry_key in sense_entry_keys[gloss]:
            continue
        sense_entry_keys[gloss].add(entry_key)
        comparison = {
            "accent": "",
            "hanji": hanji,
            "romanization": romanization,
            "term_id": entry_row.get("詞目id", ""),
        }
        term["comparisons"].append(comparison)
        audio_stem = entry_row.get("羅馬字音檔檔名", "")
        if audio_stem:
            matched_audio.append((comparison, audio_stem, "comparison"))
    terms.extend(sense_terms_by_gloss.values())

    comparison_count = sum(len(term["comparisons"]) for term in terms)
    metadata = {
        "schema_version": 2,
        "source": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "term_count": len(terms),
        "sense_term_count": len(sense_terms_by_gloss),
        "common_entry_count": len(common_entries),
        "searchable_headword_count": len(
            {term["mandarin"] for term in terms}
            | {entry["hanji"] for entry in common_entries}
        ),
        "comparison_count": comparison_count,
        "exact_match_count": exact_match_count,
        "audio_file_count": 0,
        "audio_pack_bytes": 0,
        "audio_comparison_count": 0,
        "comparison_audio_file_count": 0,
        "common_audio_file_count": 0,
        "common_audio_entry_count": 0,
    }
    _add_source_updated(metadata, source_updated)
    document = {
        "metadata": metadata,
        "terms": terms,
        "common_entries": common_entries,
    }
    return document, matched_audio


def build_document(
    ods_path: str | os.PathLike[str], *, source_updated: str | None = None
) -> dict[str, Any]:
    """Return the primary 華語-to-臺語 comparison document."""

    document, _ = _build_comparison_data(ods_path, source_updated=source_updated)
    return document


def _safe_audio_filename(audio_stem: str) -> str:
    filename = f"{audio_stem}.mp3"
    path = PurePosixPath(filename)
    if (
        not audio_stem
        or "\\" in filename
        or path.is_absolute()
        or len(path.parts) != 1
        or path.name in {".", ".."}
        or ":" in path.name
    ):
        raise DictionaryBuildError(f"Unsafe audio filename in source data: {filename!r}")
    return filename


def _validate_zip_member(info: zipfile.ZipInfo) -> PurePosixPath:
    name = info.filename
    path = PurePosixPath(name)
    if (
        "\\" in name
        or path.is_absolute()
        or ".." in path.parts
        or (path.parts and ":" in path.parts[0])
    ):
        raise DictionaryBuildError(f"Unsafe path in audio zip: {name!r}")
    return path


def _attach_audio(
    document: dict[str, Any],
    matched_audio: list[tuple[dict[str, Any], str, str]],
    audio_zip: Path,
    audio_output: Path,
    json_output: Path,
) -> None:
    """Copy only exact-match MP3 bytes and add paths relative to the JSON file."""

    records_by_filename: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for record, audio_stem, kind in matched_audio:
        filename = _safe_audio_filename(audio_stem)
        records_by_filename.setdefault(filename, []).append((record, kind))

    try:
        archive = zipfile.ZipFile(audio_zip)
    except (OSError, zipfile.BadZipFile) as error:
        raise DictionaryBuildError(f"Cannot open audio zip {audio_zip}: {error}") from error

    audio_output.mkdir(parents=True, exist_ok=True)
    output_root = audio_output.resolve()
    archive_members: dict[str, list[zipfile.ZipInfo]] = {}

    with archive:
        for info in archive.infolist():
            path = _validate_zip_member(info)
            if info.is_dir() or path.name not in records_by_filename:
                continue
            archive_members.setdefault(path.name, []).append(info)

        extracted_files = 0
        extracted_bytes = 0
        linked_records = {"comparison": 0, "common": 0}
        filenames_by_kind = {"comparison": set(), "common": set()}
        for filename, records in records_by_filename.items():
            members = archive_members.get(filename, [])
            if not members:
                continue
            if len(members) != 1:
                raise DictionaryBuildError(
                    f"Audio zip contains duplicate basename for {filename!r}"
                )

            destination = audio_output / filename
            if destination.resolve(strict=False).parent != output_root:
                raise DictionaryBuildError(f"Unsafe audio destination: {destination}")

            temporary_name: str | None = None
            try:
                with archive.open(members[0]) as source, tempfile.NamedTemporaryFile(
                    "wb",
                    dir=audio_output,
                    prefix=f".{filename}.",
                    suffix=".tmp",
                    delete=False,
                ) as temporary:
                    shutil.copyfileobj(source, temporary)
                    temporary_name = temporary.name
                os.replace(temporary_name, destination)
            finally:
                if temporary_name:
                    try:
                        os.unlink(temporary_name)
                    except FileNotFoundError:
                        pass

            relative_path = Path(
                os.path.relpath(destination, start=json_output.parent)
            ).as_posix()
            for record, kind in records:
                record["audio"] = relative_path
                linked_records[kind] += 1
                filenames_by_kind[kind].add(filename)
            extracted_files += 1
            extracted_bytes += members[0].file_size

    document["metadata"]["audio_file_count"] = extracted_files
    document["metadata"]["audio_pack_bytes"] = extracted_bytes
    document["metadata"]["audio_comparison_count"] = linked_records["comparison"]
    document["metadata"]["comparison_audio_file_count"] = len(
        filenames_by_kind["comparison"]
    )
    document["metadata"]["common_audio_file_count"] = len(
        filenames_by_kind["common"]
    )
    document["metadata"]["common_audio_entry_count"] = linked_records["common"]


def _write_json(document: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"))

    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(payload)
            temporary_name = temporary.name
        os.replace(temporary_name, destination)
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
    return None


def write_dictionary(
    ods_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str],
    *,
    mode: str = "comparison",
    audio_zip: str | os.PathLike[str] | None = None,
    audio_output: str | os.PathLike[str] | None = None,
    source_updated: str | None = None,
) -> dict[str, Any]:
    """Build and atomically write minified, unescaped UTF-8 JSON.

    ``audio_zip`` and ``audio_output`` must either both be supplied or both be
    omitted.  Audio is available only for the primary ``comparison`` mode.
    """

    if (audio_zip is None) != (audio_output is None):
        raise DictionaryBuildError(
            "--audio-zip and --audio-output must be supplied together"
        )
    if mode not in {"comparison", "full"}:
        raise DictionaryBuildError(f"Unsupported build mode: {mode}")
    if mode == "full" and audio_zip is not None:
        raise DictionaryBuildError(
            "Audio extraction is only supported in comparison mode"
        )

    destination = Path(output_path)
    if mode == "full":
        document = build_full_document(ods_path, source_updated=source_updated)
    else:
        document, matched_audio = _build_comparison_data(
            ods_path, source_updated=source_updated
        )
        if audio_zip is not None and audio_output is not None:
            _attach_audio(
                document,
                matched_audio,
                Path(audio_zip),
                Path(audio_output),
                destination,
            )

    _write_json(document, destination)
    return document


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert MOE kautian.ods into minified UTF-8 JSON"
    )
    parser.add_argument("input", type=Path, help="Path to the local kautian.ods")
    parser.add_argument("output", type=Path, help="Destination JSON path")
    parser.add_argument(
        "--mode",
        choices=("comparison", "full"),
        default="comparison",
        help="comparison (default) or full 詞目/義項/例句 output",
    )
    parser.add_argument(
        "--audio-zip",
        type=Path,
        help="Optional local sutiau MP3 zip (requires --audio-output)",
    )
    parser.add_argument(
        "--audio-output",
        type=Path,
        help="Directory for exact-match MP3 files (requires --audio-zip)",
    )
    parser.add_argument(
        "--source-updated",
        metavar="YYYY-MM-DD",
        help="Optional source data update date stored in metadata",
    )
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        document = write_dictionary(
            args.input,
            args.output,
            mode=args.mode,
            audio_zip=args.audio_zip,
            audio_output=args.audio_output,
            source_updated=args.source_updated,
        )
    except (DictionaryBuildError, OSError) as error:
        print(f"build_dictionary: {error}", file=sys.stderr)
        return 1

    metadata = document["metadata"]
    if args.mode == "comparison":
        print(
            "Built "
            f"{metadata['term_count']} Mandarin terms and "
            f"{metadata['common_entry_count']} common headwords with "
            f"{metadata['comparison_count']} Taiwanese comparisons "
            f"({metadata['exact_match_count']} exact dictionary matches, "
            f"{metadata['audio_file_count']} MP3 files) -> {args.output}"
        )
    else:
        print(
            "Built "
            f"{metadata['entry_count']} entries, "
            f"{metadata['sense_count']} senses and "
            f"{metadata['example_count']} examples -> {args.output}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
