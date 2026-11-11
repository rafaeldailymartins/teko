"""Confinamento dos caminhos recebidos pela CLI a uma raiz permitida.

Os caminhos chegam por argumentos de linha de comando, que podem vir de um agente (LLM) ou de
outro processo sem validação. Todo arquivo lido e todo diretório usado pelo job precisa ficar
dentro de uma raiz explícita (por padrão, o diretório atual).

A verificação é feita sobre o caminho **resolvido** (``Path.resolve``): ``..`` e links
simbólicos são seguidos antes da comparação, de modo que um link dentro da raiz que aponta para
fora dela é rejeitado. A comparação usa :meth:`pathlib.PurePath.is_relative_to`, que compara
componentes (``/raiz-mal`` não está dentro de ``/raiz``) e respeita a regra de caixa da
plataforma.

Caminhos relativos são interpretados a partir da raiz, não do diretório atual.
"""

from pathlib import Path


class UnsafePathError(ValueError):
    """O caminho não existe, sai da raiz permitida ou não é do tipo esperado."""


def resolve_root(root: Path) -> Path:
    """Resolve a raiz permitida, que precisa existir e ser um diretório.

    Raises:
        UnsafePathError: se a raiz não existir ou não for um diretório.

    """
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:  # inexistente, sem permissão ou laço de links
        msg = f"raiz não encontrada: {root}"
        raise UnsafePathError(msg) from exc
    if not resolved.is_dir():
        msg = f"raiz não é um diretório: {root}"
        raise UnsafePathError(msg)
    return resolved


def _confine(candidate: Path, base: Path, resolved: Path) -> Path:
    if not resolved.is_relative_to(base):
        msg = f"caminho fora da raiz permitida ({base}): {candidate}"
        raise UnsafePathError(msg)
    return resolved


def resolve_file(candidate: Path, *, root: Path) -> Path:
    """Resolve ``candidate`` e garante que é um arquivo regular dentro de ``root``.

    Args:
        candidate: Caminho do arquivo; se relativo, é interpretado a partir de ``root``.
        root: Raiz permitida; se relativa, é interpretada a partir do diretório atual.

    Returns:
        O caminho absoluto, sem ``..`` nem links simbólicos.

    Raises:
        UnsafePathError: se o arquivo não existir, sair da raiz (inclusive por link simbólico)
            ou não for um arquivo regular (diretório, FIFO, dispositivo).

    """
    base = resolve_root(root)
    try:
        resolved = (base / candidate).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        msg = f"arquivo não encontrado: {candidate}"
        raise UnsafePathError(msg) from exc
    safe = _confine(candidate, base, resolved)
    if not safe.is_file():
        msg = f"não é um arquivo regular: {candidate}"
        raise UnsafePathError(msg)
    return safe


def resolve_dir(candidate: Path, *, root: Path, must_exist: bool = False) -> Path:
    """Resolve ``candidate`` e garante que é um diretório dentro de ``root``.

    Args:
        candidate: Caminho do diretório; se relativo, é interpretado a partir de ``root``.
        root: Raiz permitida; se relativa, é interpretada a partir do diretório atual.
        must_exist: Exige que o diretório já exista (entrada); ``False`` aceita um diretório
            de saída ainda não criado.

    Returns:
        O caminho absoluto, com os links simbólicos da parte existente resolvidos.

    Raises:
        UnsafePathError: se o diretório sair da raiz (inclusive por link simbólico), existir
            como algo que não é diretório ou não existir quando ``must_exist`` for verdadeiro.

    """
    base = resolve_root(root)
    try:
        resolved = (base / candidate).resolve(strict=must_exist)
    except (OSError, RuntimeError) as exc:  # inexistente, sem permissão ou laço de links
        msg = f"diretório não encontrado: {candidate}"
        raise UnsafePathError(msg) from exc
    safe = _confine(candidate, base, resolved)
    if safe.exists() and not safe.is_dir():
        msg = f"não é um diretório: {candidate}"
        raise UnsafePathError(msg)
    return safe
