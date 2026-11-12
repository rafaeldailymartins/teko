# teko-ingest

Job Python da ingestão do Tekó, a única parte do repositório fora do Node. Converte os
documentos do corpus (PDF, XLSX) com o [Docling](https://github.com/docling-project/docling) e
grava, para cada arquivo:

```
out/<sha256>[-p<início>-<fim>]/
├─ docling.json    # DoclingDocument (imagens como placeholder)
└─ manifest.json   # fonte, URL, sha256, versão do Docling, created_at, caminho da saída, parte
```

Só PDF e XLSX são aceitos (pela extensão, conferida antes da conversão; outro formato termina
com o código `2`). Documentos longos são convertidos por partes com `--page-range <início>-<fim>`
(páginas com base 1, inclusivas; o `page_range` do Docling, aceito pelos backends de PDF e de
XLSX): cada parte grava a própria saída em `<sha256>-p<início>-<fim>/`, e o manifesto registra
`page_range` (`[início, fim]`) e `part` (`p<início>-<fim>`), ambos `null` para o documento
inteiro. O Node junta as partes na ordem de `page_range`. No `ingest.yml`, cada parte vira um
item da matriz do job `extract` e um artifact `docling-<sha256>[-p<início>-<fim>]`.

Download, chunking, embeddings, escrita no banco e upload para o Netlify Blobs ficam com o CLI
do Node (`apps/api/src/adapters/in/cli`). Este job não usa segredos e só acessa a rede para
baixar os modelos do Docling.

## Ambiente

Requer [uv](https://docs.astral.sh/uv/). O uv instala o Python indicado em `.python-version`.

```bash
cd tools/ingest
uv sync --frozen                  # leve: só o pacote e as ferramentas de dev (sem torch)
uv sync --frozen --extra docling  # completo: Docling + torch CPU (índice download.pytorch.org)
```

O extra `docling` puxa o torch do índice CPU do PyTorch (exceto no macOS, que usa o PyPI).

### Maturidade das dependências (7 dias)

O lado Python segue a mesma regra do `minimumReleaseAge: 10080` do pnpm: `[tool.uv]
exclude-newer = "7 days"` faz a resolução ignorar todo artefato enviado ao índice há menos de 7
dias. O valor é relativo, e o `uv.lock` guarda o span (`exclude-newer-span = "P7D"` em
`[options]`). O PyPI e o índice CPU do PyTorch publicam o `upload-time` (PEP 700), então nenhum
pacote ou índice precisa de exceção.

- O corte é recalculado a cada nova resolução. Um `uv lock` sem mudanças no `pyproject.toml`
  mantém as versões travadas, e `uv sync --frozen`/`--locked` não resolvem nada.
- Para subir uma versão, troque o pin `==` por uma versão com mais de 7 dias e rode
  `uv lock --upgrade-package <pacote>`. Um pin mais novo que a janela faz o `uv lock` falhar
  ("no version ... satisfies"), que é o comportamento desejado.
- Correção de segurança urgente dentro da janela: exceção pontual e temporária em
  `[tool.uv] exclude-newer-package = { <pacote> = false }`, removida assim que a versão completar
  7 dias.

## Uso

```bash
# Só o manifesto (sha256 do arquivo), sem converter
uv run teko-ingest manifest guia.pdf --source-id efd-icms-ipi/guia-pratico/3.1.8 \
  --url https://www.gov.br/sped/... --docling-version 2.146.0

# Conversão completa (requer o extra docling)
# (só os modelos usados: layout e TableFormer; o OCR fica desligado)
uv run docling-tools models download --output-dir .cache/docling-models layout tableformer
uv run teko-ingest convert guia.pdf --source-id efd-icms-ipi/guia-pratico/3.1.8 \
  --url https://www.gov.br/sped/... --out out --artifacts-path .cache/docling-models

# Só uma parte de um documento longo (divisão definida no corpus/sources.yaml)
uv run teko-ingest convert guia.pdf --source-id efd-icms-ipi/guia-pratico/3.2.4 \
  --url https://www.gov.br/sped/... --page-range 121-240 --out out \
  --artifacts-path .cache/docling-models
```

Todo caminho recebido pela CLI (o arquivo de entrada, `--out` e `--artifacts-path`) precisa ficar
dentro da raiz `--root`, que por padrão é o diretório atual. A verificação é feita depois de
resolver `..` e links simbólicos, então um link dentro da raiz que aponta para fora dela é
rejeitado; a entrada também precisa ser um arquivo regular. Caminhos relativos são interpretados
a partir da raiz. Caminho fora da raiz termina com o código `2`.

```bash
uv run teko-ingest manifest guia.pdf --root downloads --source-id ... --url ...
```

O pipeline de PDF usa tabelas em modo `ACCURATE` com cell matching, OCR desligado (`--ocr` só
quando a fonte tem `ocr: true` em `corpus/sources.yaml`), timeout de 3600 s por documento e
serviços remotos desligados. Conversão com status diferente de `SUCCESS` (inclusive
`PARTIAL_SUCCESS` por timeout) falha e não grava saída.

Códigos de saída: `0` sucesso, `1` conversão incompleta, `2` entrada inválida, `3` Docling ausente.

## Qualidade

```bash
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run pytest        # cobertura mínima de 85% (branch)
uv run pip-audit
```

Os testes não instalam o Docling: usam dublês com os mesmos caminhos de import
(`tests/docling_fakes.py`).
