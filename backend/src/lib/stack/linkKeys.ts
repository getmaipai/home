import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";
import { dataDir } from "@/lib/paths";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { protectExistingSecretPaths, protectSecretPath } from "@/lib/secretPaths";
import { utils as sshUtils } from "ssh2";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PAIR_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const linkDir = join(dataDir, "keys", "stack-link");
const keysDir = join(dataDir, "keys");
const privateKeyPath = join(linkDir, "id_ed25519");
const publicKeyPath = `${privateKeyPath}.pub`;
const knownHostsPath = join(linkDir, "known_hosts");
const askpassPath = join(linkDir, process.platform === "win32" ? "askpass.cmd" : "askpass.sh");
const passphrasePath = join(linkDir, ".passphrase.enc");
protectExistingSecretPaths([keysDir, linkDir, privateKeyPath, publicKeyPath, knownHostsPath, passphrasePath, askpassPath]);

type Pairing = { code: string; expiresAt: number; attempts: number; used: boolean };
let pairing: Pairing | null = null;
let scannedCandidate: { line: string; checkCode: string; expiresAt: number } | null = null;

export function normalizePairingCode(code: string): string { return code.replaceAll("-", "").toUpperCase(); }
export function derivePairingLookup(code: string): string { return createHmac("sha256", normalizePairingCode(code)).update("maipai-pair-lookup").digest("hex").slice(0, 32); }
function derivePairingMacKey(code: string): Buffer { return createHmac("sha256", normalizePairingCode(code)).update("maipai-pair-mac").digest(); }
function secureEqual(a: Buffer, b: Buffer): boolean { return a.length === b.length && timingSafeEqual(a, b); }
function constantStringEqual(a: string, b: string): boolean { const aa = Buffer.from(a); const bb = Buffer.from(b); return secureEqual(aa, bb); }

function ensurePrivateDir(): void {
  mkdirSync(keysDir, { recursive: true, mode: 0o700 }); mkdirSync(linkDir, { recursive: true, mode: 0o700 });
  protectSecretPath(keysDir); protectSecretPath(linkDir);
}
function newCode(): string {
  const bytes = randomBytes(8); let bits = 0, value = 0, result = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5 && result.length < 12) { bits -= 5; result += CODE_ALPHABET[(value >>> bits) & 31]; } }
  return result;
}
function randomPassphrase(): string { return randomBytes(32).toString("base64url"); }
function ensureAskpassHelper(): void {
  const body = process.platform === "win32" ? "@echo off\r\necho %MAIPAI_LINK_ASKPASS%\r\n" : "#!/bin/sh\nprintf '%s\\n' \"$MAIPAI_LINK_ASKPASS\"\n";
  writeFileSync(askpassPath, body, { mode: 0o700 }); protectSecretPath(askpassPath);
}
function ensureKeyPair(): void {
  ensurePrivateDir();
  if (existsSync(privateKeyPath) && existsSync(publicKeyPath) && existsSync(passphrasePath)) return;
  rmSync(privateKeyPath, { force: true }); rmSync(publicKeyPath, { force: true }); rmSync(passphrasePath, { force: true });
  const passphrase = randomPassphrase();
  try {
    const pair = sshUtils.generateKeyPairSync("ed25519", { format: "new", passphrase, cipher: "aes256-ctr", comment: "maipai-home-engine-link", rounds: 16 });
    writeFileSync(privateKeyPath, pair.private, { mode: 0o600 }); writeFileSync(publicKeyPath, pair.public, { mode: 0o600 });
    protectSecretPath(privateKeyPath); protectSecretPath(publicKeyPath);
    writeFileSync(passphrasePath, encryptSecret(passphrase), { mode: 0o600 }); protectSecretPath(passphrasePath);
  } catch (error) { rmSync(privateKeyPath, { force: true }); rmSync(publicKeyPath, { force: true }); throw error; }
}

export function issuePairingCode(now = Date.now()): { code: string; expires_at: string } {
  ensureKeyPair(); pairing = { code: newCode(), expiresAt: now + PAIR_TTL_MS, attempts: 0, used: false }; scannedCandidate = null;
  return { code: pairing.code, expires_at: new Date(pairing.expiresAt).toISOString() };
}
export function getPairingPublicKey(lookup: string, householdId: string, now = Date.now()): { public_key: string; household_id: string; hmac: string } | null {
  if (!pairing || pairing.used || now >= pairing.expiresAt) return null;
  if (!constantStringEqual(derivePairingLookup(pairing.code), lookup)) { pairing.attempts++; return null; }
  const publicKey = readFileSync(publicKeyPath, "utf8").trim();
  const message = `${publicKey}\n${householdId}`;
  const hmac = createHmac("sha256", derivePairingMacKey(pairing.code)).update(message).digest("hex");
  pairing.used = true; return { public_key: publicKey, household_id: householdId, hmac };
}
export function verifyPairingPayload(code: string, payload: { public_key: string; household_id: string; hmac: string }): boolean {
  const expected = createHmac("sha256", derivePairingMacKey(code)).update(`${payload.public_key}\n${payload.household_id}`).digest();
  if (!/^[\da-f]{64}$/i.test(payload.hmac)) return false;
  return secureEqual(expected, Buffer.from(payload.hmac, "hex"));
}

function validHost(host: string): boolean {
  if (host.length > 253 || host.trim() !== host || !host) return false;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(bare) || bare.includes(":")) return isIP(bare) !== 0;
  return bare.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
}
function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "", settled = false;
    const child = spawn(command, args, { env: { PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); if (!settled) { settled = true; reject(new Error("command timed out")); } }, timeoutMs);
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.once("close", (code) => { clearTimeout(timer); if (!settled) { settled = true; resolve({ code, stdout }); } });
  });
}
function checkCode(line: string): string {
  const digest = Buffer.from(line.split(/\s+/)[2] ?? "", "base64"); let bits = 0, value = 0, base32 = "";
  for (const byte of digest) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; base32 += CODE_ALPHABET[(value >>> bits) & 31]; } }
  if (bits) base32 += CODE_ALPHABET[(value << (5 - bits)) & 31]; return base32.slice(0, 12);
}
function assertActivePairing(now = Date.now()): Pairing {
  if (!pairing || pairing.used || now >= pairing.expiresAt) { scannedCandidate = null; throw new Error("pairing expired"); }
  return pairing;
}
export async function scanHostKey(host: string, port: number): Promise<{ check_code: string }> {
  const active = assertActivePairing();
  if (!validHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid host");
  const result = await run("ssh-keyscan", ["-T", "5", "-p", String(port), "-t", "ed25519", "--", host], 8_000);
  const line = result.stdout.split(/\r?\n/).find((value) => value && !value.startsWith("#"));
  if (result.code !== 0 || !line) throw new Error("host key scan failed");
  const fields = line.trim().split(/\s+/); if (fields.length < 3 || fields[1] !== "ssh-ed25519") throw new Error("invalid host key");
  scannedCandidate = { line, checkCode: checkCode(line), expiresAt: active.expiresAt }; return { check_code: scannedCandidate.checkCode };
}
export function confirmHostKey(code: string): void {
  const active = assertActivePairing();
  if (!scannedCandidate || Date.now() >= scannedCandidate.expiresAt || scannedCandidate.expiresAt !== active.expiresAt || !constantStringEqual(code, scannedCandidate.checkCode)) throw new Error("check code does not match");
  if (existsSync(knownHostsPath)) throw new Error("a host key is already pinned");
  ensurePrivateDir(); writeFileSync(knownHostsPath, `${scannedCandidate.line.trim()}\n`, { mode: 0o600 }); protectSecretPath(knownHostsPath); scannedCandidate = null;
}

export type HostKeyStatus = "match" | "mismatch" | "unreachable";
export async function isCurrentHostKey(host: string, port: number): Promise<HostKeyStatus> {
  if (!validHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return "unreachable";
  if (!existsSync(knownHostsPath)) return "mismatch";
  const known = readFileSync(knownHostsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/).slice(-2).join(" "));
  try {
    const scanned = await run("ssh-keyscan", ["-T", "5", "-p", String(port), "-t", "ed25519", "--", host], 8_000);
    if (scanned.code !== 0) return "unreachable";
    const candidate = scanned.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => line.trim().split(/\s+/).slice(-2).join(" "));
    if (!candidate.length) return "unreachable";
    return candidate.some((key) => known.includes(key)) ? "match" : "mismatch";
  } catch { return "unreachable"; }
}
export function getLinkSshAskpassEnvironment(): NodeJS.ProcessEnv {
  ensurePrivateDir(); if (!existsSync(askpassPath)) ensureAskpassHelper();
  const encrypted = readFileSync(passphrasePath, "utf8");
  return { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? process.cwd(), SSH_ASKPASS: askpassPath, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY ?? "maipai", MAIPAI_LINK_ASKPASS: decryptSecret(encrypted) };
}
export function getLinkCredentialStatus(): { paired: boolean } { return { paired: existsSync(privateKeyPath) && existsSync(publicKeyPath) && existsSync(knownHostsPath) && existsSync(passphrasePath) }; }
export function revokeLinkKey(): void {
  pairing = null; scannedCandidate = null;
  for (const path of [privateKeyPath, publicKeyPath, knownHostsPath, passphrasePath, askpassPath]) rmSync(path, { force: true });
}
export function getLinkKeyPaths(): { privateKeyPath: string; knownHostsPath: string; askpassPath: string } { return { privateKeyPath, knownHostsPath, askpassPath }; }
export function __resetPairingForTests(): void { pairing = null; scannedCandidate = null; }
