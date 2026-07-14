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

    def test_does_not_fall_back_when_primary_reading_has_no_audio(self) -> None:
        dictionary_rows = [
            {
                "字詞名": "行",
                "字詞號": "2556",
                "多音排序": "1",
                "注音一式": "ㄒㄧㄥˊ",
                "漢語拼音": "xíng",
            },
            {
                "字詞名": "行",
                "字詞號": "2557",
                "多音排序": "2",
                "注音一式": "ㄏㄤˊ",
                "漢語拼音": "háng",
            },
        ]
        audio_rows = [
            {"字詞名": "行", "字詞號": "2557", "檔案名稱": "2557.wav"},
        ]

        selected = build_mandarin_audio.select_primary_entries(
            {"行"}, dictionary_rows, audio_rows
        )

        self.assertEqual(selected, {})

    def test_accepts_order_zero_reading_only_when_it_is_the_sole_reading(self) -> None:
        dictionary_rows = [
            {
                "字詞名": "山",
                "字詞號": "2091",
                "多音排序": "0",
                "注音一式": "ㄕㄢ",
                "漢語拼音": "shān",
            },
            {
                "字詞名": "重",
                "字詞號": "4617",
                "多音排序": "",
                "注音一式": "ㄓㄨㄥˋ",
                "漢語拼音": "zhòng",
            },
            {
                "字詞名": "重",
                "字詞號": "4618",
                "多音排序": "2",
                "注音一式": "ㄔㄨㄥˊ",
                "漢語拼音": "chóng",
            },
        ]
        audio_rows = [
            {"字詞名": "山", "字詞號": "2091", "檔案名稱": "2091.wav"},
            {"字詞名": "重", "字詞號": "4617", "檔案名稱": "4617.wav"},
            {"字詞名": "重", "字詞號": "4618", "檔案名稱": "4618.wav"},
        ]

        selected = build_mandarin_audio.select_primary_entries(
            {"山", "重"}, dictionary_rows, audio_rows
        )

        self.assertEqual(list(selected), ["山"])
        self.assertEqual(selected["山"]["filename"], "2091.wav")


if __name__ == "__main__":
    unittest.main()
