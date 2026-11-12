import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { SnapshotRow } from '#app/ports/snapshot-repository.ts'
import { sha256Hex, snapshotCodec } from './pg-snapshot-codec.ts'

async function* batches(...groups: SnapshotRow[][]): AsyncGenerator<SnapshotRow[]> {
  for (const group of groups) {
    yield group
  }
}

async function decodeAll(data: Uint8Array): Promise<SnapshotRow[][]> {
  const out: SnapshotRow[][] = []
  for await (const batch of snapshotCodec.decode(data)) {
    out.push(batch)
  }
  return out
}

describe('snapshotCodec', () => {
  it('ida e volta em JSON Lines com zstd, com contagem e sha256 do arquivo', async () => {
    const rows: SnapshotRow[] = [
      { id: 'a', texto: 'Redação com acentuação: ç, ã, é e “aspas”', n: 1, ok: true, nada: null },
      { id: 'b', structured: { lista: [1, 'dois', null] }, embedding: '[0.5,-0.25]' },
    ]
    const encoded = await snapshotCodec.encode(
      batches([rows[0] as SnapshotRow], [], [rows[1] as SnapshotRow]),
    )
    expect(encoded.rows).toBe(2)
    expect(encoded.sha256).toBe(sha256Hex(encoded.data))
    expect(snapshotCodec.sha256(encoded.data)).toMatch(/^[0-9a-f]{64}$/)
    expect((await decodeAll(encoded.data)).flat()).toEqual(rows)
  })

  it('arquivo vazio vira zero lotes', async () => {
    const encoded = await snapshotCodec.encode(batches())
    expect(encoded.rows).toBe(0)
    expect(await decodeAll(encoded.data)).toEqual([])
  })

  it('divide a leitura em lotes e aceita a última linha sem quebra', async () => {
    const lines = Array.from({ length: 1201 }, (_, index) => JSON.stringify({ i: index })).join(
      '\n',
    )
    const decoded = await decodeAll(new Uint8Array(zstdCompressSync(Buffer.from(lines))))
    expect(decoded.map((batch) => batch.length)).toEqual([500, 500, 201])
    expect(decoded.at(-1)?.at(-1)).toEqual({ i: 1200 })
  })

  it('recusa linha que não é objeto', async () => {
    await expect(
      decodeAll(new Uint8Array(zstdCompressSync(Buffer.from('[1,2]\n')))),
    ).rejects.toThrow(SyntaxError)
  })

  it('aguenta pressão de escrita (drain) com um arquivo grande', async () => {
    const big = Array.from({ length: 4000 }, (_, index) => ({
      i: index,
      pad: 'x'.repeat(200) + String(index),
    }))
    const encoded = await snapshotCodec.encode(batches(big.slice(0, 2000), big.slice(2000)))
    expect(encoded.rows).toBe(4000)
    expect((await decodeAll(encoded.data)).flat()).toHaveLength(4000)
  })
})
