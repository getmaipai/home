import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { join } from "node:path";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __resetRadioRecordingsForTests, startRadioRecording, stopRadioRecording } from "@/lib/media/radioRecordings";
import { addStation, savedStationFor } from "@/lib/media/radio";
import { __setRadioStreamDepsForTests } from "@/routes/radioApp";
import { dataDir, ensureDataDir } from "@/lib/paths";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";

const publicDns = async () => ({ address: "93.184.216.34", family: 4 });
let submitted: Array<{ kind: string; input?: Record<string, unknown> }>;
let stackJob: StackJob;

beforeEach(() => {
  resetDb();
  setHouseholdSettingValue("storage.household.cap_bytes", 0);
  setHouseholdSettingValue("storage.person.default_cap_bytes", 0);
  __resetRadioRecordingsForTests();
  __setRadioStreamDepsForTests({ dnsLookup: publicDns });
  submitted = [];
  stackJob = { id: "stack-radio-recording", kind: "media.fetch", role: null, state: "queued", percent: 0, completedBytes: 0, totalBytes: 0, status: "queued", position: null, input: {}, result: null, reason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  __setStackClientForTests({
    mediaRoots: async () => ({ read: [], write: [] }), setMediaRoots: async (roots: { read: string[]; write: string[] }) => roots,
    submitJob: async (request: { kind: string; input?: Record<string, unknown> }) => { submitted.push(request); return { ...stackJob, input: request.input ?? {} }; },
    job: async () => stackJob,
    cancelJob: async () => stackJob,
  } as never);
});
afterEach(() => { __resetRadioRecordingsForTests(); __setRadioStreamDepsForTests({}); __setStackClientForTests(null); });

async function stationFor(person: Awaited<ReturnType<typeof owner>>["row"], url = "https://stream.example.com/live.mp3") {
  const added = addStation(person, { name: "Cabin FM", url });
  if (!added.ok) throw new Error(added.error);
  return added.value;
}

describe("radio recordings", () => {
  test("refuses children and private addresses before submitting a job", async () => {
    const { client, row: adult } = await owner();
    const station = await stationFor(adult);
    const childProfile = await child(client);
    expect((await startRadioRecording(childProfile.row, station, "15"))).toMatchObject({ ok: false, status: 403 });
    __setRadioStreamDepsForTests({ dnsLookup: async () => ({ address: "127.0.0.1", family: 4 }) });
    expect(await startRadioRecording(adult, station, "15")).toMatchObject({ ok: false, status: 422 });
    expect(submitted).toHaveLength(0);
  });

  test("submits one guarded job, refuses a second, and stores a duration-bearing library track on completion", async () => {
    const { row } = await owner();
    const station = await stationFor(row);
    const started = await startRadioRecording(row, station, "15");
    expect(started).toMatchObject({ ok: true });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ kind: "media.fetch", input: { url: "https://93.184.216.34/live.mp3", kind: "audio", person_initiated: true, output_dir: resolve(dataDir, "radio-recordings", row.id) } });
    expect(await startRadioRecording(row, station, "30")).toMatchObject({ ok: false, status: 409 });
    expect(submitted).toHaveLength(1);
    const output = resolve(dataDir, "radio-recordings", row.id, "fixture.mp3");
    ensureDataDir(join(output, ".."));
    writeFileSync(output, new Uint8Array([1, 2, 3, 4]));
    stackJob = { ...stackJob, state: "done", result: { count: 1, output_dir: join(output, ".."), items: [{ path: output, title: "Cabin FM recording", duration_s: 42, ext: "mp3", size_bytes: 4 }] } };
    expect(await stopRadioRecording(row, station.id)).toMatchObject({ ok: true });
    const { db } = await import("@/db");
    const { mediaItems } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const item = db.select().from(mediaItems).where(eq(mediaItems.provenance, `radio:recording:${stackJob.id}`)).get();
    expect(item).toMatchObject({ kind: "track", title: "Cabin FM recording", durationS: 42 });
    expect(savedStationFor(row, station.id)).not.toBeNull();
  });
});
