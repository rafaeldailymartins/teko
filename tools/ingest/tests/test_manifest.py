import hashlib
import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from teko_ingest.manifest import (
    MANIFEST_SCHEMA_VERSION,
    ExtractionManifest,
    ManifestError,
    PageRange,
    output_dir_name,
    sha256_file,
)

SHA = "a" * 64
CREATED_AT = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


def make_manifest(**overrides: object) -> ExtractionManifest:
    fields: dict[str, object] = {
        "source_id": "efd-icms-ipi/guia-pratico/3.1.8",
        "url": "https://www.gov.br/sped/guia.pdf",
        "sha256": SHA,
        "docling_version": "2.146.0",
        "created_at": CREATED_AT,
        "output_path": f"{SHA}/docling.json",
    }
    fields.update(overrides)
    return ExtractionManifest.from_dict(
        {
            key: value.isoformat() if isinstance(value, datetime) else value
            for key, value in {"schema_version": MANIFEST_SCHEMA_VERSION, **fields}.items()
        },
    )


_text = st.text(
    alphabet=st.characters(codec="utf-8", exclude_categories=("Cs",)),
    min_size=1,
    max_size=40,
).filter(lambda value: value.strip() != "")
_segment = st.text(
    alphabet=st.characters(
        codec="utf-8", exclude_categories=("Cs", "Cc"), exclude_characters="/\\"
    ),
    min_size=1,
    max_size=20,
).filter(lambda value: value not in {".", ".."})


def _url(scheme: str, host: str, path: str) -> str:
    return f"{scheme}://{host}/{path}"


_urls = st.builds(
    _url,
    st.sampled_from(["http", "https"]),
    st.from_regex(r"[a-z0-9]{1,20}(\.[a-z0-9]{1,10}){1,3}", fullmatch=True),
    st.from_regex(r"[A-Za-z0-9_.~-]{0,30}", fullmatch=True),
)
_manifests = st.builds(
    ExtractionManifest,
    source_id=_text,
    url=_urls,
    sha256=st.from_regex(r"[0-9a-f]{64}", fullmatch=True),
    docling_version=_text,
    created_at=st.datetimes(
        min_value=datetime(2000, 1, 1),  # noqa: DTZ001 - limites do hypothesis são ingênuos
        max_value=datetime(2100, 1, 1),  # noqa: DTZ001
        timezones=st.sampled_from([UTC, timezone(timedelta(hours=-3)), timezone.min]),
    ),
    output_path=st.lists(_segment, min_size=1, max_size=4).map("/".join),
    page_range=st.none()
    | st.integers(min_value=1, max_value=5000).flatmap(
        lambda start: st.builds(
            PageRange,
            st.just(start),
            st.integers(min_value=start, max_value=start + 5000),
        ),
    ),
)


@given(_manifests)
def test_json_roundtrip_preserves_manifest(manifest: ExtractionManifest) -> None:
    restored = ExtractionManifest.from_json(manifest.to_json())
    assert restored == manifest
    assert restored.to_json() == manifest.to_json()
    assert restored.created_at.tzinfo is UTC


@given(_manifests)
def test_dict_roundtrip_preserves_manifest(manifest: ExtractionManifest) -> None:
    assert ExtractionManifest.from_dict(manifest.to_dict()) == manifest


def test_to_json_is_deterministic_and_sorted() -> None:
    text = make_manifest().to_json()
    assert text.endswith("}\n")
    assert list(json.loads(text)) == sorted(json.loads(text))
    assert json.loads(text)["created_at"] == "2026-11-10T12:00:00+00:00"


def test_created_at_is_normalized_to_utc() -> None:
    brt = timezone(timedelta(hours=-3))
    manifest = make_manifest(created_at=datetime(2026, 11, 10, 9, 0, tzinfo=brt))
    assert manifest.created_at == CREATED_AT
    assert manifest.created_at.tzinfo is UTC


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"schema_version": 2}, "schema_version"),
        ({"source_id": "  "}, "source_id"),
        ({"url": "ftp://example.org/a.pdf"}, "url"),
        ({"url": "https:///sem-host"}, "url"),
        ({"sha256": "A" * 64}, "sha256"),
        ({"sha256": "a" * 63}, "sha256"),
        ({"docling_version": ""}, "docling_version"),
        ({"output_path": ""}, "output_path"),
        ({"output_path": "/abs/docling.json"}, "output_path"),
        ({"output_path": "../fora.json"}, "output_path"),
        ({"output_path": "a\\b.json"}, "output_path"),
    ],
)
def test_invalid_fields_are_rejected(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        make_manifest(**overrides)


def test_naive_created_at_is_rejected() -> None:
    with pytest.raises(ManifestError, match="fuso"):
        ExtractionManifest(
            source_id="x",
            url="https://example.org/a.pdf",
            sha256=SHA,
            docling_version="2.146.0",
            created_at=datetime(2026, 11, 10),  # noqa: DTZ001 - caso testado
            output_path="x.json",
        )


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("{", "JSON válido"),
        ("[]", "objeto JSON"),
        ('{"extra": 1}', "desconhecidos"),
        ('{"schema_version": "1"}', "inteiro"),
        ('{"schema_version": true}', "inteiro"),
        ('{"schema_version": 1, "created_at": 5}', "created_at"),
        ('{"schema_version": 1, "created_at": "ontem"}', "ISO 8601"),
    ],
)
def test_from_json_rejects_malformed_input(text: str, message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        ExtractionManifest.from_json(text)


def test_missing_field_is_rejected() -> None:
    data = make_manifest().to_dict()
    del data["url"]
    with pytest.raises(ManifestError, match="'url'"):
        ExtractionManifest.from_dict(data)


def test_write_uses_utf8_and_lf(tmp_path: Path) -> None:
    manifest = make_manifest(source_id="rcte/anexo-ix/benefício")
    target = tmp_path / "manifest.json"
    manifest.write(target)
    raw = target.read_bytes()
    assert b"\r\n" not in raw
    assert "benefício".encode() in raw
    assert ExtractionManifest.from_json(raw.decode("utf-8")) == manifest


def test_sha256_file_matches_hashlib(tmp_path: Path) -> None:
    payload = b"%PDF-1.7\n" + bytes(range(256)) * 5000
    target = tmp_path / "doc.pdf"
    target.write_bytes(payload)
    assert sha256_file(target, root=tmp_path) == hashlib.sha256(payload).hexdigest()


def test_sha256_file_of_empty_file(tmp_path: Path) -> None:
    target = tmp_path / "vazio.bin"
    target.write_bytes(b"")
    assert sha256_file(target, root=tmp_path) == hashlib.sha256(b"").hexdigest()


def test_page_range_roundtrip_and_part() -> None:
    manifest = make_manifest(page_range=[1, 120], part="p1-120", output_path=f"{SHA}-p1-120/d.json")
    assert manifest.page_range == PageRange(1, 120)
    assert manifest.part == "p1-120"
    data = json.loads(manifest.to_json())
    assert data["page_range"] == [1, 120]
    assert data["part"] == "p1-120"
    assert ExtractionManifest.from_json(manifest.to_json()) == manifest


def test_whole_document_serializes_null_part() -> None:
    data = json.loads(make_manifest().to_json())
    assert data["page_range"] is None
    assert data["part"] is None


def test_manifest_without_page_range_fields_is_whole_document() -> None:
    data = make_manifest().to_dict()
    del data["page_range"]
    del data["part"]
    assert ExtractionManifest.from_dict(data).page_range is None


@pytest.mark.parametrize(
    ("page_range", "part", "message"),
    [
        ([1, 120], None, "part"),
        ([1, 120], "p1-121", "part"),
        (None, "p1-120", "part"),
        ("1-120", "p1-120", "page_range"),
        ([1], "p1-120", "page_range"),
        ([1, 2, 3], "p1-120", "page_range"),
        ([1, "2"], "p1-2", "inteiros"),
        ([True, 2], "p1-2", "inteiros"),
        ([0, 2], "p0-2", "inválido"),
        ([5, 4], "p5-4", "inválido"),
    ],
)
def test_invalid_page_range_is_rejected(page_range: object, part: object, message: str) -> None:
    data: dict[str, object] = {**make_manifest().to_dict(), "page_range": page_range, "part": part}
    with pytest.raises(ManifestError, match=message):
        ExtractionManifest.from_dict(data)


@pytest.mark.parametrize(
    ("text", "expected"),
    [("1-120", PageRange(1, 120)), (" 121-366 ", PageRange(121, 366)), ("7-7", PageRange(7, 7))],
)
def test_page_range_parse(text: str, expected: PageRange) -> None:
    parsed = PageRange.parse(text)
    assert parsed == expected
    assert parsed.as_tuple() == (expected.start, expected.end)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("1", "formato"),
        ("1:120", "formato"),
        ("a-b", "formato"),
        ("0-5", "inválido"),
        ("9-3", "inválido"),
    ],
)
def test_page_range_parse_rejects(text: str, message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        PageRange.parse(text)


def test_page_range_requires_ints() -> None:
    with pytest.raises(ManifestError, match="inteiros"):
        PageRange(1.0, 2)  # pyright: ignore[reportArgumentType]


def test_output_dir_name() -> None:
    assert output_dir_name(SHA, None) == SHA
    assert output_dir_name(SHA, PageRange(121, 240)) == f"{SHA}-p121-240"
