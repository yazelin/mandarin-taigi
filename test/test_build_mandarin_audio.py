from __future__ import annotations

import unittest

from scripts import build_mandarin_audio


class BuildMandarinAudioTests(unittest.TestCase):
    def test_selects_primary_exact_audio_without_guessing_missing_words(self) -> None:
        dictionary_rows = [
            {
                "字詞名": "家",
                "字詞號": "2342",
                "多音排序": "2",
                "注音一式": "ㄍㄨ",
                "漢語拼音": "gū",
            },
            {
                "字詞名": "家",
                "字詞號": "3119",
                "多音排序": "1",
                "注音一式": "ㄐㄧㄚ",
                "漢語拼音": "jiā",
            },
            {
                "字詞名": "醫院",
                "字詞號": "584500011",
                "多音排序": "0",
                "注音一式": "ㄧ ㄩㄢˋ",
                "漢語拼音": "yī yuàn",
            },
        ]
        audio_rows = [
            {"字詞名": "家", "字詞號": "2342", "檔案名稱": "2342.wav"},
            {"字詞名": "家", "字詞號": "3119", "檔案名稱": "3119.wav"},
        ]

        selected = build_mandarin_audio.select_primary_entries(
            {"家", "醫院", "不存在"}, dictionary_rows, audio_rows
        )

        self.assertEqual(list(selected), ["家"])
        self.assertEqual(
            selected["家"],
            {
                "id": "3119",
                "bopomofo": "ㄐㄧㄚ",
                "pinyin": "jiā",
                "filename": "3119.wav",
            },
        )


if __name__ == "__main__":
    unittest.main()
