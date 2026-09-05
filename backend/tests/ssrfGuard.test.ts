import { describe, expect, test } from "bun:test";
import { assertNotPrivateHost, SsrfBlockedError, type DnsLookup } from "@/lib/ssrfGuard";

describe("assertNotPrivateHost", () => {
  test("blocks IPv4 loopback, private, and link-local literals directly, no DNS involved", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1"]) {
      await expect(assertNotPrivateHost(ip)).rejects.toThrow(SsrfBlockedError);
    }
  });

  test("does not block a public-looking IPv4 literal", async () => {
    await expect(assertNotPrivateHost("93.184.216.34")).resolves.toBeUndefined();
  });

  test("172.15.x and 172.32.x are outside the 172.16.0.0/12 private range and are not blocked", async () => {
    await expect(assertNotPrivateHost("172.15.0.1")).resolves.toBeUndefined();
    await expect(assertNotPrivateHost("172.32.0.1")).resolves.toBeUndefined();
  });

  test("blocks IPv6 loopback and unique-local literals", async () => {
    await expect(assertNotPrivateHost("::1")).rejects.toThrow(SsrfBlockedError);
    await expect(assertNotPrivateHost("fd00::1")).rejects.toThrow(SsrfBlockedError);
    await expect(assertNotPrivateHost("fe80::1")).rejects.toThrow(SsrfBlockedError);
  });

  test("blocks the literal hostname 'localhost' without ever consulting DNS", async () => {
    const neverCalled: DnsLookup = () => {
      throw new Error("should never be called for 'localhost'");
    };
    await expect(assertNotPrivateHost("localhost", neverCalled)).rejects.toThrow(SsrfBlockedError);
  });

  test("a real hostname is checked against what it resolves to, via the injected resolver", async () => {
    const resolvesPrivate: DnsLookup = async () => ({ address: "10.1.2.3", family: 4 });
    await expect(assertNotPrivateHost("internal.example", resolvesPrivate)).rejects.toThrow(SsrfBlockedError);

    const resolvesPublic: DnsLookup = async () => ({ address: "93.184.216.34", family: 4 });
    await expect(assertNotPrivateHost("public.example", resolvesPublic)).resolves.toBeUndefined();
  });

  // A code review (2026-09-05) found the IPv6 branch missed IPv4-mapped
  // addresses (::ffff:a.b.c.d - a real, legitimate form a DNS lookup can
  // return) entirely: isIP() reports family 6 for these, so without this
  // fix they sailed through as "public" while actually naming a private/
  // loopback/link-local IPv4 target underneath.
  test("blocks an IPv4-mapped IPv6 literal whose embedded address is private, loopback, or link-local", async () => {
    await expect(assertNotPrivateHost("::ffff:127.0.0.1")).rejects.toThrow(SsrfBlockedError);
    await expect(assertNotPrivateHost("::ffff:192.168.1.1")).rejects.toThrow(SsrfBlockedError);
    await expect(assertNotPrivateHost("::ffff:169.254.169.254")).rejects.toThrow(SsrfBlockedError); // the classic cloud metadata address
  });

  test("does not block an IPv4-mapped IPv6 literal whose embedded address is genuinely public", async () => {
    await expect(assertNotPrivateHost("::ffff:93.184.216.34")).resolves.toBeUndefined();
  });

  test("an IPv4-mapped address is also caught when it's what a hostname resolves to, not just a literal", async () => {
    const resolvesToMappedPrivate: DnsLookup = async () => ({ address: "::ffff:10.0.0.5", family: 6 });
    await expect(assertNotPrivateHost("sneaky.example", resolvesToMappedPrivate)).rejects.toThrow(SsrfBlockedError);
  });

  // A code review (2026-09-05) found new URL("http://[::1]/").hostname
  // keeps its brackets ("[::1]"), which isIP() doesn't recognize at all -
  // every real IPv6-literal target, private or legitimately public, fell
  // through to a DNS lookup that fails with ENOTFOUND instead of being
  // correctly allowed or blocked.
  test("recognizes a bracketed IPv6 literal (the real form URL.hostname produces) as the literal it is", async () => {
    const neverCalled: DnsLookup = () => {
      throw new Error("should never reach DNS for a real IP literal");
    };
    await expect(assertNotPrivateHost("[::1]", neverCalled)).rejects.toThrow(SsrfBlockedError);
    await expect(assertNotPrivateHost("[fd00::1]", neverCalled)).rejects.toThrow(SsrfBlockedError);
  });

  test("a bracketed, genuinely public IPv6 literal is allowed, not misclassified as unreachable", async () => {
    const neverCalled: DnsLookup = () => {
      throw new Error("should never reach DNS for a real IP literal");
    };
    await expect(assertNotPrivateHost("[2001:4860:4860::8888]", neverCalled)).resolves.toBeUndefined();
  });
});
