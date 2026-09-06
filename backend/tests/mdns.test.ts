import { describe, expect, test, afterEach } from "bun:test";
import { Bonjour } from "bonjour-service";
import { resetDb } from "./reset-db";
import { __resetHubIdentityForTests, setHubName } from "@/lib/hubIdentity";
import { advertiseMdns, stopMdnsAdvertisement, isMdnsAdvertising } from "@/lib/mdns";

afterEach(async () => {
  await stopMdnsAdvertisement();
  resetDb();
  __resetHubIdentityForTests();
});

describe("advertiseMdns()/stopMdnsAdvertisement()", () => {
  test("isMdnsAdvertising() reflects a real start/stop cycle", async () => {
    expect(isMdnsAdvertising()).toBe(false);
    await advertiseMdns({ port: 48790, tls: false });
    expect(isMdnsAdvertising()).toBe(true);
    await stopMdnsAdvertisement();
    expect(isMdnsAdvertising()).toBe(false);
  });

  test("calling it twice restarts cleanly rather than erroring or leaking a second advertisement", async () => {
    await advertiseMdns({ port: 48791, tls: false });
    await advertiseMdns({ port: 48791, tls: true });
    expect(isMdnsAdvertising()).toBe(true);
  });

  // The real end-to-end proof: a separate mDNS browser (bonjour-service's
  // own `.find()`, the same API a real client would use) actually
  // discovers this hub on the network and reads back the TXT fields
  // this file's own header documents - not just "the library was called
  // with the right-looking arguments."
  test("a real mDNS browser discovers the advertised service with the documented TXT fields", async () => {
    setHubName("Test Hub");
    await advertiseMdns({ port: 48792, tls: true });

    const browser = new Bonjour();
    try {
      const found = await new Promise<{ txt?: Record<string, string>; port: number }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("mDNS discovery timed out")), 8_000);
        browser.find({ type: "maipai" }, (svc) => {
          if (svc.port !== 48792) return; // ignore anything else answering this type on this machine
          clearTimeout(timeout);
          resolve(svc as { txt?: Record<string, string>; port: number });
        });
      });
      expect(found.txt?.name).toBe("Test Hub");
      expect(found.txt?.tls).toBe("1");
      expect(found.txt?.v).toBe("1");
      expect(typeof found.txt?.id).toBe("string");
      expect(found.txt?.id?.length).toBeGreaterThan(0);
    } finally {
      browser.destroy();
    }
  }, 15_000);
});
