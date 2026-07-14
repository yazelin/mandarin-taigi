#!/usr/bin/env python3
"""Split the canonical dictionary into a fast search core and deferred details.

The regular builder's canonical JSON is a temporary intermediate used only for
this lossless split check; it is not deployed. The browser downloads the two
compact runtime files: every searchable field is in the core, while audio,
source-link, and category metadata is applied in the background from details.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


RUNTIME_SCHEMA_VERSION = 1
AUDIO_PREFIX = "../assets/audio/"


def _audio_filename(value: str) -> str:
    if not value:
        return ""
    if not value.startswith(AUDIO_PREFIX):
        raise ValueError(f"Unexpected audio path outside {AUDIO_PREFIX!r}: {value!r}")
    return value.removeprefix(AUDIO_PREFIX)


def build_runtime_documents(dictionary: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    terms = dictionary.get("terms")
    common_entries = dictionary.get("common_entries")
    metadata = dictionary.get("metadata")
    if not isinstance(terms, list) or not isinstance(common_entries, list) or not isinstance(metadata, dict):
        raise ValueError("Dictionary must contain metadata, terms, and common_entries")

    accents = list(
        dict.fromkeys(
            comparison.get("accent", "")
            for term in terms
            for comparison in term.get("comparisons", [])
        )
    )
    accent_indexes = {accent: index for index, accent in enumerate(accents)}

    core_terms: list[list[Any]] = []
    detail_terms: list[list[Any]] = []
    for term_index, term in enumerate(terms):
        comparisons = term.get("comparisons", [])
        core_terms.append(
            [
                term.get("id", ""),
                term.get("mandarin", ""),
                1 if term.get("kind") == "sense" else 0,
                [
                    [
                        accent_indexes[comparison.get("accent", "")],
                        comparison.get("hanji", ""),
                        comparison.get("romanization", ""),
                    ]
                    for comparison in comparisons
                ],
            ]
        )

        deferred = []
        for comparison_index, comparison in enumerate(comparisons):
            term_id = comparison.get("term_id", "")
            audio = _audio_filename(comparison.get("audio", ""))
            if term_id or audio:
                deferred.append([comparison_index, term_id, audio])
        if deferred:
            detail_terms.append([term_index, deferred])

    core_common = [
        [entry.get("id", ""), entry.get("hanji", ""), entry.get("romanization", "")]
        for entry in common_entries
    ]
    detail_common = [
        [
            index,
            entry.get("type", ""),
            entry.get("category", ""),
            _audio_filename(entry.get("audio", "")),
        ]
        for index, entry in enumerate(common_entries)
    ]

    comparison_count = sum(len(term.get("comparisons", [])) for term in terms)
    deferred_comparison_count = sum(len(row[1]) for row in detail_terms)
    revision = hashlib.sha256(compact_json(dictionary)).hexdigest()[:20]
    counts = [len(terms), len(common_entries), comparison_count, deferred_comparison_count]
    details = {
        "v": RUNTIME_SCHEMA_VERSION,
        "r": revision,
        "n": counts,
        "t": detail_terms,
        "c": detail_common,
    }
    core = {
        "v": RUNTIME_SCHEMA_VERSION,
        "r": revision,
        "n": counts,
        "m": metadata,
        "a": accents,
        "t": core_terms,
        "c": core_common,
    }
    return core, details


def inflate_runtime_documents(core: dict[str, Any], details: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct the canonical schema for generation-time equivalence checks."""
    if core.get("v") != RUNTIME_SCHEMA_VERSION or details.get("v") != RUNTIME_SCHEMA_VERSION:
        raise ValueError("Unsupported runtime dictionary schema")
    if core.get("r") != details.get("r") or core.get("n") != details.get("n"):
        raise ValueError("Runtime core/details revision mismatch")
    accents = core.get("a")
    if not isinstance(accents, list):
        raise ValueError("Runtime core has no accent table")

    terms = []
    for term_row in core.get("t", []):
        term_id, mandarin, kind_code, comparison_rows = term_row
        terms.append(
            {
                "kind": "sense" if kind_code else "comparison",
                "id": term_id,
                "mandarin": mandarin,
                "comparisons": [
                    {
                        "accent": accents[comparison_row[0]],
                        "hanji": comparison_row[1],
                        "romanization": comparison_row[2],
                    }
                    for comparison_row in comparison_rows
                ],
            }
        )

    common_entries = [
        {
            "kind": "common",
            "id": row[0],
            "hanji": row[1],
            "romanization": row[2],
        }
        for row in core.get("c", [])
    ]

    for term_index, comparison_rows in details.get("t", []):
        for comparison_index, term_id, audio_filename in comparison_rows:
            comparison = terms[term_index]["comparisons"][comparison_index]
            if term_id:
                comparison["term_id"] = term_id
            if audio_filename:
                comparison["audio"] = f"{AUDIO_PREFIX}{audio_filename}"

    for common_index, entry_type, category, audio_filename in details.get("c", []):
        entry = common_entries[common_index]
        entry["type"] = entry_type
        entry["category"] = category
        entry["audio"] = f"{AUDIO_PREFIX}{audio_filename}" if audio_filename else ""

    return {
        "metadata": core.get("m", {}),
        "terms": terms,
        "common_entries": common_entries,
    }


def compact_json(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def write_runtime_data(source: Path, core_output: Path, details_output: Path) -> tuple[int, int]:
    dictionary = json.loads(source.read_text(encoding="utf-8"))
    core, details = build_runtime_documents(dictionary)
    if inflate_runtime_documents(core, details) != dictionary:
        raise ValueError("Runtime split failed lossless reconstruction check")
    details_bytes = compact_json(details)
    core["d"] = len(details_bytes)
    core_bytes = compact_json(core)

    core_output.parent.mkdir(parents=True, exist_ok=True)
    details_output.parent.mkdir(parents=True, exist_ok=True)
    core_output.write_bytes(core_bytes)
    details_output.write_bytes(details_bytes)
    return len(core_bytes), len(details_bytes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Temporary canonical dictionary JSON")
    parser.add_argument("core", type=Path, nargs="?", default=Path("data/dictionary-core.json"))
    parser.add_argument("details", type=Path, nargs="?", default=Path("data/dictionary-details.json"))
    args = parser.parse_args()
    core_bytes, details_bytes = write_runtime_data(args.source, args.core, args.details)
    print(f"runtime dictionary: core={core_bytes:,} bytes details={details_bytes:,} bytes")


if __name__ == "__main__":
    main()
