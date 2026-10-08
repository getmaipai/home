import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

protectExistingSecretPaths([keysDir, linkDir, privateKeyPath, publicKeyPath, knownHostsPath, join(linkDir, ".passphrase.enc"), askpassPath]);

type Pairing = { code: string; expiresAt: number; attempts: number; used: boolean };
let pairing: Pairing | null = null;
let scannedCandidate: { line: string; checkCode: string } | null = null;

function ensurePrivateDir(): void {
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  mkdirSync(linkDir, { recursive: true, mode: 0o700 });
  protectSecretPath(keysDir);
  protectSecretPath(linkDir);
}

function newCode(): string {
  const bytes = randomBytes(8);
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && result.length < 12) {
      bits -= 5;
      result += CODE_ALPHABET[(value >>> bits) & 31];
    }
  }
  return result;
}

function randomPassphrase(): string {
  return randomBytes(32).toString("base64url");
}

function ensureAskpassHelper(): void {
  const body = process.platform === "win32" ? "@echo off\r\necho %MAIPAI_LINK_ASKPASS%\r\n" : "#!/bin/sh\nprintf '%s\\n' \"$MAIPAI_LINK_ASKPASS\"\n";
  writeFileSync(askpassPath, body, { mode: 0o700 });
  protectSecretPath(askpassPath);
}

/** Create OpenSSH's native encrypted ed25519 key in memory, then persist only
 * the encrypted private key. The passphrase is encrypted by the OS keystore. */
function ensureKeyPair(): void {
  ensurePrivateDir();
  const encryptedPassphrasePath = join(linkDir, ".passphrase.enc");
  if (existsSync(privateKeyPath) && existsSync(publicKeyPath) && existsSync(encryptedPassphrasePath)) return;
  rmSync(privateKeyPath, { force: true });
  rmSync(publicKeyPath, { force: true });
  rmSync(encryptedPassphrasePath, { force: true });
  const passphrase = randomPassphrase();
  try {
    const pair = sshUtils.generateKeyPairSync("ed25519", {
      format: "new",
      passphrase,
      cipher: "aes256-ctr",
      comment: "maipai-home-engine-link",
      rounds: 16,
    });
    writeFileSync(privateKeyPath, pair.private, { mode: 0o600 });
    writeFileSync(publicKeyPath, pair.public, { mode: 0o600 });
    protectSecretPath(privateKeyPath);
    protectSecretPath(publicKeyPath);
    // Keystore encryption is the only durable copy of the passphrase.
    writeFileSync(encryptedPassphrasePath, encryptSecret(passphrase), { mode: 0o600 });
    protectSecretPath(encryptedPassphrasePath);
  } catch (error) {
    rmSync(privateKeyPath, { force: true });
    rmSync(publicKeyPath, { force: true });
    throw error;
  }
}

export function issuePairingCode(now = Date.now()): { code: string; expires_at: string } {
  ensureKeyPair();
  pairing = { code: newCode(), expiresAt: now + PAIR_TTL_MS, attempts: 0, used: false };
  return { code: pairing.code, expires_at: new Date(pairing.expiresAt).toISOString() };
}

export function getPairingPublicKey(code: string, householdId: string, now = Date.now()): { public_key: string; household_id: string; hmac: string } | null {
  if (!pairing || pairing.used || now >= pairing.expiresAt || pairing.attempts >= MAX_ATTEMPTS) return null;
  pairing.attempts++;
  if (pairing.code !== code || pairing.attempts > MAX_ATTEMPTS) return null;
  const publicKey = readFileSync(publicKeyPath, "utf8").trim();
  const message = `${publicKey}\n${householdId}`;
  const hmac = createHmac("sha256", code).update(message).digest("hex");
  pairing.used = true;
  return { public_key: publicKey, household_id: householdId, hmac };
}

export function verifyPairingPayload(code: string, payload: { public_key: string; household_id: string; hmac: string }): boolean {
  const expected = createHmac("sha256", code).update(`${payload.public_key}\n${payload.household_id}`).digest();
  let provided: Buffer;
  try { provided = Buffer.from(payload.hmac, "hex"); } catch { return false; }
  return provided.length === expected.length && timingSafeEqual(expected, provided);
}

/** ssh-keyscan supplies OpenSSH's own host-key line format. The scanned
 * fingerprint is only displayed until the admin explicitly confirms it. */
export function scanHostKey(host: string, port: number): { check_code: string } {
  const scanned = spawnSync("ssh-keyscan", ["-T", "5", "-p", String(port), "-t", "ed25519", host], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "ignore"] });
  const line = scanned.stdout.split(/\r?\n/).find((value) => value && !value.startsWith("#"));
  if (scanned.error || scanned.status !== 0 || !line) throw new Error("host key scan failed");
  ensurePrivateDir();
  const scanKeyPath = join(linkDir, ".scan-host-key.pub");
  writeFileSync(scanKeyPath, `${line}\n`, { mode: 0o600 });
  protectSecretPath(scanKeyPath);
  let fingerprintOutput = "";
  try {
    const fingerprint = spawnSync("ssh-keygen", ["-lf", scanKeyPath, "-E", "sha256"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
    fingerprintOutput = String(fingerprint.stdout ?? "");
  }
  finally { rmSync(scanKeyPath, { force: true }); }
  const encoded = fingerprintOutput.match(/SHA256:([A-Za-z0-9+/]+=*)/)?.[1];
  if (!encoded) throw new Error("host key fingerprint failed");
  const digest = Buffer.from(encoded, "base64");
  let bits = 0, value = 0, base32 = "";
  for (const byte of digest) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; base32 += CODE_ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) base32 += CODE_ALPHABET[(value << (5 - bits)) & 31];
  scannedCandidate = { line, checkCode: base32.slice(0, 12) };
  return { check_code: scannedCandidate.checkCode };
}

export function confirmHostKey(checkCode: string): void {
  if (!scannedCandidate || checkCode !== scannedCandidate.checkCode) throw new Error("check code does not match");
  ensurePrivateDir();
  writeFileSync(knownHostsPath, `${scannedCandidate.line.trim()}\n`, { mode: 0o600 });
  protectSecretPath(knownHostsPath);
  scannedCandidate = null;
}

export function isCurrentHostKey(host: string, port: number): boolean {
  if (!existsSync(knownHostsPath)) return false;
  const known = readFileSync(knownHostsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/).slice(-2).join(" "));
  const scanned = spawnSync("ssh-keyscan", ["-T", "5", "-p", String(port), "-t", "ed25519", host], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "ignore"] });
  if (scanned.error || scanned.status !== 0) return false;
  const candidate = scanned.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => line.trim().split(/\s+/).slice(-2).join(" "));
  return candidate.length > 0 && candidate.some((key) => known.includes(key));
}

export function getLinkSshAskpassEnvironment(): NodeJS.ProcessEnv {
  ensurePrivateDir();
  if (!existsSync(askpassPath)) ensureAskpassHelper();
  const encrypted = readFileSync(join(linkDir, ".passphrase.enc"), "utf8");
  return { SSH_ASKPASS: askpassPath, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY ?? "maipai", MAIPAI_LINK_ASKPASS: decryptSecret(encrypted) };
}

export function getLinkCredentialStatus(): { paired: boolean } {
  return { paired: existsSync(privateKeyPath) && existsSync(publicKeyPath) && existsSync(knownHostsPath) && existsSync(join(linkDir, ".passphrase.enc")) };
}

export function revokeLinkKey(): void {
  pairing = null;
  scannedCandidate = null;
  for (const path of [privateKeyPath, publicKeyPath, knownHostsPath, join(linkDir, ".passphrase.enc")]) rmSync(path, { force: true });
}

export function getLinkKeyPaths(): { privateKeyPath: string; knownHostsPath: string } {
  return { privateKeyPath, knownHostsPath };
}

export function __resetPairingForTests(): void { pairing = null; scannedCandidate = null; }
