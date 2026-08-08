"""Property-based tests (Hypothesis) for provenance (P12), no-binary output,
bounded text, and idempotent export.

These run entirely offline: they exercise the pure ``normalize_record`` /
``serialize`` / ``export_record`` functions on randomly generated parsed
records - no network, no real websites.
"""
import json
import tempfile
from datetime import date

from hypothesis import given, settings
from hypothesis import strategies as st

from pharma_scraper.export import export_record, record_filename, serialize
from pharma_scraper.normalize import MAX_TEXT_LEN, normalize_record

# Short factual-looking text (bounded); a parser would only ever yield short bits.
text = st.text(min_size=0, max_size=60)

# Plausible https URLs (always non-empty host + path).
urls = st.builds(
    lambda host, path: f"https://{host}.example/{path}",
    host=st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=10),
    path=st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-/", min_size=1, max_size=24),
)

WHITELIST_KEYS = {
    "company", "genericName", "brandName", "drugClass",
    "indications", "targetHints", "sourceUrl", "retrievedDate",
}

parsed_records = st.fixed_dictionaries({
    "company": st.one_of(st.none(), text),
    "genericName": st.one_of(st.none(), text),
    "brandName": st.one_of(st.none(), text),
    "drugClass": st.one_of(st.none(), text),
    "indications": st.lists(text, max_size=6),
    "targetHints": st.lists(text, max_size=4),
})

# Extra "junk" keys a buggy/hostile parser might attach - including binary image
# payloads. None of these are whitelisted, so normalize must drop them all.
junk = st.dictionaries(
    keys=st.sampled_from(["image", "imageBytes", "rawHtml", "thumbnail", "logo"]),
    values=st.one_of(
        st.binary(max_size=32),
        text,
        st.lists(st.binary(max_size=8), max_size=3),
    ),
    max_size=4,
)


@st.composite
def parsed_with_junk(draw):
    record = dict(draw(parsed_records))
    record.update(draw(junk))
    return record


def _contains_binary(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return True
    if isinstance(value, dict):
        return any(_contains_binary(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_binary(v) for v in value)
    return False


@settings(max_examples=200)
@given(parsed=parsed_with_junk(), url=urls)
def test_p12_every_record_has_provenance(parsed, url):
    record = normalize_record(parsed, source_url=url)
    assert record["sourceUrl"] == url and record["sourceUrl"]
    assert record["retrievedDate"]
    date.fromisoformat(record["retrievedDate"])  # is a valid ISO date


@settings(max_examples=200)
@given(parsed=parsed_with_junk(), url=urls)
def test_output_has_only_whitelisted_keys_and_no_binaries(parsed, url):
    record = normalize_record(parsed, source_url=url)
    assert set(record) == WHITELIST_KEYS
    assert not _contains_binary(record)


@settings(max_examples=200)
@given(parsed=parsed_records, url=urls)
def test_text_fields_are_bounded(parsed, url):
    record = normalize_record(parsed, source_url=url)
    for key in ("company", "genericName", "brandName", "drugClass"):
        if record[key] is not None:
            assert len(record[key]) <= MAX_TEXT_LEN
    for item in record["indications"] + record["targetHints"]:
        assert len(item) <= MAX_TEXT_LEN


@settings(max_examples=200)
@given(parsed=parsed_records, url=urls)
def test_serialization_roundtrips_and_is_stable(parsed, url):
    record = normalize_record(parsed, source_url=url)
    payload = serialize(record)
    assert json.loads(payload) == record  # round-trips exactly
    assert serialize(record) == payload  # deterministic bytes
    assert record_filename(record) == record_filename(record)  # stable filename


@settings(max_examples=60, deadline=None)
@given(parsed=parsed_records, url=urls)
def test_export_to_disk_is_idempotent(parsed, url):
    record = normalize_record(parsed, source_url=url)
    with tempfile.TemporaryDirectory() as directory:
        p1 = export_record(record, staging_dir=directory)
        bytes1 = p1.read_bytes()
        p2 = export_record(record, staging_dir=directory)
        bytes2 = p2.read_bytes()
        assert p1 == p2
        assert bytes1 == bytes2
