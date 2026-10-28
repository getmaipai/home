// SPLASH-KEY-01 (docs/dev/engine-key-api.md): the one thing an `engine` API key may do: choose the chat engine and apply it.
// It cannot change any other setting, cannot ship or install anything, and every change is audited (log line plus an admin
// notification). The setting is the Stack's own `stack.engines.chat.engine`; llama-server stays the default and the fallback.
import { getStackClient } from "@/lib/stackEngine";
import { activeTurnCount } from "@/lib/turnActivity";
import { trigger } from "@/lib/notifications";

export const ENGINE_SETTING_KEY = "stack.engines.chat.engine";
/** The values a key may choose. Anything else, even if the Stack lists it, is refused here. */
export const ENGINE_CHOICES = ["auto", "llama-server", "splash"] as const;
/** A leaked key can flip the engine at most this many times a day, on top of the 20 calls a minute every operator key has. */
export const ENGINE_CHANGES_PER_DAY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const changes = new Map<string, number[]>();
let now = () => Date.now();
export function __resetOperatorEngineForTests(clock?: () => number): void { changes.clear(); now = clock ?? (() => Date.now()); }

export interface OperatorEngineView { key: string; label: string; choices: readonly string[]; in_effect: unknown; pending: unknown; changes_left_today: number }

const changesLeft = (keyId: string) => {
  const recent = (changes.get(keyId) ?? []).filter((t) => now() - t < DAY_MS);
  changes.set(keyId, recent);
  return Math.max(0, ENGINE_CHANGES_PER_DAY - recent.length);
};

async function stackSetting() {
  const { settings } = await getStackClient().settings();
  return settings.find((s) => s.key === ENGINE_SETTING_KEY) ?? null;
}

export async function operatorEngineView(keyId: string): Promise<OperatorEngineView | null> {
  const s = await stackSetting();
  if (!s) return null;
  return { key: s.key, label: s.label, choices: ENGINE_CHOICES, in_effect: s.in_effect, pending: s.pending, changes_left_today: changesLeft(keyId) };
}

export type OperatorEngineResult =
  | { ok: true; key: string; previous: unknown; value: string }
  | { ok: false; status: 400 | 409 | 429 | 503; error: string };

export async function setOperatorEngine(keyId: string, value: unknown): Promise<OperatorEngineResult> {
  if (typeof value !== "string" || !(ENGINE_CHOICES as readonly string[]).includes(value)) {
    return { ok: false, status: 400, error: `Send one of ${ENGINE_CHOICES.join(", ")}, like {"engine": "splash"}.` };
  }
  if (changesLeft(keyId) === 0) return { ok: false, status: 429, error: `This key has changed the chat engine ${ENGINE_CHANGES_PER_DAY} times in the last day. Wait, or change it in Settings in the browser.` };
  if (activeTurnCount() > 0) return { ok: false, status: 409, error: "A chat is in progress and applying restarts the chat engine. Try again in a minute." };
  let previous: unknown;
  try {
    const s = await stackSetting();
    if (!s) return { ok: false, status: 503, error: "The engine service does not list this setting yet. Update the engine service from Settings and try again." };
    previous = s.pending ?? s.in_effect;
    if (previous === value && s.pending === null) return { ok: true, key: ENGINE_SETTING_KEY, previous, value };
    await getStackClient().applySettings({ [ENGINE_SETTING_KEY]: value });
  } catch {
    return { ok: false, status: 503, error: "The engine service did not answer. Check that it is running on the status page and try again." };
  }
  changes.set(keyId, [...(changes.get(keyId) ?? []), now()]);
  console.log(`[operator] engine key ${keyId} set ${ENGINE_SETTING_KEY} from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`);
  await trigger("engines.chat_engine_changed", { from: String(previous), to: value }).catch(() => undefined);
  return { ok: true, key: ENGINE_SETTING_KEY, previous, value };
}
