"""Manifesto de uma extração Docling (``out/<sha256>/manifest.json``).

O manifesto é o contrato entre este job e o pipeline Node: identifica a fonte do corpus, o
arquivo exato que foi convertido (sha256), a versão do Docling usada e onde ficou a saída.
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
"""Versão do formato do manifesto; muda quando um campo muda de significado."""

_SHA256_RE: Final = re.compile(r"[0-9a-f]{64}")
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
    },
)


class ManifestError(ValueError):
    """O manifesto (ou o JSON de origem) é inválido."""


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
        schema_version: Versão do formato do manifesto.

    """

    source_id: str
    url: str
    sha256: str
    docling_version: str
    created_at: datetime
    output_path: str
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
        if self.created_at.utcoffset() is None:
            msg = "created_at deve ter fuso horário"
            raise ManifestError(msg)
        _validate_output_path(self.output_path)
        # A dataclass é congelada; a normalização acontece uma única vez, na construção.
        object.__setattr__(self, "created_at", self.created_at.astimezone(UTC))

    def to_dict(self) -> dict[str, str | int]:
        """Converte para um dicionário serializável em JSON."""
        return {
            "schema_version": self.schema_version,
            "source_id": self.source_id,
            "url": self.url,
            "sha256": self.sha256,
            "docling_version": self.docling_version,
            "created_at": self.created_at.isoformat(),
            "output_path": self.output_path,
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
        return cls(
            schema_version=schema_version,
            source_id=_require_str(data, "source_id"),
            url=_require_str(data, "url"),
            sha256=_require_str(data, "sha256"),
            docling_version=_require_str(data, "docling_version"),
            created_at=created_at,
            output_path=_require_str(data, "output_path"),
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
