import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { MemoryRecordRow } from "@/types";

// Same discipline as lib/personShape.ts, applied from the start this
// time (that file's bug is the reason this exists on day one instead of
// after a bug report): every response goes through here, converting
// Drizzle's camelCase row to the spec's snake_case MemoryRecord shape AND
// validating it by parsing through the generated Zod schema.
export function toMemoryRecord(row: MemoryRecordRow): MemoryRecord {
  return MemoryRecord.parse({
    id: row.id,
    record_kind: row.recordKind,
    text: row.text,
    category: row.category,
    tier: row.tier,
    status: row.status,
    scope: row.scope,
    person: row.person,
    source: row.source,
    importance: row.importance,
    pinned: row.pinned,
    sensitive: row.sensitive,
    uses: row.uses,
    created_at: row.createdAt,
    last_used_at: row.lastUsedAt,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    expired_at: row.expiredAt,
    superseded_by: row.supersededBy,
    embedding_space: row.embeddingSpace,
  });
}
