// A package's host.fetch() reaches the open internet on the household's
// behalf; nothing stops it from being pointed at the hub's own LAN
// instead (the household's router admin page, another device's control
// panel, a service with no auth because it trusts "anything on this
// network"). This resolves the target and refuses anything private,
// loopback, or link-local before a real request is ever attempted -
// packageHost.ts's own `home.call_service` and `integration.call` are
// the real, permissioned paths for reaching the household's own devices;
// a generic `fetch` step has no business landing there.
//
// A known, accepted gap, not a silent one: this checks the hostname's
// resolved address BEFORE the real request, not the address the
// underlying TCP connection actually lands on - a DNS answer that
// changes between this check and the real fetch (DNS rebinding) is not
// caught. Closing that fully needs a custom resolver/socket hook tied
// directly into the fetch call, a bigger change than this pass's real
// threat model warrants: every package today is first-party, bundled,
// trusted code (no catalog, no signing, no third-party upload exists
// yet - docs/PACKAGES.md), so the live risk is a bug in OUR OWN code
// reaching an internal address by mistake, which this catches, not a
// hostile package deliberately racing a DNS TTL.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// A real, live-verified DEAD END worth recording so a future session
// doesn't re-chase it (2026-09-05): building the `define` skill against
// dictionaryapi.dev hit a fetch that hung 10s+ and initially looked
// caused by this file's own `dns.lookup()` call immediately preceding
// Bun's `fetch()` to the same host - switching to `dns.resolve4()`
// appeared to fix it in a first pass of testing. More rigorous testing
// (8 real trials, alternating both resolvers) proved that theory wrong:
// BOTH resolvers failed at the same roughly 50% rate against this exact
// host. The real, honest finding is that dictionaryapi.dev itself is
// measurably unreliable from this network right now, unrelated to
// which DNS function runs first - see the `define` package's own
// docs/dev.md entry for what that means for shipping it. `dns.lookup()`
// is kept (not `resolve4`/`resolve6`, briefly tried and reverted): it
// resolves the same way the OS/a browser would (respecting `/etc/hosts`
// and other local overrides), which is the more SSRF-correct choice for
// this specific job - checking the address the real connection will
// actually use, not a raw DNS-only query that could disagree with it.
export interface DnsLookup {
  (hostname: string): Promise<{ address: string; family: number }>;
}

function isPrivateOrLoopbackIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

// A code review (2026-09-05) found the IPv6 branch below missed
// IPv4-mapped addresses (::ffff:a.b.c.d, the form a DNS lookup can
// legitimately return for an AAAA-mapped A record) - confirmed live that
// isIP("::ffff:169.254.169.254") reports family 6, so without this the
// entire ::ffff:0:0/96 range sailed through as "public" while actually
// naming a private/loopback/link-local IPv4 target underneath.
const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function isPrivateOrLoopbackIp(ip: string, family: number): boolean {
  if (family === 4) return isPrivateOrLoopbackIpv4(ip);
  const lower = ip.toLowerCase();
  const mapped = lower.match(IPV4_MAPPED_RE);
  if (mapped) return isPrivateOrLoopbackIpv4(mapped[1]!);
  // Plain IPv6: ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link-local).
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(host: string) {
    super(`refusing to fetch ${host}: resolves to a private, loopback, or link-local address`);
    this.name = "SsrfBlockedError";
  }
}

/** Throws SsrfBlockedError if `hostname` (already extracted from the
 * request URL, never re-parsed here) is, or resolves to, a private,
 * loopback, or link-local address. A bare IP literal is checked
 * directly; a real hostname is resolved via DNS first (a real lookup by
 * default; `dnsLookup` is a test-only override - see the interface's own
 * comment for why one exists at all). */
export async function assertNotPrivateHost(hostname: string, dnsLookup: DnsLookup = lookup): Promise<void> {
  // A code review (2026-09-05) found `new URL("http://[::1]/").hostname`
  // keeps its brackets ("[::1]"), which isIP() doesn't recognize at all -
  // every real IPv6-literal target, private or legitimately public, fell
  // through to a DNS lookup that fails with ENOTFOUND rather than being
  // correctly allowed or blocked. Bracket stripping only ever affects an
  // IPv6 literal's own delimiter syntax; it never changes what a real
  // hostname (never bracketed) resolves to.
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const literalFamily = isIP(bareHost);
  if (literalFamily) {
    if (isPrivateOrLoopbackIp(bareHost, literalFamily)) throw new SsrfBlockedError(hostname);
    return;
  }
  if (hostname === "localhost") throw new SsrfBlockedError(hostname);
  const { address, family } = await dnsLookup(hostname);
  if (isPrivateOrLoopbackIp(address, family)) throw new SsrfBlockedError(hostname);
}
