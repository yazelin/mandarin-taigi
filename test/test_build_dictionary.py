from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from scripts import build_dictionary


def _text_cell(value: str) -> str:
    return (
        '<table:table-cell office:value-type="string">'
        f"<text:p>{escape(value)}</text:p>"
        "</table:table-cell>"
    )


def _number_cell(value: str) -> str:
    return (
        '<table:table-cell office:value-type="float" '
        f'office:value={quoteattr(value)}/>'
    )


def _row(cells: list[str], repeat: int | None = None) -> str:
    repeated = f' table:number-rows-repeated="{repeat}"' if repeat else ""
    return f"<table:table-row{repeated}>{''.join(cells)}</table:table-row>"


def _sheet(name: str, headers: tuple[str, ...], rows: list[str]) -> str:
    header = _row([_text_cell(value) for value in headers])
    return (
        f"<table:table table:name={quoteattr(name)}>"
        f"{header}{''.join(rows)}"
        "</table:table>"
    )


def _content_xml(sheets: list[str]) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
 <office:body><office:spreadsheet>{''.join(sheets)}</office:spreadsheet></office:body>
</office:document-content>'''


def _write_ods(path: Path, sheets: list[str]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("content.xml", _content_xml(sheets))


def _comparison_sheets() -> list[str]:
    entry_rows = [
        _row(
            [
                _number_cell("1"),
                _text_cell("主詞目"),
                _text_cell("病院"),
                _text_cell("pīnn-īnn"),
                _text_cell("醫療"),
                _text_cell("1(1)"),
            ]
        ),
        _row(
            [
                _number_cell("2"),
                _text_cell("主詞目"),
                _text_cell("看醫生"),
                _text_cell("khuànn-i-sing"),
                _text_cell("醫療"),
                _text_cell("2(1)"),
            ]
        ),
        # The same exact spelling and romanization points to another 詞目id;
        # this key must remain unlinked instead of being guessed.
        _row(
            [
                _number_cell("3"),
                _text_cell("主詞目"),
                _text_cell("看醫生"),
                _text_cell("khuànn-i-sing"),
                _text_cell("醫療"),
                _text_cell("3(1)"),
            ]
        ),
    ]
    comparison_rows = [
        _row(
            [
                _number_cell("100"),
                _text_cell("醫院"),
                _text_cell("臺北偏泉腔"),
                _text_cell("病院"),
                _text_cell("pīnn-īnn"),
            ]
        ),
        _row(
            [
                _number_cell("100.0"),
                _text_cell("醫院"),
                _text_cell("鹿港偏泉腔"),
                _text_cell("病院"),
                _text_cell("pǐnn-ǐnn"),
            ]
        ),
        _row(
            [
                _number_cell("101"),
                _text_cell("看醫生"),
                _text_cell("臺南混合腔"),
                _text_cell("看醫生"),
                _text_cell("khuànn-i-sing"),
            ]
        ),
    ]
    return [
        _sheet("詞目", build_dictionary.TARGET_COLUMNS["詞目"], entry_rows),
        _sheet(
            "詞彙比較",
            build_dictionary.TARGET_COLUMNS["詞彙比較"],
            comparison_rows,
        ),
    ]


class BuildDictionaryTests(unittest.TestCase):
    def test_comparison_output_uses_only_exact_links_and_selected_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "kautian.ods"
            audio_zip = root / "sutiau-mp3.zip"
            output = root / "data" / "comparisons.json"
            audio_output = root / "assets" / "audio"
            _write_ods(source, _comparison_sheets())
            with zipfile.ZipFile(audio_zip, "w") as archive:
                archive.writestr("0/1(1).mp3", b"ID3 exact source bytes")
                archive.writestr("0/2(1).mp3", b"ID3 ambiguous source bytes")
                archive.writestr("0/unrelated.mp3", b"ID3 unrelated")

            document = build_dictionary.write_dictionary(
                source,
                output,
                audio_zip=audio_zip,
                audio_output=audio_output,
                source_updated="2026-07-14",
            )
            payload = output.read_text(encoding="utf-8")

            self.assertEqual(
                (audio_output / "1(1).mp3").read_bytes(), b"ID3 exact source bytes"
            )
            self.assertFalse((audio_output / "2(1).mp3").exists())
            self.assertFalse((audio_output / "unrelated.mp3").exists())

        self.assertNotIn("\n", payload)
        self.assertNotIn('": "', payload)
        self.assertIn("臺北偏泉腔", payload)
        self.assertEqual(json.loads(payload), document)
        self.assertEqual(
            document["metadata"],
            {
                "schema_version": 1,
                "source": build_dictionary.SOURCE_NAME,
                "source_url": build_dictionary.SOURCE_URL,
                "source_updated": "2026-07-14",
                "term_count": 2,
                "comparison_count": 3,
                "exact_match_count": 1,
                "audio_file_count": 1,
                "audio_comparison_count": 1,
            },
        )
        self.assertEqual(
            document["terms"],
            [
                {
                    "id": "100",
                    "mandarin": "醫院",
                    "comparisons": [
                        {
                            "accent": "臺北偏泉腔",
                            "hanji": "病院",
                            "romanization": "pīnn-īnn",
                            "term_id": "1",
                            "audio": "../assets/audio/1(1).mp3",
                        },
                        {
                            "accent": "鹿港偏泉腔",
                            "hanji": "病院",
                            "romanization": "pǐnn-ǐnn",
                        },
                    ],
                },
                {
                    "id": "101",
                    "mandarin": "看醫生",
                    "comparisons": [
                        {
                            "accent": "臺南混合腔",
                            "hanji": "看醫生",
                            "romanization": "khuànn-i-sing",
                        }
                    ],
                },
            ],
        )

    def test_full_mode_merges_senses_and_examples_without_rewriting(self) -> None:
        entry_rows = [
            _row(
                [
                    _number_cell("1"),
                    _text_cell("主詞目"),
                    _text_cell("媠"),
                    _text_cell("suí"),
                    # A single repeated cell represents both blank 分類 and 音檔.
                    '<table:table-cell table:number-columns-repeated="2"/>',
                ]
            ),
            # Real ODS files commonly end sheets with a very large repeated blank row.
            _row(
                ['<table:table-cell table:number-columns-repeated="1024"/>'],
                repeat=1_048_000,
            ),
        ]
        sense_rows = [
            _row(
                [
                    # 1.0 must join the 詞目 office:value 1, but its raw text is not emitted.
                    _number_cell("1.0"),
                    _number_cell("10"),
                    _text_cell("形容詞"),
                    (
                        '<table:table-cell office:value-type="string">'
                        '<text:p>美麗<text:s text:c="2"/>好看。</text:p>'
                        '<text:p>第二段原文。</text:p>'
                        "</table:table-cell>"
                    ),
                ]
            ),
            _row(
                [
                    _number_cell("1"),
                    _number_cell("11"),
                    _text_cell(""),
                    _text_cell("外觀令人喜愛。"),
                ]
            ),
        ]
        example_rows = [
            _row(
                [
                    _number_cell("1"),
                    _number_cell("10.0"),
                    _number_cell("1"),
                    _text_cell("這蕊花真媠。"),
                    _text_cell("Tsit luí hue tsin suí."),
                    _text_cell("這朵花很漂亮。"),
                    _text_cell("1-10-1"),
                ]
            )
        ]

        sheets = [
            _sheet("詞目", build_dictionary.TARGET_COLUMNS["詞目"], entry_rows),
            _sheet("義項", build_dictionary.TARGET_COLUMNS["義項"], sense_rows),
            _sheet("例句", build_dictionary.TARGET_COLUMNS["例句"], example_rows),
            _sheet("其他資料", ("欄位",), [_row([_text_cell("應忽略")])]),
        ]

        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "kautian.ods"
            output = Path(temporary_directory) / "dictionary.json"
            _write_ods(source, sheets)

            document = build_dictionary.write_dictionary(source, output, mode="full")
            payload = output.read_text(encoding="utf-8")

        self.assertNotIn("\n", payload)
        self.assertNotIn('": "', payload)
        self.assertIn("臺", json.dumps({"臺": "臺"}, ensure_ascii=False))
        self.assertIn("這朵花很漂亮。", payload)
        self.assertNotIn("\\u9019", payload)
        self.assertEqual(document["metadata"]["entry_count"], 1)
        self.assertEqual(document["metadata"]["sense_count"], 2)
        self.assertEqual(document["metadata"]["example_count"], 1)

        entry = document["entries"][0]
        self.assertEqual(
            entry,
            {
                "id": "1",
                "hanji": "媠",
                "romanization": "suí",
                "type": "主詞目",
                "category": "",
                "audio": "",
                "senses": [
                    {
                        "id": "10",
                        "part_of_speech": "形容詞",
                        "definition": "美麗  好看。\n第二段原文。",
                        "examples": [
                            {
                                "order": "1",
                                "hanji": "這蕊花真媠。",
                                "romanization": "Tsit luí hue tsin suí.",
                                "mandarin": "這朵花很漂亮。",
                                "audio": "1-10-1",
                            }
                        ],
                    },
                    {
                        "id": "11",
                        "part_of_speech": "",
                        "definition": "外觀令人喜愛。",
                        "examples": [],
                    },
                ],
            },
        )
        self.assertEqual(json.loads(payload), document)

    def test_rejects_a_missing_required_worksheet(self) -> None:
        sheets = [
            _sheet("詞目", build_dictionary.TARGET_COLUMNS["詞目"], []),
            _sheet("義項", build_dictionary.TARGET_COLUMNS["義項"], []),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "kautian.ods"
            _write_ods(source, sheets)
            with self.assertRaisesRegex(
                build_dictionary.DictionaryBuildError,
                "Missing required worksheet: 詞彙比較",
            ):
                build_dictionary.build_document(source)

    def test_rejects_an_invalid_source_updated_date(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "kautian.ods"
            _write_ods(source, _comparison_sheets())
            with self.assertRaisesRegex(
                build_dictionary.DictionaryBuildError,
                "source_updated must use YYYY-MM-DD",
            ):
                build_dictionary.build_document(
                    source, source_updated="2026-02-30"
                )

    def test_rejects_zip_slip_paths_before_extracting_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "kautian.ods"
            audio_zip = root / "unsafe.zip"
            output = root / "data" / "comparisons.json"
            audio_output = root / "audio"
            _write_ods(source, _comparison_sheets())
            with zipfile.ZipFile(audio_zip, "w") as archive:
                archive.writestr("0/1(1).mp3", b"ID3 selected")
                archive.writestr("../outside.mp3", b"must not escape")

            with self.assertRaisesRegex(
                build_dictionary.DictionaryBuildError, "Unsafe path in audio zip"
            ):
                build_dictionary.write_dictionary(
                    source,
                    output,
                    audio_zip=audio_zip,
                    audio_output=audio_output,
                )
            self.assertFalse((root / "outside.mp3").exists())

    def test_repeated_cells_are_capped_to_the_known_header_width(self) -> None:
        row = build_dictionary.ET.fromstring(
            '<table:table-row '
            'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">'
            '<table:table-cell table:number-columns-repeated="1000000"/>'
            "</table:table-row>"
        )
        self.assertEqual(build_dictionary.row_values(row, max_columns=3), ["", "", ""])


if __name__ == "__main__":
    unittest.main()
