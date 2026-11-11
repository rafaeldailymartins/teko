import hashlib
import io
import json
import runpy
import sys
from pathlib import Path

import pytest

from docling_fakes import (
    ConverterFactory,
    FakeConversionStatus,
    fake_docling_modules,
    installed_version,
    missing_version,
)
from teko_ingest import cli, convert
from teko_ingest.cli import (
    EXIT_CONVERSION_FAILED,
    EXIT_DOCLING_MISSING,
    EXIT_INVALID_INPUT,
    EXIT_OK,
    main,
)
from teko_ingest.manifest import ExtractionManifest

URL = "https://www.gov.br/sped/guia.pdf"


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    target = tmp_path / "guia.pdf"
    target.write_bytes(b"%PDF-1.7\nconteudo\n")
    return target


@pytest.fixture
def no_docling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(convert, "package_version", missing_version)
    for name in ("docling", "docling.datamodel", "docling.datamodel.base_models"):
        monkeypatch.setitem(sys.modules, name, None)


@pytest.fixture
def docling_factory(monkeypatch: pytest.MonkeyPatch) -> ConverterFactory:
    factory = ConverterFactory()
    for name, module in fake_docling_modules(factory).items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(convert, "package_version", installed_version)
    return factory


def test_manifest_prints_json(pdf: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = main(
        [
            "manifest",
            str(pdf),
            "--source-id",
            "efd-icms-ipi/guia-pratico/3.1.8",
            "--url",
            URL,
            "--docling-version",
            "2.146.0",
        ],
    )

    assert code == EXIT_OK
    manifest = ExtractionManifest.from_json(capsys.readouterr().out)
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    assert manifest.sha256 == digest
    assert manifest.output_path == f"{digest}/docling.json"
    assert manifest.source_id == "efd-icms-ipi/guia-pratico/3.1.8"


def test_manifest_uses_installed_docling_and_custom_output(
    pdf: Path,
    capsys: pytest.CaptureFixture[str],
    docling_factory: ConverterFactory,
) -> None:
    args = ["manifest", str(pdf), "--source-id", "s", "--url", URL, "--output-path", "a/b.json"]
    assert main(args) == EXIT_OK
    data = json.loads(capsys.readouterr().out)
    assert data["docling_version"] == "2.146.0"
    assert data["output_path"] == "a/b.json"
    assert docling_factory.instances == []


@pytest.mark.usefixtures("no_docling")
def test_manifest_without_docling_version(pdf: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["manifest", str(pdf), "--source-id", "s", "--url", URL]) == EXIT_DOCLING_MISSING
    assert "--docling-version" in capsys.readouterr().err


def test_manifest_rejects_invalid_url(pdf: Path, capsys: pytest.CaptureFixture[str]) -> None:
    args = ["manifest", str(pdf), "--source-id", "s", "--url", "nao-e-url"]
    assert main([*args, "--docling-version", "2.146.0"]) == EXIT_INVALID_INPUT
    assert "manifesto inválido" in capsys.readouterr().err


def test_missing_file_is_a_usage_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["manifest", str(tmp_path / "nao-existe.pdf"), "--source-id", "s", "--url", URL])
    assert excinfo.value.code == EXIT_INVALID_INPUT
    assert "arquivo não encontrado" in capsys.readouterr().err


def test_convert_writes_output(
    pdf: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    docling_factory: ConverterFactory,
) -> None:
    out = tmp_path / "out"
    args = ["convert", str(pdf), "--source-id", "s", "--url", URL, "--out", str(out)]
    code = main([*args, "--ocr", "--timeout", "90", "--artifacts-path", str(tmp_path)])

    assert code == EXIT_OK
    manifest = ExtractionManifest.from_json(capsys.readouterr().out)
    assert (out / manifest.sha256 / "manifest.json").is_file()
    assert (out / manifest.output_path).is_file()
    [converter] = docling_factory.instances
    pipeline = next(iter(converter.format_options.values())).kwargs["pipeline_options"]
    assert pipeline.kwargs["do_ocr"] is True
    assert pipeline.kwargs["document_timeout"] == 90.0
    assert pipeline.kwargs["artifacts_path"] == tmp_path


def test_convert_partial_success_exits_1(
    pdf: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    docling_factory: ConverterFactory,
) -> None:
    docling_factory.status = FakeConversionStatus.PARTIAL_SUCCESS
    args = ["convert", str(pdf), "--source-id", "s", "--url", URL, "--out", str(tmp_path)]
    assert main(args) == EXIT_CONVERSION_FAILED
    assert "partial_success" in capsys.readouterr().err


@pytest.mark.usefixtures("no_docling")
def test_convert_without_docling(pdf: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["convert", str(pdf), "--source-id", "s", "--url", URL]) == EXIT_DOCLING_MISSING
    assert "uv sync --extra docling" in capsys.readouterr().err


@pytest.mark.parametrize("timeout", ["0", "-5", "abc", "nan"])
def test_convert_rejects_invalid_timeout(pdf: Path, timeout: str) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["convert", str(pdf), "--source-id", "s", "--url", URL, "--timeout", timeout])
    assert excinfo.value.code == EXIT_INVALID_INPUT


def test_subcommand_is_required() -> None:
    with pytest.raises(SystemExit) as excinfo:
        main([])
    assert excinfo.value.code == EXIT_INVALID_INPUT


def test_python_m_entrypoint(pdf: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    argv = ["teko-ingest", "manifest", str(pdf), "--source-id", "s", "--url", URL]
    monkeypatch.setattr(sys, "argv", [*argv, "--docling-version", "2.146.0"])
    with pytest.raises(SystemExit) as excinfo:
        runpy.run_module("teko_ingest", run_name="__main__")
    assert excinfo.value.code == EXIT_OK


def test_output_is_utf8_even_with_legacy_code_page(
    pdf: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = io.BytesIO()
    stdout = io.TextIOWrapper(buffer, encoding="cp1252")
    monkeypatch.setattr(sys, "stdout", stdout)
    args = ["manifest", str(pdf), "--source-id", "rcte/benefício", "--url", URL]
    assert main([*args, "--docling-version", "2.146.0"]) == EXIT_OK
    stdout.flush()
    assert "rcte/benefício".encode() in buffer.getvalue()


def test_non_text_wrapper_streams_are_left_alone(
    pdf: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stdout = io.StringIO()
    monkeypatch.setattr(sys, "stdout", stdout)
    args = ["manifest", str(pdf), "--source-id", "s", "--url", URL]
    assert main([*args, "--docling-version", "2.146.0"]) == EXIT_OK
    assert json.loads(stdout.getvalue())["source_id"] == "s"


def test_parser_lists_both_subcommands() -> None:
    help_text = cli.build_parser().format_help()
    assert "manifest" in help_text
    assert "convert" in help_text
