import { createHash } from 'node:crypto'
import type { ContentHasher } from '#app/ports/content-hasher.ts'
import { normalizeForHash } from '#domain/corpus/text-normalization.ts'

/** `content_hash = sha256(normalizeForHash(texto))`, em hexadecimal minúsculo. */
export const sha256ContentHasher: ContentHasher = {
  hash: (text) => createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex'),
}
