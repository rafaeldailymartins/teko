"""Manifesto de uma extração Docling (``out/<saída>/manifest.json``).

O manifesto é o contrato entre este job e o pipeline Node: identifica a fonte do corpus, o
arquivo exato que foi convertido (sha256), a versão do Docling usada, onde ficou a saída e, para
documentos longos divididos por ``page_range``, qual parte (intervalo de páginas) foi convertida.
O diretório da saída é ``<sha256>`` para o documento inteiro e ``<sha256>-p<início>-<fim>`` para
uma parte (ver :func:`output_dir_name`).
"""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Final, Self, cast
from urllib.parse import urlsplit

from teko_ingest.paths import resolve_file

MANIFEST_SCHEMA_VERSION: Final = 1
"""Versão do formato do manifesto; muda quando um campo muda de significado.

``page_range`` e ``part`` foram acrescentados na F3 sem mudar a versão: são opcionais na leitura
(ausentes = documento inteiro) e sempre gravados (``null`` para o documento inteiro).
"""

EXTRACTOR_REVISION: Final = 1
"""Revisão do extrator (versão do Docling e configuração deste pacote), gravada no manifesto.

Análoga à revisão do parser (ADR 0026): sobe quando a saída do Docling para o mesmo PDF muda
(``docling`` novo no ``uv.lock``, TableFormer, OCR, opções do pipeline em ``convert.py``). O
pipeline Node põe a revisão na chave do store ``corpus-docling`` (``EXTRACTOR_REVISION`` em
``apps/api/src/adapters/in/cli/ingest/blob-keys.ts``, que tem de ser igual): uma revisão nova faz o
``discover`` pedir a reextração. A revisão 1 é a chave sem sufixo, a de antes da revisão existir.
"""

EXTRACTOR_DOCLING_VERSION: Final = "2.146.0"
"""Versão do ``docling`` coberta por :data:`EXTRACTOR_REVISION` (conferida contra o ``uv.lock``)."""

_SHA256_RE: Final = re.compile(r"[0-9a-f]{64}")
_PAGE_RANGE_RE: Final = re.compile(r"([0-9]+)-([0-9]+)")
_ALLOWED_URL_SCHEMES: Final = frozenset({"http", "https"})
_FIELDS: Final = frozenset(
    {
        "schema_version",
        "source_id",
        "url",
        "sha256",
        "docling_version",
        "created_at",
        "output_path",
        "page_range",
        "part",
        "extractor_revision",
    },
)
_PAGE_RANGE_SHAPE: Final = "campo 'page_range' deve ser null ou [início, fim]"


class ManifestError(ValueError):
    """O manifesto (ou o JSON de origem) é inválido."""


@dataclass(frozen=True, slots=True)
class PageRange:
    """Intervalo de páginas fechado e com base 1 (o ``page_range`` do Docling).

    Attributes:
        start: Primeira página convertida (>= 1).
        end: Última página convertida (>= ``start``).

    """

    start: int
    end: int

    def __post_init__(self) -> None:
        """Valida os limites."""
        if type(self.start) is not int or type(self.end) is not int:
            msg = "page_range deve ter dois inteiros"
            raise ManifestError(msg)
        if self.start < 1 or self.end < self.start:
            msg = f"page_range inválido: {self.start}-{self.end} (início >= 1 e fim >= início)"
            raise ManifestError(msg)

    @property
    def part(self) -> str:
        """Rótulo da parte, usado no nome da saída e do artifact (``p<início>-<fim>``)."""
        return f"p{self.start}-{self.end}"

    def as_tuple(self) -> tuple[int, int]:
        """Tupla ``(início, fim)`` no formato aceito por ``DocumentConverter.convert``."""
        return (self.start, self.end)

    @classmethod
    def parse(cls, text: str) -> Self:
        """Lê ``"<início>-<fim>"`` (ex.: ``"1-120"``).

        Raises:
            ManifestError: se o texto não tiver o formato ou os limites forem inválidos.

        """
        match = _PAGE_RANGE_RE.fullmatch(text.strip())
        if match is None:
            msg = f"page_range deve ter o formato <início>-<fim>: {text!r}"
            raise ManifestError(msg)
        return cls(int(match.group(1)), int(match.group(2)))


def output_dir_name(digest: str, page_range: PageRange | None) -> str:
    """Nome do diretório da saída: ``<sha256>`` ou ``<sha256>-p<início>-<fim>``."""
    return digest if page_range is None else f"{digest}-{page_range.part}"


def sha256_file(path: Path, *, root: Path) -> str:
    """Calcula o sha256 (hex minúsculo) de um arquivo dentro de ``root``, lendo em blocos.

    Args:
        path: Arquivo a ler; se relativo, é interpretado a partir de ``root``.
        root: Raiz permitida (ver :mod:`teko_ingest.paths`).

    Raises:
        UnsafePathError: se ``path`` não for um arquivo regular dentro de ``root``.

    """
    safe = resolve_file(path, root=root)
    with safe.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _require_str(data: Mapping[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        msg = f"campo '{key}' deve ser string"
        raise ManifestError(msg)
    return value


def _parse_page_range(value: object) -> PageRange | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ManifestError(_PAGE_RANGE_SHAPE)
    items = cast("list[object]", value)
    if len(items) != 2:  # noqa: PLR2004 - par início/fim
        raise ManifestError(_PAGE_RANGE_SHAPE)
    start, end = items
    if type(start) is not int or type(end) is not int:
        msg = "page_range deve ter dois inteiros"
        raise ManifestError(msg)
    return PageRange(start, end)


def _validate_output_path(value: str) -> None:
    if not value:
        msg = "output_path não pode ser vazio"
        raise ManifestError(msg)
    if "\\" in value:
        msg = "output_path deve usar '/' como separador"
        raise ManifestError(msg)
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        msg = "output_path deve ser relativo ao diretório de saída e sem '..'"
        raise ManifestError(msg)


@dataclass(frozen=True, slots=True, kw_only=True)
class ExtractionManifest:
    """Descreve uma saída do Docling para um arquivo do corpus.

    Attributes:
        source_id: Identificador da fonte em ``corpus/sources.yaml``.
        url: URL ``http(s)`` de onde o arquivo foi baixado.
        sha256: Hash do arquivo de entrada (hex minúsculo, 64 caracteres).
        docling_version: Versão do pacote ``docling`` que produziu a saída.
        created_at: Instante da extração, com fuso; é normalizado para UTC.
        output_path: Caminho POSIX da saída, relativo ao diretório ``out/``.
        page_range: Páginas convertidas quando o documento foi dividido; ``None`` = inteiro.
        extractor_revision: Revisão do extrator (:data:`EXTRACTOR_REVISION`); ausente na leitura
            de um manifesto anterior a ela = 1.
        schema_version: Versão do formato do manifesto.

    """

    source_id: str
    url: str
    sha256: str
    docling_version: str
    created_at: datetime
    output_path: str
    page_range: PageRange | None = None
    extractor_revision: int = EXTRACTOR_REVISION
    schema_version: int = field(default=MANIFEST_SCHEMA_VERSION)

    def __post_init__(self) -> None:
        """Valida os campos e normaliza ``created_at`` para UTC."""
        if self.schema_version != MANIFEST_SCHEMA_VERSION:
            msg = f"schema_version {self.schema_version} não suportada"
            raise ManifestError(msg)
        if not self.source_id.strip():
            msg = "source_id não pode ser vazio"
            raise ManifestError(msg)
        parts = urlsplit(self.url)
        if parts.scheme not in _ALLOWED_URL_SCHEMES or not parts.netloc:
            msg = f"url deve ser http(s) absoluta: {self.url!r}"
            raise ManifestError(msg)
        if _SHA256_RE.fullmatch(self.sha256) is None:
            msg = "sha256 deve ter 64 caracteres hexadecimais minúsculos"
            raise ManifestError(msg)
        if not self.docling_version.strip():
            msg = "docling_version não pode ser vazio"
            raise ManifestError(msg)
        if type(self.extractor_revision) is not int or self.extractor_revision < 1:
            msg = "extractor_revision deve ser um inteiro >= 1"
            raise ManifestError(msg)
        if self.created_at.utcoffset() is None:
            msg = "created_at deve ter fuso horário"
            raise ManifestError(msg)
        _validate_output_path(self.output_path)
        # A dataclass é congelada; a normalização acontece uma única vez, na construção.
        object.__setattr__(self, "created_at", self.created_at.astimezone(UTC))

    @property
    def part(self) -> str | None:
        """Rótulo da parte (``p<início>-<fim>``), ou ``None`` para o documento inteiro."""
        return None if self.page_range is None else self.page_range.part

    def to_dict(self) -> dict[str, str | int | list[int] | None]:
        """Converte para um dicionário serializável em JSON."""
        return {
            "schema_version": self.schema_version,
            "source_id": self.source_id,
            "url": self.url,
            "sha256": self.sha256,
            "docling_version": self.docling_version,
            "created_at": self.created_at.isoformat(),
            "output_path": self.output_path,
            "page_range": None if self.page_range is None else list(self.page_range.as_tuple()),
            "part": self.part,
            "extractor_revision": self.extractor_revision,
        }

    def to_json(self) -> str:
        """Serializa em JSON determinístico (chaves ordenadas, UTF-8, LF final)."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> Self:
        """Reconstrói o manifesto a partir de um dicionário, rejeitando campos desconhecidos."""
        unknown = set(data) - _FIELDS
        if unknown:
            msg = f"campos desconhecidos: {sorted(unknown)}"
            raise ManifestError(msg)
        schema_version = data.get("schema_version")
        if type(schema_version) is not int:
            msg = "campo 'schema_version' deve ser inteiro"
            raise ManifestError(msg)
        raw_created_at = _require_str(data, "created_at")
        try:
            created_at = datetime.fromisoformat(raw_created_at)
        except ValueError as exc:
            msg = f"created_at não é ISO 8601: {raw_created_at!r}"
            raise ManifestError(msg) from exc
        page_range = _parse_page_range(data.get("page_range"))
        expected_part = None if page_range is None else page_range.part
        if data.get("part") != expected_part:
            msg = f"campo 'part' deve ser {expected_part!r}, coerente com page_range"
            raise ManifestError(msg)
        extractor_revision = data.get("extractor_revision", 1)
        if type(extractor_revision) is not int:
            msg = "campo 'extractor_revision' deve ser inteiro"
            raise ManifestError(msg)
        return cls(
            schema_version=schema_version,
            source_id=_require_str(data, "source_id"),
            url=_require_str(data, "url"),
            sha256=_require_str(data, "sha256"),
            docling_version=_require_str(data, "docling_version"),
            created_at=created_at,
            output_path=_require_str(data, "output_path"),
            page_range=page_range,
            extractor_revision=extractor_revision,
        )

    @classmethod
    def from_json(cls, text: str) -> Self:
        """Lê um manifesto serializado por :meth:`to_json`."""
        try:
            data: object = json.loads(text)
        except json.JSONDecodeError as exc:
            msg = "manifesto não é JSON válido"
            raise ManifestError(msg) from exc
        if not isinstance(data, dict):
            msg = "manifesto deve ser um objeto JSON"
            raise ManifestError(msg)
        # json.loads só produz chaves string em objetos.
        return cls.from_dict(cast("dict[str, object]", data))

    def write(self, path: Path) -> None:
        """Grava o manifesto em ``path`` (UTF-8, LF)."""
        path.write_text(self.to_json(), encoding="utf-8", newline="\n")
