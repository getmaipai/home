// ADULT-LOCK-03: a Stack that enforces the Stack's own ADULT-LOCK-04 rules around the fake picture and video engines. Written from the Stack's docs
// ("Adult jobs: the redacted view and the full view"): an adult job (a submit whose body says `audience: "adult"`) is reported as state and progress only,
// its files answer 404, unless the request carries `x-maipai-view: full` with the right `x-maipai-home-token`; a full-view ask with a wrong or missing token is
// refused 403 `full_view_forbidden` on EVERY route; no `x-maipai-view` header is the standard view whatever else is sent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";

export const STACK_TEST_TOKEN = ["aaaa", "bbbb", "cccc", "dddd"].join("-");
export interface SeenRequest { method: string; path: string; full: boolean; headers: Record<string, string>; adult: boolean; status: number }

export interface EnforcingStack {
  seen: SeenRequest[];
  /** The key the Stack currently accepts (a test changes it to model a rotated key). */
  token: string;
  /** Where the Stack keeps its key file; set when the test gives the Stack a data folder. A first full-view ask that presents a token makes the file, as the Stack does. */
  keyFolder: string | null;
  adultJobs: Set<string>;
  /** Requests that carried the full view. */
  full(): SeenRequest[];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FILE = /^\/v1\/(?:videos|images)\/generations\/([^/]+)\/(video\.mp4|poster\.jpg|preview\.jpg|\d+\.png|\d+\.thumb\.jpg)$/;
const STATUS = /^\/v1\/(?:videos|images)\/generations\/([^/]+)$/;

/** Wraps the two fakes' handlers (installed first) and points both Home seams at the enforcing Stack. */
export function enforceAdultView(handlers: { video: typeof fetch; picture: typeof fetch }, options: { keyFolder?: string } = {}): EnforcingStack {
  const stack: EnforcingStack = { seen: [], token: STACK_TEST_TOKEN, keyFolder: options.keyFolder ?? null, adultJobs: new Set(), full: () => stack.seen.filter((r) => r.full) };
  const handler = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const asked = (headers.get("x-maipai-view") ?? "").trim().toLowerCase() === "full";
    const presented = headers.get("x-maipai-home-token");
    const allowed = asked && presented === stack.token;
    const seen: SeenRequest = { method, path: url.pathname, full: asked, headers: Object.fromEntries(headers.entries()), adult: false, status: 0 };
    stack.seen.push(seen);
    const finish = (res: Response) => { seen.status = res.status; return res; };
    if (asked && presented && stack.keyFolder) { mkdirSync(join(stack.keyFolder, "keys"), { recursive: true }); writeFileSync(join(stack.keyFolder, "keys", "home-view-token"), `${stack.token}\n`, { mode: 0o600 }); }
    if (asked && !allowed) return finish(json({ error: "The full view is for Home only.", code: "full_view_forbidden" }, 403));
    const inner = url.pathname.startsWith("/v1/images") || url.pathname.startsWith("/stack/v1/image") ? handlers.picture : handlers.video;
    const res = await inner(input, init);
    const submit = method === "POST" && (url.pathname === "/v1/videos/generations" || url.pathname === "/v1/images/generations");
    if (submit) {
      const adult = (JSON.parse(String(init?.body ?? "{}")) as { audience?: string }).audience === "adult";
      const job = ((await res.clone().json().catch(() => ({}))) as { job?: string }).job;
      if (adult && job) stack.adultJobs.add(job);
      seen.adult = adult;
      return finish(res);
    }
    const file = FILE.exec(url.pathname);
    const status = STATUS.exec(url.pathname);
    const id = file?.[1] ?? status?.[1];
    seen.adult = !!id && stack.adultJobs.has(id);
    if (!id || !seen.adult || allowed || method === "DELETE") return finish(res);
    if (file) return finish(json({ error: "That is gone.", code: "expired" }, 404));
    const body = (await res.json()) as Record<string, unknown>;
    return finish(json({ ...body, stage_label: null, step: null, steps: null, preview_url: null, preview_step: null, data: [], error: body.state === "failed" ? "This job failed." : null }));
  }) as typeof fetch;
  __setVideosFetchForTests(handler);
  __setPicturesFetchForTests(handler);
  return stack;
}
