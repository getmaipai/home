// ADULT-LOCK-03: the one place Home asks the Stack for the full view of an adult job. A caller gets a `FullView` grant only from
// `fullViewForJob`, and only for a job made for an adult audience whose owner is an adult. Every Stack call that reads an adult job
// (status, preview, clip, poster, picture) takes the grant as an optional argument and goes through `sendWithView`, which adds the
// two headers and nothing else. No grant, no headers: the Stack refuses a full-view ask with a wrong key on every route, so Home never
// sends one it does not need.
//
// Two bases for a grant:
//   "background"  Home reads the job for itself (progress, the finished-clip check, settle). Home is the Stack's trusted caller, and what it
//                 reads reaches a response only through Home's own lock (ADULT-LOCK-02: lockState, the 404 and the locked tile).
//   { proof }     A person is present and Home reads on their behalf: the grant needs the person's own live unlock proof, a human browser
//                 session and their own screen (never a shared or spoken surface).
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { lockState, type AdultProof, type LockItem } from "@/lib/adultLock";
import { HOME_TOKEN_HEADER, PRIMING_TOKEN, VIEW_HEADER, forgetHomeViewToken, homeViewToken, reportViewKeyProblem, reportViewKeyWorks } from "@/lib/stack/homeViewToken";

declare const grant: unique symbol;
/** Proof that Home decided this one call may carry the full-view headers. Built only here. */
export interface FullView { readonly [grant]: true; readonly basis: "background" | "unlocked" }

export type ViewBasis = "background" | { proof: AdultProof; surface: "own" | "shared" | "spoken"; item?: LockItem };

const make = (basis: FullView["basis"]): FullView => ({ basis }) as FullView;

/**
 * The grant for one Stack call about a job made with `audience`, or undefined (the standard view).
 * Never for a job that is not adult, never for a minor owner, and for a person-present read only with their own live proof on their own screen.
 */
export function fullViewForJob(audience: unknown, owner: PersonRow, basis: ViewBasis = "background"): FullView | undefined {
  if (audience !== "adult") return undefined;
  if (speakerAgeBand(owner, new Date()) !== "adult") return undefined;
  if (basis === "background") return make("background");
  if (basis.surface !== "own" || !basis.proof.sessionKey) return undefined;
  const item: LockItem = basis.item ?? { ownerPersonId: owner.id, madeAudience: "adult-only", lock: "on" };
  return lockState(item, owner, basis.proof) === "open" ? make("unlocked") : undefined;
}

/** The Stack refused a full-view ask, or Home has no key to ask with. The caller maps it to its own plain refusal; nothing here names a job or a key. */
export class StackViewError extends Error {
  constructor(readonly code: "view_key_missing" | "view_key_refused") {
    super(code === "view_key_missing" ? "Home has no key to open adult items with." : "The engine did not accept Home's key for adult items.");
    this.name = "StackViewError";
  }
}
/** What a person is told when it happens (the Repairs row says the rest). */
export const VIEW_KEY_LINE = "That item can't be opened right now. An admin can see what to do in Repairs.";

type Doer = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One Stack request. With a grant it carries the two headers; a 403 `full_view_forbidden` makes Home read its key again and ask once more. */
export async function sendWithView(doFetch: Doer, base: string, path: string, init: RequestInit, view?: FullView): Promise<Response> {
  if (!view) return doFetch(base + path, init);
  const prime = async () => { await doFetch(`${base}/stack/v1/health`, { method: "GET", headers: { [VIEW_HEADER]: "full", [HOME_TOKEN_HEADER]: PRIMING_TOKEN }, signal: AbortSignal.timeout(5_000) }).then((r) => r.arrayBuffer()).catch(() => undefined); };
  const ask = async (): Promise<Response | null> => {
    const token = await homeViewToken(prime);
    if (!token) return null;
    const headers = new Headers(init.headers);
    headers.set(VIEW_HEADER, "full"); headers.set(HOME_TOKEN_HEADER, token);
    return doFetch(base + path, { ...init, headers });
  };
  let res = await ask();
  if (res === null) { reportViewKeyProblem(); throw new StackViewError("view_key_missing"); }
  if (res.status === 403 && await isForbidden(res)) {
    forgetHomeViewToken();
    await res.body?.cancel().catch(() => undefined);
    res = await ask();
    if (res === null || (res.status === 403 && await isForbidden(res))) { reportViewKeyProblem(); throw new StackViewError("view_key_refused"); }
  }
  // The Stack checks the key before it routes, so any answer that is not a refusal or a restart notice (503) shows the key was accepted.
  if (res.status < 500) reportViewKeyWorks();
  return res;
}

async function isForbidden(res: Response): Promise<boolean> {
  try { return (await res.clone().json() as { code?: unknown }).code === "full_view_forbidden"; } catch { return false; }
}
