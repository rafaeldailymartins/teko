"""CLI ``teko-ingest``.

Subcomandos:

- ``manifest``: calcula o sha256 de um arquivo e imprime o manifesto JSON, sem converter;
- ``convert``: converte com o Docling e grava ``<out>/<sha256>/{docling.json, manifest.json}``.

Códigos de saída: 0 sucesso, 1 conversão incompleta, 2 entrada inválida, 3 Docling ausente.
"""

import argparse
import io
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from teko_ingest.convert import (
    DEFAULT_DOCUMENT_TIMEOUT_S,
    DOCLING_JSON,
    ConversionFailedError,
    ConvertOptions,
    DoclingNotInstalledError,
    convert_document,
    installed_docling_version,
)
from teko_ingest.manifest import ExtractionManifest, ManifestError, sha256_file

EXIT_OK: Final = 0
EXIT_CONVERSION_FAILED: Final = 1
EXIT_INVALID_INPUT: Final = 2
EXIT_DOCLING_MISSING: Final = 3


def _existing_file(value: str) -> Path:
    path = Path(value)
    if not path.is_file():
        msg = f"arquivo não encontrado: {value}"
        raise argparse.ArgumentTypeError(msg)
    return path


def _positive_float(value: str) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        msg = f"número inválido: {value}"
        raise argparse.ArgumentTypeError(msg) from exc
    if not number > 0:
        msg = f"deve ser maior que zero: {value}"
        raise argparse.ArgumentTypeError(msg)
    return number


def build_parser() -> argparse.ArgumentParser:
    """Monta o parser de argumentos."""
    parser = argparse.ArgumentParser(
        prog="teko-ingest",
        description="Extração de documentos do corpus do Tekó com o Docling.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("file", type=_existing_file, help="arquivo de entrada")
    common.add_argument("--source-id", required=True, help="id da fonte em corpus/sources.yaml")
    common.add_argument("--url", required=True, help="URL http(s) de origem do arquivo")

    manifest = commands.add_parser(
        "manifest",
        parents=[common],
        help="calcula o sha256 e imprime o manifesto JSON (sem converter)",
    )
    manifest.add_argument(
        "--docling-version",
        help="versão do Docling a registrar (padrão: a instalada)",
    )
    manifest.add_argument(
        "--output-path",
        help=f"caminho da saída relativo a out/ (padrão: <sha256>/{DOCLING_JSON})",
    )

    convert = commands.add_parser(
        "convert",
        parents=[common],
        help="converte com o Docling (requer o extra 'docling')",
    )
    convert.add_argument("--out", type=Path, default=Path("out"), help="diretório de saída")
    convert.add_argument(
        "--artifacts-path",
        type=Path,
        help="modelos pré-baixados (docling-tools models download)",
    )
    convert.add_argument("--ocr", action="store_true", help="liga o OCR (só com ocr: true)")
    convert.add_argument(
        "--timeout",
        type=_positive_float,
        default=DEFAULT_DOCUMENT_TIMEOUT_S,
        help="tempo máximo por documento, em segundos",
    )
    return parser


def _run_manifest(args: argparse.Namespace) -> int:
    source: Path = args.file
    docling_version: str | None = args.docling_version or installed_docling_version()
    if docling_version is None:
        sys.stderr.write(
            "erro: o Docling não está instalado; informe --docling-version ou instale o extra "
            "com `uv sync --extra docling`\n",
        )
        return EXIT_DOCLING_MISSING
    digest = sha256_file(source)
    output_path: str = args.output_path or f"{digest}/{DOCLING_JSON}"
    manifest = ExtractionManifest(
        source_id=args.source_id,
        url=args.url,
        sha256=digest,
        docling_version=docling_version,
        created_at=datetime.now(UTC),
        output_path=output_path,
    )
    sys.stdout.write(manifest.to_json())
    return EXIT_OK


def _run_convert(args: argparse.Namespace) -> int:
    options = ConvertOptions(
        artifacts_path=args.artifacts_path,
        ocr=args.ocr,
        document_timeout=args.timeout,
    )
    try:
        manifest = convert_document(
            args.file,
            source_id=args.source_id,
            url=args.url,
            out_root=args.out,
            options=options,
        )
    except ConversionFailedError as exc:
        sys.stderr.write(f"erro: {exc}\n")
        return EXIT_CONVERSION_FAILED
    sys.stdout.write(manifest.to_json())
    return EXIT_OK


def _use_utf8_streams() -> None:
    # No Windows o stdout redirecionado usa a code page local; o manifesto (consumido pelo
    # Node) e as mensagens precisam sair sempre em UTF-8.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    """Ponto de entrada do console script ``teko-ingest``."""
    _use_utf8_streams()
    args = build_parser().parse_args(argv)
    try:
        if args.command == "manifest":
            return _run_manifest(args)
        return _run_convert(args)
    except ManifestError as exc:
        sys.stderr.write(f"erro: manifesto inválido: {exc}\n")
        return EXIT_INVALID_INPUT
    except DoclingNotInstalledError as exc:
        sys.stderr.write(f"erro: {exc}\n")
        return EXIT_DOCLING_MISSING
