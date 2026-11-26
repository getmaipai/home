// STACK-LORAS-01 slice 4: a fake Stack for the LoRA library. It answers `/stack/v1/loras` (list, patch, trash, restore, move, install, sources, preview) and
// `/stack/v1/jobs/{id}` from memory, the way the real one does. The real Stack takes a tag change with no ticket (owner decision 2026-11-26), so the fake does too. `reset-db.ts` installs a fresh one for every test; `tests/fixtures/lora.ts` puts records into it.
import { __primeLoraSnapshotForTests, __resetLoraSnapshotForTests, __setLorasFetchForTests, type Lora, type StackLoraView } from "@/lib/loras/stackLibrary";

export interface FakeLoraStack {
  views: Map<string, StackLoraView>;
  /** True: every call fails like an engine that is not answering. */
  down: boolean;
  /** Every request the Stack saw: `METHOD path`. */
  calls: string[];
  /** The last PATCH body per id. */
  patches: Map<string, Record<string, unknown>>;
  /** Hits `GET /sources/{site}/search` returns. */
  hits: Array<Record<string, unknown>>;
  put(lora: Lora): StackLoraView;
  /** Make the snapshot Home reads match the Stack now (a test that calls a sync reader without a request). */
  sync(): void;
}

export function viewOfLora(lora: Lora): StackLoraView {
  return {
    id: lora.id, media: lora.media, name: lora.name, base_model: lora.base_model, classification: lora.audience, sha256: lora.file.sha256, bytes: lora.file.bytes, strength_default: lora.strength.default,
    trigger_words: lora.trigger_words, licence: lora.licence.id ?? "", source_url: lora.source.url, added_by: lora.added_by, added_at: lora.added_at, disk_id: lora.disk_id ?? null, disk_label: "This computer",
    status: lora.status ?? "ready", status_note: null, removed_at: lora.removed_at, trash_until: lora.trash_until, preview: null, home: lora as unknown as Record<string, unknown>,
  };
}

// The per-media fakes (`videoFixture.ts`, `pictureFixture.ts`) keep their own `loras` arrays for the generation routes. They register here so the library the
// Stack lists (`GET /stack/v1/loras`) has the same styles, the way the real Stack's one library holds every file its per-media routes know. A video file is
// usable by admins only and a picture style by adults, as the old first read made them; a change to one lands on the registered object itself.
type LegacyLora = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const legacy: Partial<Record<"video" | "picture", () => LegacyLora[]>> = {};
// A style that was in the fake when it was installed is the household's old library (a picture style is on for adults, as it was); one added afterwards is new, so
// it starts for admins only, like every style the Stack installs.
const initial = new Set<string>();
export function registerLegacyLoras(media: "video" | "picture", provider: (() => LegacyLora[]) | null): void {
  if (provider) { legacy[media] = provider; for (const l of provider()) initial.add(l.id); } else delete legacy[media];
}
const overlays = new Map<string, { who?: string; removed_at?: string | null; trash_until?: string | null; home?: Record<string, unknown> }>();

function legacyView(media: "video" | "picture", l: LegacyLora): StackLoraView {
  const o = overlays.get(l.id) ?? {};
  const home: Record<string, unknown> = { availability: { who: o.who ?? (media === "picture" && initial.has(l.id) ? "adults" : "admins"), people: [] }, ...(o.home ?? {}) };
  if (l.tested_on_25 !== undefined) home.tested_on_25 = l.tested_on_25;
  if (l.untested_on_25 !== undefined) home.untested_on_25 = l.untested_on_25;
  return {
    id: l.id, media, name: l.name, base_model: l.base_model, classification: l.classification, sha256: l.sha256, bytes: l.bytes, strength_default: l.strength_default ?? 1, trigger_words: l.trigger_words ?? [],
    licence: l.licence ?? "", source_url: l.source_url ?? null, added_by: l.added_by ?? null, added_at: l.added_at, disk_id: null, disk_label: "This computer", status: "ready", status_note: null,
    removed_at: o.removed_at ?? null, trash_until: o.trash_until ?? null, preview: null, home,
  };
}
function legacyFind(id: string): { media: "video" | "picture"; lora: LegacyLora } | null {
  for (const media of ["video", "picture"] as const) { const lora = legacy[media]?.().find((l) => l.id === id); if (lora) return { media, lora }; }
  return null;
}
function legacyViews(): StackLoraView[] { return (["video", "picture"] as const).flatMap((media) => (legacy[media]?.() ?? []).map((l) => legacyView(media, l))); }

const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (status: number, code: string, error: string): Response => answer({ error, code }, status);

let current: FakeLoraStack | null = null;
export function fakeLoraStack(): FakeLoraStack {
  if (!current) current = installFakeLoraStack();
  return current;
}

export function installFakeLoraStack(): FakeLoraStack {
  const fake: FakeLoraStack = {
    views: new Map(), down: false, calls: [], patches: new Map(), hits: [],
    put(lora) { const view = viewOfLora(lora); fake.views.set(lora.id, view); return view; },
    sync() { /* replaced below, once the lookup helpers exist */ },
  };
  __resetLoraSnapshotForTests();
  overlays.clear();
  const all = (): StackLoraView[] => { const own = [...fake.views.values()]; return [...own, ...legacyViews().filter((v) => !fake.views.has(v.id))]; };
  const lookup = (id: string): StackLoraView | null => fake.views.get(id) ?? legacyViews().find((v) => v.id === id) ?? null;
  fake.sync = () => __primeLoraSnapshotForTests(all());
  __setLorasFetchForTests((async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (fake.down) throw new Error("connect ECONNREFUSED");
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    fake.calls.push(`${method} ${path}${url.search}`);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === "GET" && path === "/stack/v1/loras") {
      const trash = url.searchParams.get("removed") === "true";
      return answer({ loras: all().filter((v) => (v.removed_at !== null) === trash), trash_days: 30 });
    }
    if (method === "GET" && path === "/stack/v1/loras/sources") return answer({ sources: [{ site: "huggingface", label: "Hugging Face", has_key: false }, { site: "civitai", label: "Civitai", has_key: true }] });
    const search = /^\/stack\/v1\/loras\/sources\/(huggingface|civitai)\/search$/.exec(path);
    if (method === "GET" && search) return answer({ hits: fake.hits });
    if (method === "PUT" && /^\/stack\/v1\/loras\/sources\/[a-z]+\/key$/.test(path)) return answer({ sources: [] });
    if (method === "POST" && path === "/stack/v1/loras/install") return answer({ job: "job-install-1" }, 202);
    const job = /^\/stack\/v1\/jobs\/(.+)$/.exec(path);
    if (method === "GET" && job) return answer({ id: job[1], state: "running", percent: 40, status: "Downloading", reason: null });
    const one = /^\/stack\/v1\/loras\/([^/]+)(\/restore|\/move|\/preview)?$/.exec(path);
    if (!one) return refusal(404, "not_found", "No such route.");
    const id = decodeURIComponent(one[1]!);
    const view = lookup(id);
    const own = fake.views.has(id);
    const mine = own ? null : legacyFind(id);
    if (!view) return refusal(404, "unknown_lora", "No such LoRA in the library.");
    if (one[2] === "/preview") return view.preview ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } }) : refusal(404, "no_preview", "That style has no preview picture.");
    if (method === "POST" && one[2] === "/move") return answer({ job: "job-move-1" }, 202);
    const mark = (removedAt: string | null, until: string | null): void => { if (own) { view.removed_at = removedAt; view.trash_until = until; } else overlays.set(id, { ...(overlays.get(id) ?? {}), removed_at: removedAt, trash_until: until }); };
    if (method === "POST" && one[2] === "/restore") { mark(null, null); return answer(lookup(id)); }
    if (method === "DELETE") {
      if (url.searchParams.get("purge") === "true") { if (own) fake.views.delete(id); else { const list = legacy[mine!.media]!(); list.splice(list.findIndex((l) => l.id === id), 1); } return answer({ ok: true, purged: true }); }
      mark(new Date().toISOString(), new Date(Date.now() + 30 * 86_400_000).toISOString());
      return answer({ ok: true, purged: false });
    }
    if (method === "PATCH") {
      fake.patches.set(id, body);
      if (own) {
        if (typeof body.name === "string") view.name = body.name;
        if (body.classification === "adult-only" || body.classification === "all-ages") view.classification = body.classification;
        if (typeof body.strength_default === "number") view.strength_default = body.strength_default;
        if (Array.isArray(body.trigger_words)) view.trigger_words = body.trigger_words as string[];
      } else {
        const src = mine!.lora;
        if (typeof body.name === "string") src.name = body.name;
        if (body.classification === "adult-only" || body.classification === "all-ages") src.classification = body.classification;
        if (typeof body.strength_default === "number") src.strength_default = body.strength_default;
        if (Array.isArray(body.trigger_words)) src.trigger_words = body.trigger_words;
      }
      const home = own ? { ...(view.home ?? {}) } as Record<string, unknown> : { ...(overlays.get(id)?.home ?? {}) };
      if (typeof body.description === "string") home.description = body.description;
      if (typeof body.kind === "string") home.kind = body.kind;
      if (body.home_patch && typeof body.home_patch === "object") Object.assign(home, body.home_patch);
      if (own) {
        if (typeof body.availability_who === "string") home.availability = { ...((home.availability as object | undefined) ?? { people: [] }), who: body.availability_who };
        view.home = home;
      } else {
        overlays.set(id, { ...(overlays.get(id) ?? {}), ...(typeof body.availability_who === "string" ? { who: body.availability_who } : {}), home });
      }
      return answer(lookup(id));
    }
    return refusal(404, "not_found", "No such route.");
  }) as typeof fetch);
  current = fake;
  return fake;
}
