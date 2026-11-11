import hashlib
import os
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from teko_ingest.manifest import sha256_file
from teko_ingest.paths import UnsafePathError, resolve_dir, resolve_file, resolve_root

# Segmentos portáveis: só minúsculas/dígitos (o NTFS não diferencia caixa) e prefixo fixo, que
# afasta nomes reservados do Windows (con, nul, aux, com1...) e os especiais '.' e '..'.
_segment = st.from_regex(r"[a-z0-9_-]{1,12}", fullmatch=True).map(lambda value: f"d{value}")
_segments = st.lists(_segment, min_size=1, max_size=4)


@pytest.fixture
def layout(tmp_path: Path) -> tuple[Path, Path]:
    """``tmp/root`` (raiz permitida) e ``tmp/outside.bin`` (fora dela)."""
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"segredo")
    return root, outside


def _symlink_or_skip(link: Path, target: Path, *, target_is_directory: bool = False) -> None:
    try:
        link.symlink_to(target, target_is_directory=target_is_directory)
    except (OSError, NotImplementedError) as exc:  # Windows sem modo desenvolvedor/privilégio
        if sys.platform == "win32" and target_is_directory:
            # Junção NTFS: não exige privilégio e o Path.resolve também a segue.
            import _winapi  # noqa: PLC0415 - só existe no Windows

            _winapi.CreateJunction(str(target), str(link))
            return
        pytest.skip(f"symlink indisponível nesta plataforma: {exc}")


@settings(max_examples=40, deadline=None)
@given(segments=_segments)
def test_valid_nested_path_is_accepted(
    tmp_path_factory: pytest.TempPathFactory,
    segments: list[str],
) -> None:
    root = tmp_path_factory.mktemp("root")
    nested = root.joinpath(*segments)
    nested.mkdir(parents=True, exist_ok=True)
    target = nested / "doc.pdf"
    target.write_bytes(b"%PDF")

    resolved = resolve_file(Path(*segments, "doc.pdf"), root=root)

    assert resolved == target.resolve(strict=True)
    assert resolved.is_relative_to(root.resolve())
    assert sha256_file(Path(*segments, "doc.pdf"), root=root) == hashlib.sha256(b"%PDF").hexdigest()


@settings(max_examples=40, deadline=None)
@given(segments=_segments, extra_ups=st.integers(min_value=0, max_value=3))
def test_dotdot_escape_is_rejected(
    tmp_path_factory: pytest.TempPathFactory,
    segments: list[str],
    extra_ups: int,
) -> None:
    base = tmp_path_factory.mktemp("escape")
    root = base / "root"
    root.joinpath(*segments).mkdir(parents=True)
    (base / "outside.bin").write_bytes(b"segredo")
    # Sobe os segmentos criados, sai da raiz e (opcionalmente) continua subindo.
    ups = [".."] * (len(segments) + 1 + extra_ups)
    escape = Path(*segments, *ups, "outside.bin")

    with pytest.raises(UnsafePathError):
        resolve_file(escape, root=root)
    with pytest.raises(UnsafePathError):
        sha256_file(escape, root=root)


def test_dotdot_escape_to_existing_file_reports_root(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_file(Path("..", "outside.bin"), root=root)


def test_dotdot_that_stays_inside_root_is_accepted(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    (root / "sub").mkdir()
    (root / "doc.pdf").write_bytes(b"%PDF")
    assert resolve_file(Path("sub", "..", "doc.pdf"), root=root) == (root / "doc.pdf").resolve()


def test_absolute_path_outside_root_is_rejected(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_file(outside.resolve(), root=root)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        sha256_file(outside.resolve(), root=root)


def test_absolute_path_inside_root_is_accepted(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    target = root / "doc.pdf"
    target.write_bytes(b"%PDF")
    assert resolve_file(target.resolve(), root=root) == target.resolve()


def test_sibling_with_root_name_as_prefix_is_rejected(tmp_path: Path) -> None:
    # 'root-evil' começa com 'root' como string, mas não está dentro de 'root'.
    root = tmp_path / "root"
    root.mkdir()
    sibling = tmp_path / "root-evil"
    sibling.mkdir()
    (sibling / "doc.pdf").write_bytes(b"%PDF")
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_file(Path("..", "root-evil", "doc.pdf"), root=root)


def test_symlink_escaping_root_is_rejected(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    link = root / "atalho.pdf"
    _symlink_or_skip(link, outside)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_file(Path("atalho.pdf"), root=root)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        sha256_file(Path("atalho.pdf"), root=root)


def test_directory_symlink_escaping_root_is_rejected(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    link = root / "pasta"
    _symlink_or_skip(link, outside.parent, target_is_directory=True)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_file(Path("pasta", "outside.bin"), root=root)


def test_symlink_inside_root_is_followed(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    target = root / "doc.pdf"
    target.write_bytes(b"%PDF")
    link = root / "atalho.pdf"
    _symlink_or_skip(link, target)
    assert resolve_file(Path("atalho.pdf"), root=root) == target.resolve()


def test_missing_file_is_rejected(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    with pytest.raises(UnsafePathError, match="arquivo não encontrado"):
        resolve_file(Path("nao-existe.pdf"), root=root)


def test_directory_is_not_a_regular_file(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    (root / "pasta").mkdir()
    with pytest.raises(UnsafePathError, match="arquivo regular"):
        resolve_file(Path("pasta"), root=root)
    with pytest.raises(UnsafePathError, match="arquivo regular"):
        resolve_file(Path(), root=root)


def test_fifo_is_not_a_regular_file(layout: tuple[Path, Path]) -> None:
    if sys.platform == "win32":
        pytest.skip("FIFO só existe em POSIX")
    root, _ = layout
    os.mkfifo(root / "fila")
    with pytest.raises(UnsafePathError, match="arquivo regular"):
        resolve_file(Path("fila"), root=root)


def test_root_must_exist_and_be_a_directory(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    with pytest.raises(UnsafePathError, match="raiz não encontrada"):
        resolve_root(root / "nao-existe")
    with pytest.raises(UnsafePathError, match="não é um diretório"):
        resolve_root(outside)
    assert resolve_root(root) == root.resolve()


def test_relative_root_is_resolved_against_cwd(
    layout: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, _ = layout
    (root / "doc.pdf").write_bytes(b"%PDF")
    monkeypatch.chdir(root.parent)
    assert resolve_file(Path("doc.pdf"), root=Path("root")) == (root / "doc.pdf").resolve()


def test_resolve_dir_accepts_missing_dir_inside_root(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    assert resolve_dir(Path("out", "novo"), root=root) == root.resolve() / "out" / "novo"


def test_resolve_dir_rejects_escape_and_files(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_dir(Path("..", "out"), root=root)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_dir(outside.parent, root=root)
    (root / "arquivo").write_bytes(b"")
    with pytest.raises(UnsafePathError, match="não é um diretório"):
        resolve_dir(Path("arquivo"), root=root)


def test_resolve_dir_must_exist_when_required(layout: tuple[Path, Path]) -> None:
    root, _ = layout
    with pytest.raises(UnsafePathError, match="diretório não encontrado"):
        resolve_dir(Path("modelos"), root=root, must_exist=True)
    (root / "modelos").mkdir()
    assert resolve_dir(Path("modelos"), root=root, must_exist=True) == (root / "modelos").resolve()


def test_resolve_dir_rejects_symlink_escaping_root(layout: tuple[Path, Path]) -> None:
    root, outside = layout
    _symlink_or_skip(root / "saida", outside.parent, target_is_directory=True)
    with pytest.raises(UnsafePathError, match="fora da raiz"):
        resolve_dir(Path("saida", "novo"), root=root)
