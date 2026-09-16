import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Attachment } from "@maipai/spec/gen/ts/attachment.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { createHost } from "@/lib/packageHost";
import {
  __setRapidOcrRunnerForTests,
  __setTikaRunnerForTests,
  extractDocument,
  MAX_DOCUMENT_BYTES,
  runRapidOcr,
} from "@/lib/documentExtraction";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __setTikaRunnerForTests(null);
  __setRapidOcrRunnerForTests(null);
});

afterEach(() => {
  __setTikaRunnerForTests(null);
  __setRapidOcrRunnerForTests(null);
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function manifest(permissions: string[] = []): PackageManifest {
  return PackageManifest.parse({
    id: "test-document-extraction",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Document extraction test",
    description: "Document extraction test package.",
    author: "test",
    license: "AGPL-3.0",
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    min_app: "0.1.0",
    tier: 0,
    permissions,
  });
}

describe("local document extraction", () => {
  test("uses one Tika runner for PDF and office input and preserves page numbers", async () => {
    const calls: string[] = [];
    __setTikaRunnerForTests(async (bytes, mediaType) => {
      calls.push(`${mediaType}:${new TextDecoder().decode(bytes)}`);
      return mediaType === "application/pdf" ? "page one\fpage two" : "office text";
    });

    const pdf = await extractDocument(new TextEncoder().encode("pdf-fixture"), "application/pdf");
    const office = await extractDocument(new TextEncoder().encode("docx-fixture"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(pdf).toEqual({ ok: true, value: { media_type: "application/pdf", pages: [{ page: 1, text: "page one" }, { page: 2, text: "page two" }], parser: "tika" } });
    expect(office).toEqual({ ok: true, value: { media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pages: [{ page: 1, text: "office text" }], parser: "tika" } });
    expect(calls).toEqual(["application/pdf:pdf-fixture", "application/vnd.openxmlformats-officedocument.wordprocessingml.document:docx-fixture"]);
  });

  test("rejects unsupported and oversized input before a parser call", async () => {
    let calls = 0;
    __setTikaRunnerForTests(async () => {
      calls++;
      return "should not run";
    });
    expect(await extractDocument(new Uint8Array([1]), "text/plain")).toEqual({ ok: false, status: 400, error: "unsupported document type" });
    expect(await extractDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "application/pdf")).toEqual({ ok: false, status: 413, error: "document is too large to extract" });
    expect(calls).toBe(0);
  });

  test("maps parser failure to a safe result without returning upload bytes", async () => {
    const secret = "private upload bytes";
    __setTikaRunnerForTests(async () => {
      throw new Error(secret);
    });
    const result = await extractDocument(new TextEncoder().encode(secret), "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("document extraction failed");
      expect(result.error).not.toContain(secret);
    }
  });

  test("local OCR is permission-gated and does not send an image to an external service", async () => {
    const image = new TextEncoder().encode("scan bytes");
    let received: Uint8Array | null = null;
    __setRapidOcrRunnerForTests((bytes, mediaType) => {
      received = bytes;
      expect(mediaType).toBe("image/png");
      return "recognized text";
    });
    expect(runRapidOcr(image, "image/png")).toEqual({ ok: true, text: "recognized text" });
    expect(received ?? new Uint8Array()).toEqual(image);

    const actor = await owner();
    const host = createHost(actor, manifest(["ocr"]));
    expect(host.ocr.read({ bytes: image, media_type: "image/png" })).toBe("recognized text");
    expect(() => createHost(actor, manifest()).ocr.read({ bytes: image, media_type: "image/png" })).toThrow(HostError);
  });

  test("OCR failure becomes a typed capability result and never includes raw bytes", () => {
    const secret = "secret scan bytes";
    __setRapidOcrRunnerForTests(() => {
      throw new Error("runner stopped");
    });
    const result = runRapidOcr(new TextEncoder().encode(secret), "image/png");
    expect(result).toEqual({ ok: false, code: "internal_error", error: "OCR failed: runner stopped" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(Attachment.shape.media_type.safeParse("image/png").success).toBe(true);
  });
});
