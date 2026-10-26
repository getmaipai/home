// Home's signed proofs for the Stack. The Stack refuses to act on a likeness without a short-lived proof Home signed
// for that one thing (the Stack's lib/likeness.ts has the
// format and the rules it checks). The key is an Ed25519 key derived from a seed kept in Home's keystore, so it is the
// same after a restart and a restore, never in the database and never sent anywhere but as a public key to the Stack.
//
// Logs: nothing here logs a proof, an id or a key.
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign as signBytes, type KeyObject } from "node:crypto";
import { getOrCreateHexKey } from "@/lib/keystore";
import { likenessTrustStatus, registerLikenessTrust, StackPicturesError } from "@/lib/pictures/stack";

export type ProofPurpose = "photo" | "style_import" | "style_use";

/** Proofs are minted per request and live 20 minutes: long enough for a clip to wait behind the others, short enough to be worthless later. The Stack caps them at 30. */
export const PROOF_TTL_SECONDS = 20 * 60;

let cached: { privateKey: KeyObject; spki: string; fingerprint: string } | null = null;
function key(): NonNullable<typeof cached> {
  if (cached) return cached;
  const seed = Buffer.from(getOrCreateHexKey("likeness_signing_seed", 32), "hex");
  // PKCS#8 for an Ed25519 key is a fixed prefix and the 32-byte seed.
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  cached = { privateKey, spki: der.toString("base64"), fingerprint: createHash("sha256").update(der).digest("hex").slice(0, 16) };
  return cached;
}
export function __resetLikenessKeyForTests(): void { cached = null; trusted = null; }

const b64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let clock: () => number = () => Date.now();
/** Test seam: the clock proofs are minted against (null restores). */
export function __setProofClockForTests(now: (() => number) | null): void { clock = now ?? (() => Date.now()); }

export interface MintInput { purpose: ProofPurpose; subject: string; requester: string; bind: string; ttlSeconds?: number }

/** One signed proof. `bind` is the picture's sha256 (photo), the style's file sha256 (style_import) or the style's id (style_use). */
export function mintProof(input: MintInput): string {
  const iat = Math.floor(clock() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose: input.purpose, subject: input.subject, requester: input.requester, bind: input.bind, iat, exp: iat + Math.min(input.ttlSeconds ?? PROOF_TTL_SECONDS, 29 * 60), jti: randomUUID() }));
  const text = b64url(payload);
  return `${text}.${b64url(signBytes(null, Buffer.from(text), key().privateKey))}`;
}

export function photoBind(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

// ---------------------------------------------------------------- the Stack knows our key

export type TrustState = { ok: true } | { ok: false; code: "stack_old" | "stack_other_key" | "unreachable"; line: string };
let trusted: { at: number; state: TrustState } | null = null;
const TRUST_CACHE_MS = 60_000;

export const STACK_OLD_LINE = "The engine on this computer is too old for pictures and videos of a person. An admin can update it in Settings, Engine.";
export const STACK_OTHER_KEY_LINE = "The engine on this computer trusts a different Home for pictures and videos of a person, so they are switched off. An admin can reset it in Settings, Engine.";
export const STACK_UNREACHABLE_LINE = "The engine isn't answering, so I can't make pictures or videos of a person right now. Check that the engine is running, then try again.";

/** Makes sure the Stack trusts this Home's key before a proof is sent: registers it when the Stack has none, and says plainly when the Stack trusts a different one or is too old to know about proofs. */
let trustOverride: TrustState | null = null;
/** Test seam: the Stack's trust answer, without a Stack (null restores). */
export function __setStackTrustForTests(state: TrustState | null): void { trustOverride = state; }
/** This Home's public key (base64 SPKI) and its short fingerprint, for tests and the status page. */
export function proofPublicKey(): { spki: string; fingerprint: string } { return { spki: key().spki, fingerprint: key().fingerprint }; }

export async function ensureStackTrust(force = false): Promise<TrustState> {
  if (trustOverride) return trustOverride;
  if (!force && trusted && Date.now() - trusted.at < TRUST_CACHE_MS && trusted.state.ok) return trusted.state;
  const remember = (state: TrustState): TrustState => { trusted = { at: Date.now(), state }; return state; };
  try {
    const status = await likenessTrustStatus();
    if (status === null) return remember({ ok: false, code: "stack_old", line: STACK_OLD_LINE });
    if (status.trusted && status.fingerprint === key().fingerprint) return remember({ ok: true });
    if (status.trusted) return remember({ ok: false, code: "stack_other_key", line: STACK_OTHER_KEY_LINE });
    const registered = await registerLikenessTrust(key().spki);
    return remember(registered.fingerprint === key().fingerprint ? { ok: true } : { ok: false, code: "stack_other_key", line: STACK_OTHER_KEY_LINE });
  } catch (error) {
    if (error instanceof StackPicturesError && error.status === 409) return remember({ ok: false, code: "stack_other_key", line: STACK_OTHER_KEY_LINE });
    if (error instanceof StackPicturesError && error.status === 404) return remember({ ok: false, code: "stack_old", line: STACK_OLD_LINE });
    return { ok: false, code: "unreachable", line: STACK_UNREACHABLE_LINE };
  }
}
