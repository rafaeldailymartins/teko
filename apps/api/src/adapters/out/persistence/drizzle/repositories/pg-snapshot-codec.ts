import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { createZstdCompress, createZstdDecompress } from 'node:zlib'
import {
  type EncodedTable,
  isSnapshotRow,
  type SnapshotCodec,
  type SnapshotRow,
} from '#app/ports/snapshot-repository.ts'

/**
 * Formato dos arquivos do snapshot: JSON Lines (uma linha do Postgres por linha, na forma que o
 * `pg-snapshot-repository` lê e grava: datas, ranges e `halfvec` como texto canônico do Postgres)
 * comprimido com zstd pelo `node:zlib` do Node 24 (estabilidade 1, experimental; o formato zstd em
 * si é estável), sem dependência nova. Compressão e descompressão em streaming, para que o arquivo
 * de chunks (o maior, por causa dos embeddings) nunca vire uma string única em memória.
 */

const DECODE_BATCH_ROWS = 500

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function encode(batches: AsyncIterable<readonly SnapshotRow[]>): Promise<EncodedTable> {
  const zstd = createZstdCompress()
  const parts: Buffer[] = []
  zstd.on('data', (chunk: Buffer) => {
    parts.push(chunk)
  })
  const done = finished(zstd)
  let rows = 0
  for await (const batch of batches) {
    if (batch.length === 0) {
      continue
    }
    rows += batch.length
    const text = `${batch.map((row) => JSON.stringify(row)).join('\n')}\n`
    if (!zstd.write(text)) {
      await new Promise<void>((resolve) => {
        zstd.once('drain', resolve)
      })
    }
  }
  zstd.end()
  await done
  const data = new Uint8Array(Buffer.concat(parts))
  return { data, rows, sha256: sha256Hex(data) }
}

function parseLine(line: string): SnapshotRow {
  const value: unknown = JSON.parse(line)
  if (!isSnapshotRow(value)) {
    throw new SyntaxError('linha do snapshot não é um objeto JSON')
  }
  return value
}

async function* decode(data: Uint8Array): AsyncGenerator<SnapshotRow[]> {
  const decoder = new StringDecoder('utf8')
  const stream: AsyncIterable<unknown> = Readable.from([Buffer.from(data)]).pipe(
    createZstdDecompress(),
  )
  let pending = ''
  let batch: SnapshotRow[] = []
  for await (const chunk of stream) {
    pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (line.length > 0) {
        batch.push(parseLine(line))
      }
      if (batch.length >= DECODE_BATCH_ROWS) {
        yield batch
        batch = []
      }
      newline = pending.indexOf('\n')
    }
  }
  pending += decoder.end()
  if (pending.trim().length > 0) {
    batch.push(parseLine(pending))
  }
  if (batch.length > 0) {
    yield batch
  }
}

export const snapshotCodec: SnapshotCodec = { encode, decode, sha256: sha256Hex }
