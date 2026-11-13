// QUEUE-HOME: which hub is calling the Stack. The Stack's admission rule treats a request as the household's only when it carries
// `x-stack-caller: live` together with Home's token; anything else is a dev call (lowest priority, never takes chat to Reduced).
// The one signal is the one a dev hub already sets: `scripts/dev.sh` starts every workbench and private dev hub with
// MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 (the opt-out of the one-hub lock, which production boot never sets, see instanceLock.ts), and
// the workbench also sets MAIPAI_WORKBENCH=1. A test run (NODE_ENV=test) says `test`. Everything else is the installed hub: `live`.
import { OPT_OUT_ENV } from "@/lib/instanceLock";

export const STACK_CALLER_HEADER = "x-stack-caller";
export type StackCaller = "live" | "dev" | "test";

export function stackCaller(env: Record<string, string | undefined> = process.env): StackCaller {
  if (env.NODE_ENV === "test") return "test"; // tests set the hub opt-out too, so a test run is checked first
  if (env[OPT_OUT_ENV] || env.MAIPAI_WORKBENCH === "1") return "dev";
  return "live";
}

/** The same header on every Stack call path (set when the caller did not already name one). */
export function withStackCaller(headers?: ConstructorParameters<typeof Headers>[0], env: Record<string, string | undefined> = process.env): Headers {
  const out = new Headers(headers);
  if (!out.has(STACK_CALLER_HEADER)) out.set(STACK_CALLER_HEADER, stackCaller(env));
  return out;
}
