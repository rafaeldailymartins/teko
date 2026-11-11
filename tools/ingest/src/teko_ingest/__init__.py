"""Job Python da ingestão do Tekó: extrai documentos do corpus com o Docling.

O Node (``apps/api``) faz download, chunking, embeddings e escrita no banco. Este pacote só
converte cada documento em ``out/<sha256>/{docling.json, manifest.json}``.
"""

from teko_ingest.convert import (
    ConversionFailedError,
    ConvertOptions,
    DoclingNotInstalledError,
    convert_document,
)
from teko_ingest.manifest import ExtractionManifest, ManifestError, sha256_file

__all__ = [
    "ConversionFailedError",
    "ConvertOptions",
    "DoclingNotInstalledError",
    "ExtractionManifest",
    "ManifestError",
    "convert_document",
    "sha256_file",
]
