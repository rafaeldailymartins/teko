import hashlib
import importlib
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from docling_fakes import (
    ConverterFactory,
    FakeConversionStatus,
    FakeImageRefMode,
    FakeInputFormat,
    FakeOptions,
    FakeTableFormerMode,
    fake_api,
    fake_docling_modules,
    installed_version,
    missing_version,
)
from teko_ingest import convert
from teko_ingest.convert import (
    ConversionFailedError,
    ConvertOptions,
    DoclingNotInstalledError,
    build_converter,
    convert_document,
    installed_docling_version,
    load_docling,
)
from teko_ingest.manifest import ExtractionManifest, ManifestError
from teko_ingest.paths import UnsafePathError

URL = "https://www.gov.br/sped/guia.pdf"
FIXED_NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    target = tmp_path / "guia.pdf"
    target.write_bytes(b"%PDF-1.7\nconteudo de teste\n")
    return target


def _block_docling(monkeypatch: pytest.MonkeyPatch) -> None:
    # None em sys.modules faz o import falhar mesmo que o extra esteja instalado.
    for name in ("docling", "docling.datamodel", "docling.datamodel.base_models"):
        monkeypatch.setitem(sys.modules, name, None)


def test_convert_writes_docling_json_and_manifest(pdf: Path, tmp_path: Path) -> None:
    factory = ConverterFactory()
    out_root = tmp_path / "out"

    manifest = convert_document(
        pdf,
        source_id="efd-icms-ipi/guia-pratico/3.1.8",
        url=URL,
        root=tmp_path,
        out_root=out_root,
        api=fake_api(factory),
        now=lambda: FIXED_NOW,
    )

    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    assert manifest.sha256 == digest
    assert manifest.output_path == f"{digest}/docling.json"
    assert manifest.docling_version == "2.146.0"
    assert manifest.created_at == FIXED_NOW
    assert (out_root / manifest.output_path).is_file()
    stored = ExtractionManifest.from_json(
        (out_root / digest / "manifest.json").read_text(encoding="utf-8"),
    )
    assert stored == manifest

    [converter] = factory.instances
    assert converter.converted == [pdf.resolve()]
    assert converter.document.saved == [
        (out_root.resolve() / digest / "docling.json", FakeImageRefMode.PLACEHOLDER),
    ]


def test_relative_paths_are_resolved_against_root(pdf: Path, tmp_path: Path) -> None:
    factory = ConverterFactory()
    (tmp_path / "modelos").mkdir()

    manifest = convert_document(
        Path(pdf.name),
        root=tmp_path,
        source_id="x",
        url=URL,
        out_root=Path("out"),
        options=ConvertOptions(artifacts_path=Path("modelos")),
        api=fake_api(factory),
    )

    [converter] = factory.instances
    assert converter.converted == [pdf.resolve()]
    pipeline = converter.format_options[FakeInputFormat.PDF].kwargs["pipeline_options"]
    assert pipeline.kwargs["artifacts_path"] == (tmp_path / "modelos").resolve()
    assert (tmp_path / "out" / manifest.output_path).is_file()


@pytest.mark.parametrize(
    ("source", "out_root", "artifacts_path"),
    [
        (Path("..", "fora.pdf"), Path("out"), None),
        (Path("guia.pdf"), Path("..", "out"), None),
        (Path("guia.pdf"), Path("out"), Path("..")),
        (Path("guia.pdf"), Path("out"), Path("modelos-inexistentes")),
    ],
)
def test_paths_outside_root_fail_before_converting(
    tmp_path: Path,
    source: Path,
    out_root: Path,
    artifacts_path: Path | None,
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    (root / "guia.pdf").write_bytes(b"%PDF")
    (tmp_path / "fora.pdf").write_bytes(b"%PDF")
    factory = ConverterFactory()

    with pytest.raises(UnsafePathError):
        convert_document(
            source,
            root=root,
            source_id="x",
            url=URL,
            out_root=out_root,
            options=ConvertOptions(artifacts_path=artifacts_path),
            api=fake_api(factory),
        )

    assert factory.instances == []
    assert not (tmp_path / "out").exists()
    assert not (root / "out").exists()


def test_pipeline_follows_plan_defaults() -> None:
    factory = ConverterFactory()
    converter = build_converter(fake_api(factory), ConvertOptions())

    format_option = converter.format_options[FakeInputFormat.PDF]
    assert isinstance(format_option, FakeOptions)
    pipeline = format_option.kwargs["pipeline_options"]
    assert isinstance(pipeline, FakeOptions)
    table = pipeline.kwargs.pop("table_structure_options")
    assert pipeline.kwargs == {
        "artifacts_path": None,
        "do_ocr": False,
        "do_table_structure": True,
        "document_timeout": 3600.0,
        "enable_remote_services": False,
    }
    assert isinstance(table, FakeOptions)
    assert table.kwargs == {"mode": FakeTableFormerMode.ACCURATE, "do_cell_matching": True}


def test_pipeline_honours_options(tmp_path: Path) -> None:
    options = ConvertOptions(artifacts_path=tmp_path, ocr=True, document_timeout=60.0)
    converter = build_converter(fake_api(ConverterFactory()), options)

    pipeline = converter.format_options[FakeInputFormat.PDF].kwargs["pipeline_options"]
    assert pipeline.kwargs["artifacts_path"] == tmp_path
    assert pipeline.kwargs["do_ocr"] is True
    assert pipeline.kwargs["document_timeout"] == 60.0


def test_partial_success_is_a_failure_and_writes_nothing(pdf: Path, tmp_path: Path) -> None:
    factory = ConverterFactory(status=FakeConversionStatus.PARTIAL_SUCCESS)
    out_root = tmp_path / "out"

    with pytest.raises(ConversionFailedError, match="partial_success") as excinfo:
        convert_document(
            pdf,
            root=tmp_path,
            source_id="x",
            url=URL,
            out_root=out_root,
            api=fake_api(factory),
        )

    assert excinfo.value.status == "partial_success"
    assert excinfo.value.source == pdf.resolve()
    assert not out_root.exists()


def test_invalid_metadata_fails_before_converting(pdf: Path, tmp_path: Path) -> None:
    factory = ConverterFactory()

    with pytest.raises(ManifestError, match="url"):
        convert_document(
            pdf,
            source_id="x",
            url="file:///etc/passwd",
            root=tmp_path,
            out_root=tmp_path,
            api=fake_api(factory),
        )

    assert factory.instances == []


def test_convert_without_docling_raises_clear_error(
    pdf: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _block_docling(monkeypatch)
    with pytest.raises(DoclingNotInstalledError, match="uv sync --extra docling"):
        convert_document(pdf, source_id="x", url=URL, root=tmp_path, out_root=tmp_path)


def test_load_docling_resolves_real_import_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = ConverterFactory()
    for name, module in fake_docling_modules(factory).items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(convert, "package_version", installed_version)

    assert load_docling() == fake_api(factory)


def test_load_docling_without_package_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, module in fake_docling_modules(ConverterFactory()).items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(convert, "package_version", missing_version)

    with pytest.raises(DoclingNotInstalledError):
        load_docling()


def test_load_docling_propagates_unrelated_missing_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Uma dependência transitiva quebrada não deve ser mascarada como "extra ausente".
    def broken_import(_name: str) -> object:
        raise ModuleNotFoundError(name="torch", path=None) from None

    monkeypatch.setattr(importlib, "import_module", broken_import)
    with pytest.raises(ModuleNotFoundError) as excinfo:
        load_docling()
    assert excinfo.type is ModuleNotFoundError
    assert excinfo.value.name == "torch"


def test_installed_docling_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(convert, "package_version", installed_version)
    assert installed_docling_version() == "2.146.0"
    monkeypatch.setattr(convert, "package_version", missing_version)
    assert installed_docling_version() is None


def test_conversion_failed_error_message(pdf: Path) -> None:
    error = ConversionFailedError(pdf, "failure")
    assert str(error) == f"conversão de '{pdf}' terminou com status 'failure'"
