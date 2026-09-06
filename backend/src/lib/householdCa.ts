// A household certificate authority, minted once at first use, and a
// leaf certificate for `maipai.local` and this hub's own detected LAN
// addresses (session-f-platform-and-trust.md step 5: "the browser shows
// no warning on the LAN; the microphone, passkeys and push work because
// the household CA is trusted"). Chrome/Safari/Firefox all refuse a
// microphone prompt, a passkey ceremony, and a service worker on plain
// HTTP for anything but `localhost` - a household reaching the hub by
// its LAN IP or `maipai.local` needs real TLS, and real TLS on a private
// address with no public DNS name means minting the trust anchor
// ourselves, the same thing `mkcert` and every other local-dev-HTTPS
// tool does.
//
// node-forge (BSD-3-Clause, one of its two offered licenses - the
// package is dual BSD-3-Clause/GPL-2.0, and BSD-3-Clause is the license
// this project uses it under) generates the certificates: Node's own
// `node:crypto` can verify and parse X.509 but has no high-level API to
// mint a CA and sign a leaf with it, and node-forge is the maintained,
// widely-used library for exactly this (CLAUDE.md principle 6, prebuilt
// over hand-built - hand-rolling ASN.1/X.509 encoding would be the
// hand-built alternative this exists to avoid).
//
// The CA private key is genuinely sensitive (anyone who has it can mint
// a certificate this hub's own trusted devices would accept) - stored
// AES-256-GCM-encrypted via lib/secrets (CLAUDE.md > Credentials and
// secrets: "any reversible secret the app stores... is encrypted with
// the keystore, never plaintext in a table or JSON file"; a code review
// (2026-09-06) found the first version writing raw PEM key files,
// exactly what that rule exists to prevent) under a 0600 file under
// data/keys/, the same directory lib/keystore.ts's own keys already use,
// never in the database and never returned by any route. The leaf key
// is regenerated along with the leaf certificate whenever this hub's
// detected addresses change or the certificate nears expiry; the CA key
// is never rotated in the ordinary case (rotating it would require every
// trusting device to re-install a new CA certificate) - rotation is a
// real Repairs item this file wires up, not a routine operation.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPair as generateKeyPairCb } from "node:crypto";
import { promisify } from "node:util";
import forge from "node-forge";
import { dataDir } from "@/lib/paths";
import { detectLanIps } from "@/lib/hubEndpoints";
import { raiseIssue, resolveIssue, registerFixHandler } from "@/lib/issues";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { singleflight } from "@/lib/singleflight";

const generateRsaKeyPair = promisify(generateKeyPairCb);

const KEYS_DIR = join(dataDir, "keys");
const CA_CERT_PATH = join(KEYS_DIR, "household-ca-cert.pem");
const CA_KEY_PATH = join(KEYS_DIR, "household-ca-key.pem");
const LEAF_CERT_PATH = join(KEYS_DIR, "hub-leaf-cert.pem");
const LEAF_KEY_PATH = join(KEYS_DIR, "hub-leaf-key.pem");

// Fired every time ensureHouseholdLeaf() actually (re)generates a leaf -
// never when it returns the already-good one from disk. index.ts
// subscribes to reload the running server's TLS config and refresh the
// mDNS advertisement's `tls` field; a code review (2026-09-06) found
// neither of those happened without this - the leaf file itself
// updated correctly, but a live process kept presenting the OLD
// certificate (Bun.serve's `tls` option is read once at boot) and kept
// broadcasting a stale `tls` TXT value until a full restart. A plain
// callback list, not an event emitter: there is exactly one real
// subscriber (index.ts's boot path) and no need for the bookkeeping a
// full emitter would add.
const leafRenewedListeners: Array<(leaf: CertAndKey) => void> = [];

export function onLeafRenewed(listener: (leaf: CertAndKey) => void): void {
  leafRenewedListeners.push(listener);
}

/** Test-only: leafRenewedListeners is module-local state with no other
 * reset hook. */
export function __clearLeafRenewedListenersForTests(): void {
  leafRenewedListeners.length = 0;
}

const RSA_KEY_BITS = 2048;
const CA_VALIDITY_YEARS = 10;
const LEAF_VALIDITY_DAYS = 365;
// A real Repairs item well before expiry, per session-f-platform-and-
// trust.md step 5's "rotation as a Repairs item": 30 days gives a
// household real time to notice before the hub's own microphone/passkey
// prompts start failing.
const LEAF_EXPIRY_WARNING_DAYS = 30;
// A code review (2026-09-06) found notBefore set to the exact instant of
// generation, with no buffer - the same tool this file's own header
// compares itself to, mkcert, backdates for exactly this reason. A
// client device whose clock lags the hub's (common on phones and
// embedded devices, or during ordinary NTP drift) would see a
// freshly-minted certificate as "not yet valid" and refuse the
// connection - the exact browser-trust failure this feature exists to
// prevent.
const CLOCK_SKEW_BACKDATE_MINUTES = 5;

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function backdatedNow(): Date {
  return new Date(Date.now() - CLOCK_SKEW_BACKDATE_MINUTES * 60_000);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function randomSerialHex(): string {
  // X.509 serials must be positive when parsed as an integer; a leading
  // high bit would read as negative, so force the top nibble low.
  const bytes = forge.random.getBytesSync(16);
  const hex = forge.util.bytesToHex(bytes);
  return (parseInt(hex[0]!, 16) & 0x7).toString(16) + hex.slice(1);
}

interface CertAndKey {
  certPem: string;
  keyPem: string;
}

// node:crypto's async generateKeyPair offloads RSA generation to libuv's
// threadpool instead of running on the JS main thread - unlike forge's
// own synchronous rsa.generateKeyPair(), which a code review (2026-09-06)
// found running directly on an unauthenticated request handler's call
// stack (GET /api/setup/ca). Pure-JS RSA-2048 generation can take well
// over a second on Pi-class hardware (a realistic hub target), and Bun's
// single event loop has nothing else to do meanwhile - every other
// household member's request stalls for however long keygen takes.
// node-forge still builds and signs the X.509 structure (Node has no
// high-level API for that); it just imports keys node:crypto generated,
// rather than generating them itself.
async function generateRsaKeyPairForge(): Promise<{ publicKey: forge.pki.rsa.PublicKey; privateKey: forge.pki.rsa.PrivateKey; keyPem: string }> {
  const { publicKey, privateKey } = await generateRsaKeyPair("rsa", {
    modulusLength: RSA_KEY_BITS,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return {
    publicKey: forge.pki.publicKeyFromPem(publicKey as unknown as string),
    privateKey: forge.pki.privateKeyFromPem(privateKey as unknown as string),
    keyPem: privateKey as unknown as string,
  };
}

async function generateCa(): Promise<CertAndKey> {
  const keys = await generateRsaKeyPairForge();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerialHex();
  cert.validity.notBefore = backdatedNow();
  cert.validity.notAfter = addYears(new Date(), CA_VALIDITY_YEARS);
  const subject = [{ name: "commonName", value: "MaiPai Home Household CA" }, { name: "organizationName", value: "MaiPai Home" }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: keys.keyPem };
}

/** `altNames` are whatever this hub currently knows how to be reached at
 * - `maipai.local` plus every detected LAN IPv4 address - passed in
 * rather than detected here so this stays a pure "given these names,
 * build this cert" function, independently testable from address
 * detection. */
async function generateLeaf(caCertPem: string, caKeyPem: string, altNames: string[]): Promise<CertAndKey> {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const keys = await generateRsaKeyPairForge();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerialHex();
  cert.validity.notBefore = backdatedNow();
  cert.validity.notAfter = addDays(new Date(), LEAF_VALIDITY_DAYS);
  cert.setSubject([{ name: "commonName", value: altNames[0] ?? "maipai.local" }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNameEntries = altNames.map((name) =>
    /^\d+\.\d+\.\d+\.\d+$/.test(name) ? { type: 7, ip: name } : { type: 2, value: name },
  );
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: altNameEntries },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: keys.keyPem };
}

/** Encrypts before writing (lib/secrets, AES-256-GCM) - the private key
 * file never holds plaintext PEM on disk. */
function writeKeyFile(path: string, plainPem: string): void {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, encryptSecret(plainPem), { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync's mode is masked by umask on some platforms; re-assert
}

/** Reads and decrypts a key file writeKeyFile() wrote. */
function readKeyFile(path: string): string {
  return decryptSecret(readFileSync(path, "utf-8"));
}

function writeCertFile(path: string, contents: string): void {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o644 });
}

/** The addresses a freshly (re)generated leaf certificate should cover.
 * `detectLanIps` is exported by lib/hubEndpoints.ts specifically for
 * this - the CA has no business duplicating that detection logic. */
function currentAltNames(): string[] {
  return ["maipai.local", ...detectLanIps()];
}

/** Mints the household CA on first call; every later call returns the
 * same one from disk. Never rotated automatically - see this file's own
 * header for why. Async because minting genuinely generates a fresh
 * RSA-2048 key (see generateRsaKeyPairForge()'s own comment); the
 * disk-read fast path below stays synchronous. */
// COR-3 (code review, 2026-09-06): check-then-generate with a real
// `await` in between and no lock around it - two concurrent first-run
// callers (two devices opening the trust page at once; the rate limiter
// allows a burst per IP, and these are two different IPs) both see no CA
// on disk and both generate one. Whichever's writeCertFile() runs second
// overwrites the first's CA on disk, so a leaf already signed by the
// FIRST caller's CA no longer chains to the CA now on disk - wrong until
// the next address change or the certificate's own ~335-day expiry.
// singleflight() (already used by wakewordAssets.ts/voiceCatalog.ts for
// the identical "share the one in-flight attempt" shape) makes every
// concurrent caller await the SAME generate-and-write, rather than
// racing to do it twice.
const singleflightEnsureHouseholdCa = singleflight(async (): Promise<CertAndKey> => {
  if (existsSync(CA_CERT_PATH) && existsSync(CA_KEY_PATH)) {
    return { certPem: readFileSync(CA_CERT_PATH, "utf-8"), keyPem: readKeyFile(CA_KEY_PATH) };
  }
  const ca = await generateCa();
  writeCertFile(CA_CERT_PATH, ca.certPem);
  writeKeyFile(CA_KEY_PATH, ca.keyPem);
  return ca;
});

export function ensureHouseholdCa(): Promise<CertAndKey> {
  return singleflightEnsureHouseholdCa();
}

function certExpiresWithinDays(certPem: string, days: number): boolean {
  const cert = forge.pki.certificateFromPem(certPem);
  const warningPoint = addDays(new Date(), days);
  return cert.validity.notAfter.getTime() <= warningPoint.getTime();
}

function certCoversAllNames(certPem: string, names: string[]): boolean {
  const cert = forge.pki.certificateFromPem(certPem);
  const sanExt = cert.getExtension("subjectAltName") as { altNames?: Array<{ type: number; ip?: string; value?: string }> } | null;
  const covered = new Set((sanExt?.altNames ?? []).map((a) => a.ip ?? a.value));
  return names.every((name) => covered.has(name));
}

// COR-3 (code review, 2026-09-06): stillGood below never checked that
// the leaf on disk actually chains to the CA currently on disk - only
// its own expiry and address coverage. The exact damage a first-run race
// (two concurrent callers each minting a CA, whichever's writeCertFile()
// ran second silently replacing the other's) would leave behind: a leaf
// signed by CA A, a CA file now holding CA B, both individually valid
// PEMs, so every OTHER check here passes while the served chain is
// actually broken. verifyCertificateChain() throws (not returns false)
// on a genuine mismatch - node-forge's own documented behavior, not an
// exception this code expects to be exceptional.
function leafChainsToCa(leafCertPem: string, caCertPem: string): boolean {
  try {
    const leaf = forge.pki.certificateFromPem(leafCertPem);
    const ca = forge.pki.certificateFromPem(caCertPem);
    return forge.pki.verifyCertificateChain(forge.pki.createCaStore([ca]), [leaf]);
  } catch {
    return false;
  }
}

// Idempotent (Map.set on the same key just overwrites), so calling this
// from every real entry point below - rather than once at module import
// time - is free in production and, unlike an import-time registration,
// survives a test file resetting the shared fixHandlers map: any OTHER
// test file's __resetFixHandlersForTests() would otherwise permanently
// wipe an import-time registration for the rest of that `bun test`
// process (every test file shares one process, and Bun only evaluates a
// module's top level once) - a real bug this file's own test caught.
//
// Exported (not just called internally) so index.ts can register it
// unconditionally at boot: a code review (2026-09-06) found that without
// this, a leaf_expiring/leaf_stale Repairs issue raised in a PREVIOUS
// process run (the row survives a restart in the issues table) had no
// handler behind its "Renew now" fix until whichever came first - the
// daily scheduled check or someone hitting GET /api/setup/ca - since
// this function was previously called only from inside
// ensureHouseholdLeaf()/checkLeafExpiry(), neither of which the boot path
// calls (it only checks hasHouseholdLeaf(), a pure existence check).
export function registerRenewFixHandler(): void {
  registerFixHandler("renew_household_leaf", async () => {
    await ensureHouseholdLeaf();
  });
}

/** Ensures the CA exists, then ensures a leaf certificate exists,
 * currently covers every detected address, and isn't nearing expiry -
 * regenerating it if any of those isn't true. Idempotent and cheap to
 * call whenever a caller (the TLS-serving boot path, GET /api/setup/ca)
 * needs a currently-valid leaf. Async for the same reason
 * ensureHouseholdCa() is - actually minting a fresh leaf generates a
 * real RSA-2048 key off the main thread; the disk-read fast path (the
 * common case, "nothing changed") stays synchronous underneath. */
// COR-3: the identical check-then-generate race ensureHouseholdCa() has,
// singleflight()-guarded the same way (two concurrent callers - the TLS-
// serving boot path and someone hitting GET /api/setup/ca at the same
// moment on a fresh install - must share one mint, not race to write two
// leaves and two "leaf renewed" listener firings for what should be a
// single event).
const singleflightEnsureHouseholdLeaf = singleflight(async (): Promise<CertAndKey> => {
  registerRenewFixHandler();
  const ca = await ensureHouseholdCa();
  const altNames = currentAltNames();

  if (existsSync(LEAF_CERT_PATH) && existsSync(LEAF_KEY_PATH)) {
    const existingCertPem = readFileSync(LEAF_CERT_PATH, "utf-8");
    const stillGood =
      !certExpiresWithinDays(existingCertPem, LEAF_EXPIRY_WARNING_DAYS) &&
      certCoversAllNames(existingCertPem, altNames) &&
      leafChainsToCa(existingCertPem, ca.certPem);
    if (stillGood) {
      resolveIssue("householdCa", "leaf_expiring");
      resolveIssue("householdCa", "leaf_stale");
      return { certPem: existingCertPem, keyPem: readKeyFile(LEAF_KEY_PATH) };
    }
  }

  const leaf = await generateLeaf(ca.certPem, ca.keyPem, altNames);
  writeCertFile(LEAF_CERT_PATH, leaf.certPem);
  writeKeyFile(LEAF_KEY_PATH, leaf.keyPem);
  resolveIssue("householdCa", "leaf_expiring");
  resolveIssue("householdCa", "leaf_stale");
  for (const listener of leafRenewedListeners) listener(leaf);
  return leaf;
});

export function ensureHouseholdLeaf(): Promise<CertAndKey> {
  return singleflightEnsureHouseholdLeaf();
}

/** Real-only-when-warranted: called on a schedule (not on every request)
 * so an about-to-expire OR no-longer-address-covering leaf shows up in
 * Repairs before it actually fails, with a fix that just re-runs
 * ensureHouseholdLeaf(). A code review (2026-09-06) found the first
 * version only ever checked expiry, unlike ensureHouseholdLeaf() itself
 * - a LAN address change (a new DHCP lease) between two `GET
 * /api/setup/ca` calls would silently go unnoticed by this scheduled job
 * forever, only ever caught if someone happened to hit that endpoint
 * again. Both checks now raise under their own key (a household can see
 * WHICH problem it is, and the two can coexist), sharing the identical
 * fix action since both are resolved the same way. */
export async function checkLeafExpiry(): Promise<void> {
  registerRenewFixHandler();
  if (!existsSync(LEAF_CERT_PATH)) return; // nothing minted yet - not this household's concern until it is
  const certPem = readFileSync(LEAF_CERT_PATH, "utf-8");

  if (certExpiresWithinDays(certPem, LEAF_EXPIRY_WARNING_DAYS)) {
    await raiseIssue({
      source: "householdCa",
      key: "leaf_expiring",
      severity: "warning",
      title: "The hub's own security certificate is expiring soon",
      detail: `It's valid for at most ${LEAF_EXPIRY_WARNING_DAYS} more days. Renewing it now avoids a gap where the browser stops trusting the hub.`,
      fix: { label: "Renew now", action: "renew_household_leaf" },
    });
  } else {
    resolveIssue("householdCa", "leaf_expiring");
  }

  if (!certCoversAllNames(certPem, currentAltNames())) {
    await raiseIssue({
      source: "householdCa",
      key: "leaf_stale",
      severity: "warning",
      title: "The hub's own security certificate doesn't cover its current address",
      detail: "This hub's network address has changed since its certificate was issued (a new DHCP lease, a new interface). Renewing it covers the current address.",
      fix: { label: "Renew now", action: "renew_household_leaf" },
    });
  } else {
    resolveIssue("householdCa", "leaf_stale");
  }
}

/** True once a leaf certificate has ever been minted for this install -
 * the boot path's own "serve TLS or plain HTTP" decision. */
export function hasHouseholdLeaf(): boolean {
  return existsSync(LEAF_CERT_PATH) && existsSync(LEAF_KEY_PATH);
}

export function getHouseholdLeafForServer(): { cert: string; key: string } {
  return { cert: readFileSync(LEAF_CERT_PATH, "utf-8"), key: readKeyFile(LEAF_KEY_PATH) };
}

/** The CA certificate only - `GET /api/setup/ca` serves exactly this,
 * never the key. */
export async function getHouseholdCaCertificate(): Promise<string> {
  return (await ensureHouseholdCa()).certPem;
}

/** Test-only: deletes every key/cert file this module manages, the same
 * "reset between tests" shape every other module-level state in this
 * directory uses - here that state lives on disk, not in a module-level
 * variable, so the reset is a file removal instead of clearing a cache. */
export function __resetHouseholdCaForTests(): void {
  singleflightEnsureHouseholdCa.__resetForTests();
  singleflightEnsureHouseholdLeaf.__resetForTests();
  for (const path of [CA_CERT_PATH, CA_KEY_PATH, LEAF_CERT_PATH, LEAF_KEY_PATH]) {
    try {
      rmSync(path);
    } catch {
      // already gone
    }
  }
}
