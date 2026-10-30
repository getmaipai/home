// Host tuning for the Mac that runs Home (HOST-TUNE-01). The one definition
// lives in scripts/studio/host-tune.sh; this wrapper only runs it with a fixed
// argument list. A caller's id is checked against HOST_TUNE_IDS first and is
// passed as one argv element, never through a shell, never as free text.
import { z } from "@hono/zod-openapi";
import { join } from "node:path";
import { repoRoot, classDir } from "@/lib/paths";

export const HOST_TUNE_IDS = [
  "no-spotlight", "no-timemachine-models", "power", "display-awake", "wired-limit", "no-auto-major-upgrade", "remote-login",
  "advice-accounts", "advice-radios", "advice-network", "advice-toolchains", "advice-login", "advice-screensaver",
] as const;

export const HostTuneItemSchema = z.object({
  id: z.string(), title: z.string(), why: z.string(),
  mode: z.enum(["auto", "consent", "advice"]),
  state: z.enum(["ok", "needs", "unknown", "applied"]),
  current: z.string(), proposed: z.string(),
});
export type HostTuneItem = z.infer<typeof HostTuneItemSchema>;

const DetectOutput = z.object({ supported: z.boolean(), items: z.array(HostTuneItemSchema) });
const ActionOutput = z.object({ item: HostTuneItemSchema });
const ErrorOutput = z.object({ error: z.string(), code: z.string() });

export type HostTuneFailure = { ok: false; status: 400 | 409 | 500; error: string };
export type HostTuneResult<T> = { ok: true; value: T } | HostTuneFailure;

const scriptPath = () => process.env.MAIPAI_HOST_TUNE_SCRIPT || join(repoRoot, "scripts", "studio", "host-tune.sh");
/** `MAIPAI_HOST_TUNE_PLATFORM` is a test seam. */
const platform = () => process.env.MAIPAI_HOST_TUNE_PLATFORM || process.platform;

async function runScript(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const child = Bun.spawn(["bash", scriptPath(), "--json", "--data-dir", classDir("records"), "--models-dir", classDir("models"),
    "--engines-dir", classDir("engines"), "--media-dir", classDir("people-files"), "--cache-dir", classDir("cache"), ...args], {
    stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 60_000,
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}

function failure(run: { code: number; out: string; err: string }): HostTuneFailure {
  try {
    const body = ErrorOutput.parse(JSON.parse(run.out));
    const status = body.code === "needs-root" || body.code === "failed" ? 409 : body.code === "unsupported" ? 409 : 400;
    return { ok: false, status, error: body.error };
  } catch {
    return { ok: false, status: 500, error: `Host tuning did not run (${run.err.trim() || "no message"}). Check that scripts/studio/host-tune.sh is in the install folder and try again.` };
  }
}

export async function detectHostTune(): Promise<HostTuneResult<z.infer<typeof DetectOutput>>> {
  if (platform() !== "darwin") return { ok: true, value: { supported: false, items: [] } };
  const run = await runScript(["detect"]);
  if (run.code !== 0) return failure(run);
  try { return { ok: true, value: DetectOutput.parse(JSON.parse(run.out)) }; } catch { return failure(run); }
}

export async function changeHostTune(verb: "apply" | "revert", id: string): Promise<HostTuneResult<HostTuneItem>> {
  if (!(HOST_TUNE_IDS as readonly string[]).includes(id)) return { ok: false, status: 400, error: `"${id}" is not a host tuning item. Pick one from the list.` };
  if (platform() !== "darwin") return { ok: false, status: 409, error: "Host tuning is for a Mac, and this computer is not running macOS. Nothing was changed." };
  const run = await runScript(["--yes", verb, id]);
  if (run.code !== 0) return failure(run);
  try { return { ok: true, value: ActionOutput.parse(JSON.parse(run.out)).item }; } catch { return failure(run); }
}
