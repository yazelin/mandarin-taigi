#!/usr/bin/env python3
"""Extract exact MOE Mandarin single-character audio used by this dictionary.

The official Concised Mandarin Dictionary distributes the recordings as WAV in
one large ZIP.  This builder copies only the primary pronunciation for exact
single-character headwords already present in ``data/dictionary.json``.  Audio
bytes are never transcoded or edited.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO
from xml.etree import ElementTree as ET


SOURCE_NAME = "中華民國教育部《國語辭典簡編本》"
SOURCE_URL = (
    "https://language.moe.gov.tw/001/Upload/Files/site_content/"
    "M0001/respub/dict_concised_download.html"
)
XLSX_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
XLSX_TAG = lambda name: f"{{{XLSX_NAMESPACE}}}{name}"


class MandarinAudioBuildError(ValueError):
    """Raised when official source files cannot form a safe exact mapping."""


def _column_index(reference: str) -> int:
    match = re.match(r"([A-Z]+)", reference)
    if not match:
        raise MandarinAudioBuildError(f"Invalid XLSX cell reference: {reference!r}")
    value = 0
    for character in match.group(1):
        value = value * 26 + ord(character) - ord("A") + 1
    return value - 1


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        source = archive.open("xl/sharedStrings.xml")
    except KeyError:
        return []
    values: list[str] = []
    with source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag != XLSX_TAG("si"):
                continue
            values.append("".join(node.text or "" for node in element.iter(XLSX_TAG("t"))))
            element.clear()
    return values


def read_xlsx_rows(source: Path | BinaryIO) -> list[dict[str, str]]:
    """Read the first worksheet from an official XLSX using only stdlib."""

    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as error:
        raise MandarinAudioBuildError(f"Cannot open XLSX: {error}") from error

    with archive:
        strings = _shared_strings(archive)
        try:
            worksheet = archive.open("xl/worksheets/sheet1.xml")
        except KeyError as error:
            raise MandarinAudioBuildError("XLSX does not contain sheet1.xml") from error

        raw_rows: list[list[str]] = []
        with worksheet:
            for _, row in ET.iterparse(worksheet, events=("end",)):
                if row.tag != XLSX_TAG("row"):
                    continue
                values: list[str] = []
                for cell in row.findall(XLSX_TAG("c")):
                    index = _column_index(cell.attrib.get("r", ""))
                    while len(values) <= index:
                        values.append("")
                    value_node = cell.find(XLSX_TAG("v"))
                    raw_value = value_node.text if value_node is not None else ""
                    if cell.attrib.get("t") == "s" and raw_value:
                        try:
                            raw_value = strings[int(raw_value)]
                        except (IndexError, ValueError) as error:
                            raise MandarinAudioBuildError("Invalid XLSX shared string index") from error
                    values[index] = raw_value or ""
                if any(values):
                    raw_rows.append(values)
                row.clear()

    if not raw_rows:
        raise MandarinAudioBuildError("XLSX worksheet is empty")
    headers = [value.removeprefix("\ufeff") for value in raw_rows[0]]
    return [
        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}
        for row in raw_rows[1:]
    ]


def _normalized_id(value: str) -> str:
    stripped = value.strip().upper()
    match = re.fullmatch(r"0*(\d+)([A-Z]*)", stripped)
    return f"{int(match.group(1))}{match.group(2)}" if match else stripped


def _pronunciation_order(value: str) -> int:
    try:
        return int(float(value.strip()))
    except ValueError:
        return 999


def select_primary_entries(
    terms: set[str],
    dictionary_rows: list[dict[str, str]],
    audio_rows: list[dict[str, str]],
) -> dict[str, dict[str, str]]:
    """Select the official primary reading for exact available headwords."""

    audio_by_id: dict[str, dict[str, str]] = {}
    for row in audio_rows:
        word_id = _normalized_id(row.get("字詞號", ""))
        filename = row.get("檔案名稱", "").strip()
        if not word_id or not filename:
            continue
        if word_id in audio_by_id:
            raise MandarinAudioBuildError(f"Duplicate audio mapping for 字詞號 {word_id}")
        audio_by_id[word_id] = row

    candidates: dict[str, list[tuple[int, dict[str, str], dict[str, str]]]] = {}
    for row in dictionary_rows:
        word = row.get("字詞名", "")
        if word not in terms:
            continue
        word_id = _normalized_id(row.get("字詞號", ""))
        audio_row = audio_by_id.get(word_id)
        if audio_row is None or audio_row.get("字詞名", "") != word:
            continue
        candidates.setdefault(word, []).append(
            (_pronunciation_order(row.get("多音排序", "")), row, audio_row)
        )

    selected: dict[str, dict[str, str]] = {}
    for word, choices in candidates.items():
        choices.sort(key=lambda item: (item[0], _normalized_id(item[1].get("字詞號", ""))))
        order, dictionary_row, audio_row = choices[0]
        if len(choices) > 1 and order != 1:
            continue
        selected[word] = {
            "id": dictionary_row.get("字詞號", ""),
            "bopomofo": dictionary_row.get("注音一式", "").strip(),
            "pinyin": dictionary_row.get("漢語拼音", "").strip(),
            "filename": audio_row.get("檔案名稱", "").strip(),
        }
    return selected


def _safe_member(info: zipfile.ZipInfo) -> PurePosixPath:
    path = PurePosixPath(info.filename)
    if (
        "\\" in info.filename
        or path.is_absolute()
        or ".." in path.parts
        or (path.parts and ":" in path.parts[0])
    ):
        raise MandarinAudioBuildError(f"Unsafe path in audio ZIP: {info.filename!r}")
    return path


def _write_json(document: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=destination.parent, prefix=f".{destination.name}.", delete=False
    ) as temporary:
        temporary.write(payload)
        temporary_name = temporary.name
    os.replace(temporary_name, destination)


def build_mandarin_audio(
    dictionary_path: Path,
    concise_xlsx: Path,
    audio_zip_path: Path,
    manifest_path: Path,
    audio_output: Path,
    *,
    source_version: str,
) -> dict[str, Any]:
    dictionary = json.loads(dictionary_path.read_text(encoding="utf-8"))
    terms = {term.get("mandarin", "") for term in dictionary.get("terms", [])}
    dictionary_rows = read_xlsx_rows(concise_xlsx)

    try:
        audio_archive = zipfile.ZipFile(audio_zip_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise MandarinAudioBuildError(f"Cannot open official audio ZIP: {error}") from error

    with audio_archive:
        xlsx_members = [
            info
            for info in audio_archive.infolist()
            if PurePosixPath(info.filename).name.startswith("dict_concised_word_")
            and info.filename.endswith(".xlsx")
        ]
        if len(xlsx_members) != 1:
            raise MandarinAudioBuildError("Official audio ZIP must contain one word mapping XLSX")
        audio_rows = read_xlsx_rows(io.BytesIO(audio_archive.read(xlsx_members[0])))
        selected = select_primary_entries(terms, dictionary_rows, audio_rows)

        members_by_name: dict[str, list[zipfile.ZipInfo]] = {}
        for info in audio_archive.infolist():
            path = _safe_member(info)
            if not info.is_dir():
                members_by_name.setdefault(path.name, []).append(info)

        audio_output.mkdir(parents=True, exist_ok=True)
        output_root = audio_output.resolve()
        entries: dict[str, dict[str, str]] = {}
        for word in sorted(selected):
            selection = selected[word]
            filename = selection.pop("filename")
            filename_path = PurePosixPath(filename)
            if filename_path.name != filename or filename_path.suffix.lower() != ".wav":
                raise MandarinAudioBuildError(f"Unsafe WAV filename: {filename!r}")
            members = members_by_name.get(filename, [])
            if len(members) != 1:
                raise MandarinAudioBuildError(
                    f"Expected one WAV named {filename!r}, found {len(members)}"
                )

            destination = audio_output / filename
            if destination.resolve(strict=False).parent != output_root:
                raise MandarinAudioBuildError(f"Unsafe audio destination: {destination}")
            with audio_archive.open(members[0]) as source, tempfile.NamedTemporaryFile(
                "wb", dir=audio_output, prefix=f".{filename}.", suffix=".tmp", delete=False
            ) as temporary:
                shutil.copyfileobj(source, temporary)
                temporary_name = temporary.name
            os.replace(temporary_name, destination)

            entries[word] = {
                **selection,
                "audio": Path(os.path.relpath(destination, manifest_path.parent)).as_posix(),
            }

    document = {
        "metadata": {
            "schema_version": 1,
            "source": SOURCE_NAME,
            "source_url": SOURCE_URL,
            "source_version": source_version,
            "audio_file_count": len(entries),
        },
        "entries": entries,
    }
    _write_json(document, manifest_path)
    return document


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract exact official Mandarin word audio")
    parser.add_argument("dictionary", type=Path)
    parser.add_argument("concise_xlsx", type=Path)
    parser.add_argument("audio_zip", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("audio_output", type=Path)
    parser.add_argument("--source-version", required=True)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        document = build_mandarin_audio(
            args.dictionary,
            args.concise_xlsx,
            args.audio_zip,
            args.manifest,
            args.audio_output,
            source_version=args.source_version,
        )
    except (MandarinAudioBuildError, OSError, json.JSONDecodeError) as error:
        print(f"build_mandarin_audio: {error}", file=sys.stderr)
        return 1
    print(
        f"Extracted {document['metadata']['audio_file_count']} unmodified official Mandarin WAV files "
        f"-> {args.manifest}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
