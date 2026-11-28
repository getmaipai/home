import { createHash, randomInt } from "node:crypto";
import type { Binding } from "./decide";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TTL_MS = 10 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_WRONG_PER_SOURCE = 5;

interface PendingPairing {
  personId: string;
  band: Binding["band"];
  capabilities: string[];
  expiresAt: number;
}

const pairings = new Map<string, PendingPairing>();
const wrongBySource = new Map<string, { count: number; expiresAt: number }>();

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generatedCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function sweep(now: number): void {
  for (const [key, pairing] of pairings) if (pairing.expiresAt + TTL_MS <= now) pairings.delete(key);
  for (const [source, wrong] of wrongBySource) if (wrong.expiresAt <= now) wrongBySource.delete(source);
}

export function createInboundPairing(
  input: { personId: string; band: "child" | "teen" | "adult"; capabilities: string[] },
  deps: { now?: () => number; randomCode?: () => string } = {},
): { code: string; expiresAt: number } {
  const now = deps.now ?? Date.now;
  const randomCode = deps.randomCode ?? generatedCode;
  const createdAt = now();
  sweep(createdAt);
  let code = randomCode().trim().toUpperCase();
  let key = hashCode(code);
  while (pairings.has(key)) {
    code = randomCode().trim().toUpperCase();
    key = hashCode(code);
  }
  const expiresAt = createdAt + TTL_MS;
  pairings.set(key, {
    personId: input.personId,
    band: input.band,
    capabilities: input.band === "child" ? [] : [...input.capabilities],
    expiresAt,
  });
  return { code, expiresAt };
}

export function redeemInboundPairing(
  input: { code: string; externalId: string; source: string },
  deps: { now?: () => number } = {},
): { ok: true; binding: Binding } | { ok: false; reason: "invalid" | "expired" | "locked" | "bad-id" } {
  const now = (deps.now ?? Date.now)();
  sweep(now);
  if (!/^[0-9]{1,20}$/.test(input.externalId)) return { ok: false, reason: "bad-id" };
  const lock = wrongBySource.get(input.source);
  if (lock && lock.count >= MAX_WRONG_PER_SOURCE && lock.expiresAt > now) return { ok: false, reason: "locked" };

  const key = hashCode(input.code.trim().toUpperCase());
  const pairing = pairings.get(key);
  if (!pairing) {
    const previous = wrongBySource.get(input.source);
    const count = previous && previous.expiresAt > now ? previous.count + 1 : 1;
    wrongBySource.set(input.source, { count, expiresAt: now + (count >= MAX_WRONG_PER_SOURCE ? LOCK_MS : 5 * 60_000) });
    return { ok: false, reason: "invalid" };
  }
  if (pairing.expiresAt <= now) {
    pairings.delete(key);
    return { ok: false, reason: "expired" };
  }
  pairings.delete(key);
  return {
    ok: true,
    binding: {
      externalId: input.externalId,
      personId: pairing.personId,
      band: pairing.band,
      capabilities: [...pairing.capabilities],
    },
  };
}

export function __pairingStoreKeysForTests(): string[] {
  return [...pairings.keys()];
}

export function __resetInboundPairingForTests(): void {
  pairings.clear();
  wrongBySource.clear();
}
