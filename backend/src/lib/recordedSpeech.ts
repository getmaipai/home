// V6: recorded speech is a per-render choice. Request bodies contain the line
// and reference bytes, but errors and logs from this client never contain them.
import { createStackHttp } from "@/lib/stack/http";

export type RecordedSpeechStatus = { available?: boolean; ready?: boolean; installed?: boolean; engine?: string; version?: string; models?: Array<{ id?: string; revision?: string; installed?: boolean }> };
const WAIT_MS = 30_000;
const POLL_MS = 1_000;
const MAX_QUEUE_MS = 60_000;
const STATUS_WAIT_MS = 5_000;
const stack = createStackHttp({ makeError: () => new Error("unavailable"), noStackMessage: "", unreachableMessage: "" });
let referenceForTests: ((voiceUrl?: string) => { bytes: Uint8Array; mimeType: string; transcript?: string } | null) | null = null;
export const __setRecordedSpeechFetchForTests = stack.__setFetchForTests;
export function __setRecordedSpeechReferenceForTests(getter: typeof referenceForTests): void { referenceForTests = getter; }
export function recordedSpeechReferenceForTest(voiceUrl?: string) { return referenceForTests?.(voiceUrl) ?? null; }

const request = (path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> => stack.request(path, { ...init, timeoutMs });
export async function recordedSpeechStatus(): Promise<RecordedSpeechStatus | null> {
  try {
    const res = await request("/stack/v1/speech-recorded", {}, 5_000);
    if (!res.ok) return null;
    const body = await res.json() as { recorded_speech?: RecordedSpeechStatus };
    return body.recorded_speech ?? null;
  } catch { return null; }
}
export async function waitForRecordedSpeech(): Promise<RecordedSpeechStatus | null> {
  const deadline = Date.now() + STATUS_WAIT_MS;
  let status: RecordedSpeechStatus | null = null;
  do {
    status = await recordedSpeechStatus();
    if (!status?.available || status.ready || status.installed === false) return status;
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (Date.now() < deadline);
  return status;
}
export async function submitRecordedSpeech(text: string, reference: Uint8Array, mimeType: string, referenceText: string): Promise<{ job: string; done: boolean; data?: { url?: string; content_type?: string } | null }> {
  const encoded = Buffer.from(reference).toString("base64");
  const res = await request("/v1/audio/speech/recorded", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, reference: encoded, reference_text: referenceText, format: "wav", timeout_ms: WAIT_MS }) }, WAIT_MS + 5_000);
  if (!res.ok) throw new Error("unavailable");
  const body = await res.json() as { job?: string; data?: { url?: string; content_type?: string } | null };
  if (!body.job) throw new Error("unavailable");
  return { job: body.job, done: res.status === 200 && !!body.data, data: body.data };
}
export async function fetchRecordedSpeech(job: string, initial?: { url?: string; content_type?: string } | null): Promise<{ bytes: Uint8Array; contentType: string; revision?: string } | null> {
  const deadline = Date.now() + MAX_QUEUE_MS;
  let data = initial;
  while (!data && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const res = await request(`/v1/audio/speech/recorded/${encodeURIComponent(job)}`, {}, 10_000);
    if (!res.ok) return null;
    const status = await res.json() as { state?: string; data?: { url?: string; content_type?: string } | null };
    if (status.state === "failed" || status.state === "cancelled") return null;
    if (status.state === "done") data = status.data;
  }
  if (!data?.url) return null;
  const res = await request(data.url, {}, 120_000);
  if (!res.ok) return null;
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? data.content_type ?? "audio/wav" };
}
