import { sqlite } from "@/db";
import { getDeviceId6 } from "@/lib/deviceId";

const PREFIX: Record<"memory" | "entity" | "episode", string> = {
  memory: "mem",
  entity: "ent",
  episode: "ep",
};

// Atomic per-kind counter backing the spec's {prefix}{seq}-{device6} id
// shape (3.1). One transaction: read-or-seed, then increment, so two
// concurrent inserts of the same kind never collide.
const nextSeq = sqlite.transaction((kind: string): number => {
  const row = sqlite
    .query("SELECT next FROM id_sequences WHERE kind = ?")
    .get(kind) as { next: number } | undefined;
  const seq = row?.next ?? 1;
  if (row) {
    sqlite.query("UPDATE id_sequences SET next = ? WHERE kind = ?").run(seq + 1, kind);
  } else {
    sqlite.query("INSERT INTO id_sequences (kind, next) VALUES (?, ?)").run(kind, seq + 1);
  }
  return seq;
});

/** Matches spec/schemas/memory-record.schema.json's `^(mem|ent|ep)[0-9]+-[a-z0-9]{6}$`. */
export function newMemoryRecordId(kind: "memory" | "entity" | "episode"): string {
  const seq = nextSeq(kind);
  return `${PREFIX[kind]}${seq}-${getDeviceId6()}`;
}
