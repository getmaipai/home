// ADULT-LOCK-02: the fixture of the Adult lock tests (docs/dev/adult-lock.md). One household (an owner, two adults, a teen, a child), one adult-only
// clip and one all-ages clip, and the strings that must never appear on any surface while the adult-only clip is locked.
import { eq, like } from "drizzle-orm";
import { TestClient } from "../client";
import { db } from "@/db";
import { attachments, people as peopleTable } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { withMark } from "@/lib/adultLock";
import { until } from "../pictureFixture";
import type { PersonRow } from "@/types";

/** Every string that belongs to the adult-only clip: its words (which become its title everywhere) and a tag it carries. */
export const ADULT_PROMPT = "Zebraquill velvet cabaret dancer under violet lamps";
export const ADULT_STRINGS = ["Zebraquill", "velvet cabaret", "violet lamps"] as const;
export const PLAIN_PROMPT = "A paper boat floats down a rainy street, soft evening light";
export const PASSCODE = "0000";

export async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string, extra: Record<string, unknown> = {}) => {
    const made = await owner.post("/api/people", { displayName, role, secret: PASSCODE, ...extra });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: PASSCODE });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const other = await signIn("Quill", "adult");
  const teen = await signIn("Nova", "teen", { birthdate: "2011-03-01" });
  const child = await signIn("Sprout", "child", { birthdate: "2018-03-01" });
  const row = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  return { owner, adult, other, teen, child, row };
}

/** Make a clip on the Create page and wait until it is done. */
export async function makeClip(client: TestClient, actor: PersonRow, prompt: string) {
  const made = (await (await client.post("/api/videos/make", { prompt })).json()) as { id: string };
  await until(() => getVideoJobFor(actor, made.id)?.state === "done");
  const job = getVideoJobFor(actor, made.id)!;
  return { jobId: made.id, fileId: job.files[0]!.id, posterId: job.files[0]!.poster_id };
}

/** Mark a finished clip and its poster adult-only (the lock on), the way the pipeline stores an adult-only clip. */
export function markAdultOnly(jobId: string): void {
  for (const row of db.select().from(attachments).where(like(attachments.provenance, `%"job":"${jobId}"%`)).all()) {
    const next = withMark(row.provenance, { lock: "on", raiseToAdult: true });
    if (next) db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run();
  }
}

export async function adultClip(client: TestClient, actor: PersonRow) {
  const clip = await makeClip(client, actor, ADULT_PROMPT);
  markAdultOnly(clip.jobId);
  return clip;
}

export const unlockHeader = (proof: string): Record<string, string> => ({ "x-adult-unlock": proof });

export async function unlock(client: TestClient, secret = PASSCODE): Promise<string> {
  const res = await client.post("/api/adult-lock/unlock", { secret, visit: "visit-1" });
  if (res.status !== 200) throw new Error(`unlock answered ${res.status}`);
  return ((await res.json()) as { proof: string }).proof;
}

/** The text of an answer, for "none of these strings appear" checks. */
export async function textOf(res: Response): Promise<string> { return (await res.text()) + JSON.stringify([...res.headers.entries()]); }
