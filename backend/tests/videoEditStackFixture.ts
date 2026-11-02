// VIDEO-CHAT-01 (C3, C4): a fake Stack for the `media.edit` job and for speech. It stands in for the StackClient methods lib/videos/stackEdit.ts and
// lib/tts.ts call (media roots, submit, poll, cancel, speak), records what Home sent, checks the staged input files exist while the job runs, and
// writes a finished mp4 where the job's `output` says, like the real Stack. No network.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { __setStackClientForTests, getStackClient } from "@/lib/stackEngine";
import { __setStackEditTimingForTests } from "@/lib/videos/stackEdit";
import sharp from "sharp";
import { testMp4 } from "./videoFixture";

export interface FakeEditJob { id: string; input: { inputs: string[]; ops: Array<Record<string, unknown>>; output: { dir: string; name: string } }; staged: Array<{ name: string; bytes: number }>; dirMode: number; polls: number; state: string; cancelled: boolean }
export interface FakeEditStack {
  jobs: FakeEditJob[];
  /** The speech requests (`text`, `voice_url`, ...) as the form fields the Stack got. */
  speech: Array<Record<string, string>>;
  rootsSet: Array<{ read: string[]; write: string[] }>;
  pollsToFinish: number;
  /** When set, the job ends failed with this reason. */
  failWith: string | null;
  /** When true, the submit itself is refused (an unreachable Stack). */
  refuseSubmit: boolean;
  /** When true, the speech engine fails. */
  speechFails: boolean;
  /** The container length the finished job reports. */
  durationS: number;
  restore(): void;
}

export function installFakeEditStack(): FakeEditStack {
  const base = getStackClient();
  const roots = { read: [] as string[], write: [] as string[] };
  const fake: FakeEditStack = { jobs: [], speech: [], rootsSet: [], pollsToFinish: 2, failWith: null, refuseSubmit: false, speechFails: false, durationS: 6, restore() { __setStackEditTimingForTests(null); __setStackClientForTests(null); } };
  __setStackEditTimingForTests({ pollMs: 5, deadlineMs: 5_000 });
  const stamp = (job: FakeEditJob) => ({
    id: job.id, kind: "media.edit", role: null, state: job.state, percent: 0, completedBytes: 0, totalBytes: 0, status: "", position: null, input: null, result: null, reason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const client = {
    ...base,
    mediaRoots: async () => ({ read: [...roots.read], write: [...roots.write] }),
    setMediaRoots: async (next: { read: string[]; write: string[] }) => { roots.read = next.read; roots.write = next.write; fake.rootsSet.push(next); return next; },
    submitJob: async (request: { kind: string; input?: Record<string, unknown> }) => {
      if (fake.refuseSubmit) throw new Error("connect ECONNREFUSED /secret/path/in/the/error");
      const input = request.input as FakeEditJob["input"];
      const job: FakeEditJob = { id: `edit-${fake.jobs.length + 1}`, input, staged: input.inputs.map((path) => ({ name: path.split("/").pop()!, bytes: existsSync(path) ? readFileSync(path).byteLength : -1 })), dirMode: statSync(input.output.dir).mode & 0o777, polls: 0, state: "queued", cancelled: false };
      fake.jobs.push(job);
      return stamp(job);
    },
    job: async (id: string) => {
      const job = fake.jobs.find((item) => item.id === id)!;
      job.polls += 1;
      if (job.cancelled) job.state = "cancelled";
      else if (job.polls < fake.pollsToFinish) job.state = "running";
      else if (fake.failWith) return { ...stamp({ ...job, state: "failed" }), state: "failed", reason: fake.failWith };
      else {
        job.state = "done";
        const path = join(job.input.output.dir, job.input.output.name);
        // A `frame` job ends in a picture (.png), as the real Stack's does; every other job ends in a clip.
        if (/\.png$/i.test(job.input.output.name)) {
          const png = await sharp({ create: { width: 128, height: 72, channels: 3, background: { r: 40, g: 90, b: 160 } } }).png().toBuffer();
          writeFileSync(path, png);
          return { ...stamp(job), result: { path, size_bytes: png.byteLength, container: "png", width: 128, height: 72, elapsed_ms: 80 } };
        }
        writeFileSync(path, testMp4());
        return { ...stamp(job), result: { path, size_bytes: 4096, container: "mp4", duration_s: fake.durationS, width: 832, height: 480, video_codec: "h264", audio_codec: "aac", elapsed_ms: 1200 } };
      }
      return stamp(job);
    },
    cancelJob: async (id: string) => { const job = fake.jobs.find((item) => item.id === id)!; job.cancelled = true; return stamp(job); },
    speak: async (form: FormData) => {
      fake.speech.push(Object.fromEntries([...form.entries()].map(([name, value]) => [name, String(value)])));
      if (fake.speechFails) throw new Error("speech engine down");
      return new Response(new Uint8Array(2048).fill(7), { headers: { "content-type": "audio/wav" } });
    },
  };
  __setStackClientForTests(client as never);
  return fake;
}
