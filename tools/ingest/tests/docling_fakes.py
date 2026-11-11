"""Dublês do Docling para testar a conversão sem instalar o extra (torch, modelos)."""

import json
import types
from dataclasses import dataclass, field
from enum import StrEnum
from importlib.metadata import PackageNotFoundError
from pathlib import Path
from typing import Any

from teko_ingest.convert import DoclingApi


class FakeInputFormat(StrEnum):
    PDF = "pdf"


class FakeConversionStatus(StrEnum):
    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"


class FakeTableFormerMode(StrEnum):
    FAST = "fast"
    ACCURATE = "accurate"


class FakeImageRefMode(StrEnum):
    PLACEHOLDER = "placeholder"
    EMBEDDED = "embedded"


@dataclass
class FakeOptions:
    """Registra os kwargs recebidos, como os modelos pydantic do Docling."""

    kwargs: dict[str, Any]


def fake_options(**kwargs: Any) -> FakeOptions:  # noqa: ANN401
    return FakeOptions(kwargs)


@dataclass
class FakeDocument:
    saved: list[tuple[Path, Any]] = field(default_factory=lambda: [])  # noqa: PIE807

    def save_as_json(self, filename: Path, *, image_mode: Any) -> None:  # noqa: ANN401
        self.saved.append((filename, image_mode))
        filename.write_text(json.dumps({"schema_name": "DoclingDocument"}), encoding="utf-8")


@dataclass
class FakeResult:
    status: FakeConversionStatus
    document: FakeDocument


@dataclass
class FakeConverter:
    format_options: dict[Any, Any]
    status: FakeConversionStatus = FakeConversionStatus.SUCCESS
    document: FakeDocument = field(default_factory=FakeDocument)
    converted: list[Path] = field(default_factory=lambda: [])  # noqa: PIE807

    def convert(self, source: Path) -> FakeResult:
        self.converted.append(source)
        return FakeResult(status=self.status, document=self.document)


@dataclass
class ConverterFactory:
    status: FakeConversionStatus = FakeConversionStatus.SUCCESS
    instances: list[FakeConverter] = field(default_factory=lambda: [])  # noqa: PIE807

    def __call__(self, *, format_options: dict[Any, Any]) -> FakeConverter:
        converter = FakeConverter(format_options=format_options, status=self.status)
        self.instances.append(converter)
        return converter


def installed_version(_name: str) -> str:
    """Substitui ``importlib.metadata.version`` como se o Docling estivesse instalado."""
    return "2.146.0"


def missing_version(name: str) -> str:
    """Substitui ``importlib.metadata.version`` como se o Docling não estivesse instalado."""
    raise PackageNotFoundError(name)


def fake_api(factory: ConverterFactory, version: str = "2.146.0") -> DoclingApi:
    return DoclingApi(
        version=version,
        input_format=FakeInputFormat,
        conversion_status=FakeConversionStatus,
        pdf_pipeline_options=fake_options,
        table_structure_options=fake_options,
        table_former_mode=FakeTableFormerMode,
        document_converter=factory,
        pdf_format_option=fake_options,
        image_ref_mode=FakeImageRefMode,
    )


def fake_docling_modules(factory: ConverterFactory) -> dict[str, types.ModuleType]:
    """Módulos com os mesmos caminhos de import do Docling real."""
    base_models = types.ModuleType("docling.datamodel.base_models")
    base_models.__dict__.update(InputFormat=FakeInputFormat, ConversionStatus=FakeConversionStatus)
    pipeline_options = types.ModuleType("docling.datamodel.pipeline_options")
    pipeline_options.__dict__.update(
        PdfPipelineOptions=fake_options,
        TableStructureOptions=fake_options,
        TableFormerMode=FakeTableFormerMode,
    )
    document_converter = types.ModuleType("docling.document_converter")
    document_converter.__dict__.update(DocumentConverter=factory, PdfFormatOption=fake_options)
    doc_types = types.ModuleType("docling_core.types.doc")
    doc_types.__dict__.update(ImageRefMode=FakeImageRefMode)
    return {
        "docling": types.ModuleType("docling"),
        "docling.datamodel": types.ModuleType("docling.datamodel"),
        "docling.datamodel.base_models": base_models,
        "docling.datamodel.pipeline_options": pipeline_options,
        "docling.document_converter": document_converter,
        "docling_core": types.ModuleType("docling_core"),
        "docling_core.types": types.ModuleType("docling_core.types"),
        "docling_core.types.doc": doc_types,
    }
