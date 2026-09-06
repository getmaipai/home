import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import {
  normalizeEndpointUrl,
  guessEndpointKind,
  listHubEndpoints,
  listManagedEndpoints,
  addManagedEndpoint,
  removeManagedEndpoint,
  reorderEndpoints,
  nextEndpointPriority,
} from "@/lib/hubEndpoints";

beforeEach(() => {
  resetDb();
});

describe("normalizeEndpointUrl()", () => {
  test("adds http:// when no scheme is given", () => {
    expect(normalizeEndpointUrl("192.168.1.50:8787")).toBe("http://192.168.1.50:8787");
  });

  test("keeps an explicit https:// scheme", () => {
    expect(normalizeEndpointUrl("https://hub.example.ts.net")).toBe("https://hub.example.ts.net");
  });

  test("strips a path down to the origin", () => {
    expect(normalizeEndpointUrl("http://192.168.1.50:8787/some/path")).toBe("http://192.168.1.50:8787");
  });

  test("rejects empty input", () => {
    expect(normalizeEndpointUrl("   ")).toBeNull();
  });

  test("rejects genuinely unparseable input", () => {
    expect(normalizeEndpointUrl("http://")).toBeNull();
  });
});

describe("guessEndpointKind()", () => {
  test("classifies private ranges as lan", () => {
    expect(guessEndpointKind("http://192.168.1.50:8787")).toBe("lan");
    expect(guessEndpointKind("http://10.0.0.5:8787")).toBe("lan");
    expect(guessEndpointKind("http://172.16.0.1:8787")).toBe("lan");
  });

  test("classifies .local and localhost as lan", () => {
    expect(guessEndpointKind("http://maipai.local:8787")).toBe("lan");
    expect(guessEndpointKind("http://localhost:8787")).toBe("lan");
  });

  test("classifies a .ts.net MagicDNS name as overlay", () => {
    expect(guessEndpointKind("http://hub.example-tailnet.ts.net:8787")).toBe("overlay");
  });

  test("classifies a Tailscale CGNAT address as overlay", () => {
    expect(guessEndpointKind("http://100.64.1.2:8787")).toBe("overlay");
  });

  test("classifies a real public domain as public", () => {
    expect(guessEndpointKind("https://hub.example.com")).toBe("public");
  });

  // A code review (2026-09-06) found the original regex-based check
  // missed 169.254.0.0/16 (link-local, includes the cloud-metadata
  // address 169.254.169.254) and 0.0.0.0/8 entirely, misclassifying both
  // as "public" - reusing ssrfGuard.ts's own hardened check fixes this.
  test("classifies link-local addresses (including the cloud-metadata address) as lan, never public", () => {
    expect(guessEndpointKind("http://169.254.169.254:8787")).toBe("lan");
    expect(guessEndpointKind("http://169.254.1.1:8787")).toBe("lan");
  });
});

describe("addManagedEndpoint()/listManagedEndpoints()/removeManagedEndpoint()", () => {
  test("adds a row that shows up in listManagedEndpoints, priority-ordered", () => {
    const first = addManagedEndpoint("Office", "192.168.1.10:8787");
    const second = addManagedEndpoint("Cabin", "192.168.1.11:8787");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const rows = listManagedEndpoints();
    expect(rows.map((r) => r.name)).toEqual(["Office", "Cabin"]);
    expect(rows[0]!.priority).toBeLessThan(rows[1]!.priority);
  });

  test("refuses an unparseable address", () => {
    const result = addManagedEndpoint("Bad", "http://");
    expect(result.ok).toBe(false);
  });

  test("removeManagedEndpoint deletes the row and reports whether it existed", () => {
    const added = addManagedEndpoint("Office", "192.168.1.10:8787");
    expect(removeManagedEndpoint(added.value!.id)).toBe(true);
    expect(listManagedEndpoints()).toHaveLength(0);
    expect(removeManagedEndpoint(added.value!.id)).toBe(false);
  });

  // A code review (2026-09-06) found the first version started at 10,
  // colliding with DETECTED_LAN_PRIORITY (also 10) - the first managed
  // row would then tie with a detected LAN entry instead of sorting
  // after it as this file's own design intends.
  test("nextEndpointPriority starts past the detected-LAN priority, not colliding with it, and increases by 10 as rows are added", async () => {
    const detected = await listHubEndpoints();
    const detectedLanPriority = detected.find((r) => r.kind === "lan" && r.source === "detected")?.priority;
    const first = nextEndpointPriority();
    if (detectedLanPriority !== undefined) expect(first).toBeGreaterThan(detectedLanPriority);
    addManagedEndpoint("Office", "192.168.1.10:8787");
    expect(nextEndpointPriority()).toBe(first + 10);
  });

  test("reorderEndpoints reassigns 10, 20, 30 in the given order", () => {
    const a = addManagedEndpoint("A", "192.168.1.10:8787").value!;
    const b = addManagedEndpoint("B", "192.168.1.11:8787").value!;
    reorderEndpoints([b.id, a.id]);
    const rows = listManagedEndpoints();
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

describe("listHubEndpoints()", () => {
  test("includes at least one detected LAN address on a real machine", async () => {
    const rows = await listHubEndpoints();
    expect(rows.some((r) => r.source === "detected")).toBe(true);
  });

  test("a managed row with the same URL as a detected one wins (keeps the admin's name)", async () => {
    const detected = await listHubEndpoints();
    const lan = detected.find((r) => r.kind === "lan" && r.source === "detected");
    if (!lan) return; // no real LAN interface on this runner - nothing to dedupe against
    addManagedEndpoint("My Custom Name", lan.url);
    const merged = await listHubEndpoints();
    const match = merged.find((r) => r.url === lan.url);
    expect(match?.name).toBe("My Custom Name");
    expect(match?.source).toBe("managed");
  });
});
