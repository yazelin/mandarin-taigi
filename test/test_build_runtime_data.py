import json
import tempfile
import unittest
from pathlib import Path

from scripts import build_runtime_data


class RuntimeDictionaryTests(unittest.TestCase):
    def fixture(self):
        return {
            "metadata": {
                "schema_version": 2,
                "term_count": 2,
                "common_entry_count": 1,
                "comparison_count": 3,
            },
            "terms": [
                {
                    "kind": "comparison",
                    "id": "1",
                    "mandarin": "醫院",
                    "comparisons": [
                        {
                            "accent": "臺南混合腔",
                            "hanji": "病院",
                            "romanization": "pēnn-īnn",
                        },
                        {
                            "accent": "臺北偏泉腔",
                            "hanji": "醫生館",
                            "romanization": "i-sing-kuán",
                            "term_id": "12676",
                            "audio": "../assets/audio/12676(1).mp3",
                        },
                    ],
                },
                {
                    "kind": "sense",
                    "id": "sense:2",
                    "mandarin": "長頸鹿",
                    "comparisons": [
                        {
                            "accent": "",
                            "hanji": "長頷鹿",
                            "romanization": "tn̂g-ām-lo̍k",
                            "term_id": "2",
                            "audio": "../assets/audio/2(1).mp3",
                        }
                    ],
                },
            ],
            "common_entries": [
                {
                    "kind": "common",
                    "id": "22317",
                    "hanji": "想像",
                    "romanization": "sióng-siōng",
                    "type": "臺華共同詞",
                    "category": "",
                    "audio": "../assets/audio/22317(1).mp3",
                }
            ],
        }

    def test_split_reconstructs_every_field_exactly(self):
        dictionary = self.fixture()
        core, details = build_runtime_data.build_runtime_documents(dictionary)
        self.assertEqual(
            build_runtime_data.inflate_runtime_documents(core, details),
            dictionary,
        )
        self.assertEqual(core["r"], details["r"])
        self.assertEqual(core["n"], [2, 1, 3, 2])
        self.assertEqual(details["n"], core["n"])

    def test_writer_embeds_exact_details_byte_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "canonical.json"
            core_path = root / "dictionary-core.json"
            details_path = root / "dictionary-details.json"
            source.write_text(json.dumps(self.fixture(), ensure_ascii=False), encoding="utf-8")
            core_bytes, details_bytes = build_runtime_data.write_runtime_data(
                source,
                core_path,
                details_path,
            )
            core = json.loads(core_path.read_text(encoding="utf-8"))
            self.assertEqual(core_bytes, core_path.stat().st_size)
            self.assertEqual(details_bytes, details_path.stat().st_size)
            self.assertEqual(core["d"], details_bytes)

    def test_mismatched_revisions_are_rejected(self):
        core, details = build_runtime_data.build_runtime_documents(self.fixture())
        details["r"] = "different"
        with self.assertRaisesRegex(ValueError, "revision mismatch"):
            build_runtime_data.inflate_runtime_documents(core, details)


if __name__ == "__main__":
    unittest.main()
