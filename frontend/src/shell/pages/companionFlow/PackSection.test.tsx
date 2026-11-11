import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionPackJob } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

// The kit player is mocked so the test sees its props; the real player is checked in WebKit.
mock.module("@maipai/ui/src/elements/companion-pack", () => ({
  CompanionPackPlayer: (props: { baseUrl: string; state: string }) => <div data-testid="pack-player" data-base={props.baseUrl} data-state={props.state} />,
}));
const { PackSection } = await import("@/shell/pages/companionFlow/PackSection");

const methods = ["health", "companionPackJob", "startCompanionPackJob", "approveCompanionPackStage", "cancelCompanionPackJob"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); Object.assign(api, originals); globalThis.fetch = realFetch; });

const READY = { kind: "none", pid: null, alive: true, availability: "ready" };
const PAUSED = { kind: "failed", pid: null, alive: false, availability: "unavailable", cause: "memory", notice: { adult: "Picture making is paused. It starts again by itself.", teen: "t", child: "c", repairs_link: null } };
const names = ["source", "clips", "track", "shapes", "emotion", "assemble", "validate", "install"] as const;
const job = (extra: Partial<CompanionPackJob> = {}, done = 0): CompanionPackJob => ({ job: "j1", status: "running", stage: "clips", waiting_for: null, error: null, still_id: "v-1", shapes: "photo", stages: names.map((name, i) => ({ name, status: i < done ? "done" : "pending", reasons: [], report: null, stack_jobs: [] })), ...extra });

function open(current: CompanionPackJob | null, image: unknown = READY) {
  const calls = { start: [] as unknown[], approve: [] as string[], cancel: 0 };
  api.health = async () => ({ brain: "stack", voice: "stack", ok: true, uptimeSeconds: 1, sidecars: [], engines: { chat: READY, embed: READY, background: READY, voice: READY, image, video: READY } }) as never;
  api.companionPackJob = async () => { if (!current) throw new ApiError("No pack job.", 404); return current; };
  api.startCompanionPackJob = async (_id, body) => { calls.start.push(body); current = job({}, 1); return current; };
  api.approveCompanionPackStage = async (_id, stage) => { calls.approve.push(stage); return job({}, 3); };
  api.cancelCompanionPackJob = async () => { calls.cancel++; current = job({ status: "cancelled" }); return current; };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><WakeWordPersonContext.Provider value={{ role: "adult", age_band: "adult" } as never}><PackSection companionId="hc-one" stillId="v-1" /></WakeWordPersonContext.Provider></QueryClientProvider>);
  return { view, calls };
}
type View = ReturnType<typeof open>["view"];
const btn = (view: View, name: string) => view.getByRole("button", { name }) as HTMLButtonElement;

test("collapsed: the intro line and the Make button only, and Make starts the job with the approved picture", async () => {
  const { view, calls } = open(null);
  const make = await waitFor(() => btn(view, "Make a talking character"));
  expect(view.queryByRole("progressbar")).toBeNull();
  fireEvent.click(make);
  await waitFor(() => expect(calls.start).toEqual([{ still_id: "v-1", restart: false }]));
  await view.findByText("Making the clips... 13%");
});

test("Make is disabled with the existing reason (the screen's own line, as the tooltip here) while pictures are not ready", async () => {
  const { view } = open(null, PAUSED);
  await waitFor(() => expect(btn(view, "Make a talking character").title).toBe("Picture making is paused. It starts again by itself."));
  expect(btn(view, "Make a talking character").disabled).toBe(true);
});

test("a running job shows the stage in words with its percent, and Stop cancels", async () => {
  const { view, calls } = open(job({ stage: "track" }, 2));
  await view.findByText("Tracking the head... 25%");
  fireEvent.click(btn(view, "Stop"));
  await waitFor(() => expect(calls.cancel).toBe(1));
  await waitFor(() => btn(view, "Make a talking character"));
});

test("approval B lists the clips; Looks good approves B and Make it again restarts", async () => {
  const clips = ["idle", "listening", "thinking", "speaking"].map((state) => ({ state, take: `t-${state}`, url: `/clip/${state}.h264.mp4` }));
  const { view, calls } = open(job({ status: "waiting_approval", waiting_for: "B", clips }, 2));
  await view.findByText("Idle");
  expect(view.getByText("Speaking")).toBeTruthy();
  fireEvent.click(btn(view, "Looks good, continue"));
  await waitFor(() => expect(calls.approve).toEqual(["B"]));
  await view.findByText("Making the clips... 38%");
});

test("approval B: Make it again restarts the job", async () => {
  const { view, calls } = open(job({ status: "waiting_approval", waiting_for: "B", clips: [] }, 2));
  fireEvent.click(await waitFor(() => btn(view, "Make it again")));
  await waitFor(() => expect(calls.start).toEqual([{ still_id: "v-1", restart: true }]));
});

test("approval C mounts the kit player on the preview pack; Use this character approves C, Not yet stops", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ name: "man" }), { status: 200, headers: { "content-type": "application/json" } })) as never;
  const { view, calls } = open(job({ status: "waiting_approval", waiting_for: "C", preview: { pack_url_base: "/api/companions/hc-one/pack-job/preview/", pack_json_url: "/api/companions/hc-one/pack-job/preview/pack.json", installed: false } }, 7));
  const player = await view.findByTestId("pack-player");
  expect(player.getAttribute("data-base")).toBe("/api/companions/hc-one/pack-job/preview/");
  fireEvent.click(btn(view, "Use this character"));
  await waitFor(() => expect(calls.approve).toEqual(["C"]));
});

test("approval C: Not yet stops the job", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as never;
  const { view, calls } = open(job({ status: "waiting_approval", waiting_for: "C", preview: { pack_url_base: "/p/", pack_json_url: "/p/pack.json", installed: false } }, 7));
  fireEvent.click(await waitFor(() => btn(view, "Not yet")));
  await waitFor(() => expect(calls.cancel).toBe(1));
});

test("a failed job shows its plain reason and Try again restarts it", async () => {
  const { view, calls } = open(job({ status: "failed", error: "The head could not be found in the picture. Use a picture that shows the face." }, 2));
  await view.findByText("The head could not be found in the picture. Use a picture that shows the face.");
  fireEvent.click(btn(view, "Try again"));
  await waitFor(() => expect(calls.start).toEqual([{ still_id: "v-1", restart: true }]));
});

test("a refused start shows Home's reason", async () => {
  const { view } = open(null);
  api.startCompanionPackJob = async () => { throw new ApiError("Pack making is for adults only here. Ask an adult to make it.", 403); };
  fireEvent.click(await waitFor(() => btn(view, "Make a talking character")));
  await view.findByText("Pack making is for adults only here. Ask an adult to make it.");
});

test("a finished job says Done", async () => {
  const { view } = open(job({ status: "done", stage: null }, 8));
  await view.findByText(/^Done\./);
});
