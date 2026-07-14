# Dictionary data builder

`build_dictionary.py` converts a locally supplied Ministry of Education
`kautian.ods` workbook into a canonical temporary JSON. `build_runtime_data.py`
losslessly splits it into the two static files consumed by the web app. Both use
only the Python standard library. The default output reads `詞彙比較` and uses
`詞目` only for exact `漢字` + `羅馬字` matches; it never guesses or performs a
fuzzy match.

The source workbook is not downloaded by this repository and must not be
committed. Run the builder with paths supplied explicitly:

```sh
python3 scripts/build_dictionary.py /path/to/kautian.ods data/.dictionary-canonical.tmp.json
python3 scripts/build_runtime_data.py data/.dictionary-canonical.tmp.json \
  data/dictionary-core.json data/dictionary-details.json
rm data/.dictionary-canonical.tmp.json
```

The temporary canonical document is minified UTF-8 JSON with this shape:

```text
{
  metadata: { schema_version, source, source_url,
              term_count, comparison_count, exact_match_count,
              audio_file_count, audio_comparison_count },
  terms: [{ id, mandarin,
            comparisons: [{ accent, hanji, romanization,
                            term_id?, audio? }] }]
}
```

To copy the playable files for exact dictionary matches, provide both audio
options. Only referenced MP3 files are copied, their bytes are unchanged, and
the emitted `audio` value is relative to the JSON file:

```sh
python3 scripts/build_dictionary.py /path/to/kautian.ods data/.dictionary-canonical.tmp.json \
  --source-updated 2026-07-13 \
  --audio-zip /path/to/sutiau-mp3.zip \
  --audio-output assets/audio
python3 scripts/build_runtime_data.py data/.dictionary-canonical.tmp.json \
  data/dictionary-core.json data/dictionary-details.json
rm data/.dictionary-canonical.tmp.json
```

`--source-updated YYYY-MM-DD` is optional. When present it is copied to
`metadata.source_updated`; when omitted that metadata key is absent.

The runtime splitter embeds the same source fingerprint and coverage counts in
both files, verifies an exact reconstruction before writing, and stores all
search fields in the core. The canonical temporary JSON is not committed or
deployed.

The older full `詞目` / `義項` / `例句` nested export remains available for
secondary uses:

```sh
python3 scripts/build_dictionary.py /path/to/kautian.ods data/full.json \
  --mode full
```

All displayed strings are copied from the workbook without spelling
normalization or rewriting. Numeric IDs are normalized only internally while
grouping worksheets, so an ODS `office:value="1.0"` can match `1`; emitted IDs
retain the source cell value. The source ODS and audio zip remain local inputs
and are not part of this repository.

Run the unit tests from the repository root:

```sh
python3 -m unittest discover -s test -v
```

Generating these files is only the build step. Before changing data URLs,
cache names, or the CDN commit, follow the repository's complete
[`docs/DATA-RELEASE.md`](../docs/DATA-RELEASE.md) release procedure.
