"""Conversão de um documento do corpus com o Docling.

O Docling (e o torch) só existem com o extra ``docling`` (``uv sync --extra docling``). Por
isso ele é importado de forma preguiçosa, dentro de :func:`load_docling`, e o restante do pacote
(manifesto, CLI, testes) roda num ambiente leve.
"""

import importlib
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Final

from teko_ingest.manifest import ExtractionManifest, sha256_file
from teko_ingest.paths import resolve_dir, resolve_file

DOCLING_JSON: Final = "docling.json"
MANIFEST_JSON: Final = "manifest.json"
DEFAULT_DOCUMENT_TIMEOUT_S: Final = 3600.0
INSTALL_HINT: Final = "instale o extra com `uv sync --extra docling` em tools/ingest"


class DoclingNotInstalledError(RuntimeError):
    """O extra ``docling`` não está instalado no ambiente."""

    def __init__(self) -> None:
        """Monta a mensagem com a instrução de instalação."""
        super().__init__(f"o pacote 'docling' não está instalado; {INSTALL_HINT}")


class ConversionFailedError(RuntimeError):
    """O Docling não converteu o documento por completo."""

    def __init__(self, source: Path, status: str) -> None:
        """Guarda o arquivo e o status devolvido pelo Docling."""
        super().__init__(f"conversão de '{source}' terminou com status '{status}'")
        self.source = source
        self.status = status


@dataclass(frozen=True, slots=True, kw_only=True)
class ConvertOptions:
    """Opções da conversão de PDF.

    Attributes:
        artifacts_path: Diretório com os modelos pré-baixados (``docling-tools models
            download``). ``None`` deixa o Docling baixar os modelos na primeira execução.
        ocr: Liga o OCR; só deve ser usado quando o manifesto da fonte pede (``ocr: true``).
        document_timeout: Tempo máximo de conversão, em segundos.

    """

    artifacts_path: Path | None = None
    ocr: bool = False
    document_timeout: float = DEFAULT_DOCUMENT_TIMEOUT_S


@dataclass(frozen=True, slots=True)
class DoclingApi:
    """Símbolos do Docling usados aqui, resolvidos em tempo de execução."""

    version: str
    input_format: Any
    conversion_status: Any
    pdf_pipeline_options: Any
    table_structure_options: Any
    table_former_mode: Any
    document_converter: Any
    pdf_format_option: Any
    image_ref_mode: Any


def _is_docling_module(name: str | None) -> bool:
    return name is not None and name.split(".", 1)[0] in {"docling", "docling_core"}


def load_docling() -> DoclingApi:
    """Importa o Docling sob demanda.

    Raises:
        DoclingNotInstalledError: se o extra ``docling`` não estiver instalado.

    """
    try:
        base_models = importlib.import_module("docling.datamodel.base_models")
        pipeline_options = importlib.import_module("docling.datamodel.pipeline_options")
        document_converter = importlib.import_module("docling.document_converter")
        doc_types = importlib.import_module("docling_core.types.doc")
        docling_version = package_version("docling")
    except PackageNotFoundError as exc:  # subclasse de ModuleNotFoundError: vem antes
        raise DoclingNotInstalledError from exc
    except ModuleNotFoundError as exc:
        if _is_docling_module(exc.name):
            raise DoclingNotInstalledError from exc
        raise
    return DoclingApi(
        version=docling_version,
        input_format=base_models.InputFormat,
        conversion_status=base_models.ConversionStatus,
        pdf_pipeline_options=pipeline_options.PdfPipelineOptions,
        table_structure_options=pipeline_options.TableStructureOptions,
        table_former_mode=pipeline_options.TableFormerMode,
        document_converter=document_converter.DocumentConverter,
        pdf_format_option=document_converter.PdfFormatOption,
        image_ref_mode=doc_types.ImageRefMode,
    )


def installed_docling_version() -> str | None:
    """Versão do ``docling`` instalada, ou ``None`` se o extra não estiver presente."""
    try:
        return package_version("docling")
    except PackageNotFoundError:
        return None


def build_converter(api: DoclingApi, options: ConvertOptions) -> Any:  # noqa: ANN401 - objeto do Docling
    """Monta o ``DocumentConverter`` com o pipeline de PDF do plano.

    Tabelas em modo ``ACCURATE`` com cell matching, OCR desligado por padrão, timeout por
    documento e serviços remotos sempre desligados (o job não acessa a rede, exceto para
    baixar modelos quando ``artifacts_path`` não é informado).
    """
    pipeline = api.pdf_pipeline_options(
        artifacts_path=options.artifacts_path,
        do_ocr=options.ocr,
        do_table_structure=True,
        table_structure_options=api.table_structure_options(
            mode=api.table_former_mode.ACCURATE,
            do_cell_matching=True,
        ),
        document_timeout=options.document_timeout,
        enable_remote_services=False,
    )
    return api.document_converter(
        format_options={api.input_format.PDF: api.pdf_format_option(pipeline_options=pipeline)},
    )


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _confined_options(options: ConvertOptions, root: Path) -> ConvertOptions:
    if options.artifacts_path is None:
        return options
    artifacts = resolve_dir(options.artifacts_path, root=root, must_exist=True)
    return replace(options, artifacts_path=artifacts)


def convert_document(  # noqa: PLR0913 - todos são keyword-only e explícitos
    source: Path,
    *,
    root: Path,
    source_id: str,
    url: str,
    out_root: Path,
    options: ConvertOptions | None = None,
    api: DoclingApi | None = None,
    now: Callable[[], datetime] = _utc_now,
) -> ExtractionManifest:
    """Converte ``source`` e grava ``out_root/<sha256>/{docling.json, manifest.json}``.

    Args:
        source: Arquivo baixado pelo Node (PDF, XLSX etc.).
        root: Raiz permitida: ``source``, ``out_root`` e ``options.artifacts_path`` precisam
            ficar dentro dela; caminhos relativos são interpretados a partir dela.
        source_id: Identificador da fonte em ``corpus/sources.yaml``.
        url: URL de origem do arquivo.
        out_root: Diretório raiz da saída (``out/``).
        options: Opções do pipeline; o padrão segue o plano (sem OCR, timeout de 1 h).
        api: Símbolos do Docling; ``None`` importa o Docling instalado.
        now: Relógio injetável (testes).

    Returns:
        O manifesto gravado.

    Raises:
        UnsafePathError: se algum caminho sair de ``root`` ou não for do tipo esperado.
        DoclingNotInstalledError: se o extra ``docling`` não estiver instalado.
        ConversionFailedError: se o status não for ``SUCCESS`` (inclui ``PARTIAL_SUCCESS``
            por timeout, que deixaria o corpus incompleto).

    """
    safe_source = resolve_file(source, root=root)
    safe_out_root = resolve_dir(out_root, root=root)
    safe_options = _confined_options(options or ConvertOptions(), root)
    docling = api if api is not None else load_docling()
    digest = sha256_file(safe_source, root=root)
    # Valida os metadados antes da conversão, que pode levar horas.
    manifest = ExtractionManifest(
        source_id=source_id,
        url=url,
        sha256=digest,
        docling_version=docling.version,
        created_at=now(),
        output_path=f"{digest}/{DOCLING_JSON}",
    )

    converter = build_converter(docling, safe_options)
    result = converter.convert(safe_source)
    if result.status != docling.conversion_status.SUCCESS:
        status = str(getattr(result.status, "value", result.status))
        raise ConversionFailedError(safe_source, status)

    out_dir = safe_out_root / digest
    out_dir.mkdir(parents=True, exist_ok=True)
    result.document.save_as_json(
        out_dir / DOCLING_JSON,
        image_mode=docling.image_ref_mode.PLACEHOLDER,
    )
    manifest = replace(manifest, created_at=now())
    manifest.write(out_dir / MANIFEST_JSON)
    return manifest
