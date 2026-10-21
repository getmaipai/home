// ZIM-IMG-01 task 1: fetchAnswerImages reads a `library:` source from the
// household's own kiwix-serve sidecar (`/raw/<book>/<path>`) instead of the
// open web, offline and deterministic - the injected fetch stands in for the
// sidecar, the sidecar's own base URL comes from the registry the same way
// production's does (registerSidecar, never a setting or env).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchAnswerImages, parseLibraryImageUrl, libraryImageUrl, __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { registerSidecar, unregisterSidecar } from "@/lib/sidecars";
import { KIWIX_SIDECAR_ID } from "@/lib/kiwixSidecar";
import { syntheticPhoto } from "./answerImagesFixture";

const PORT = 18_790;
const BASE = `http://127.0.0.1:${PORT}`;
const SOURCE = "library:wikipedia_en_all_maxi/I/cat.jpg";

// Registered, never started: getSidecar() (kiwixBaseUrl()'s own read) only
// needs the declaration's port, the way kiwixSidecar.test.ts proves the base
// URL from the registered sidecar.
function sidecarUp(): void {
  registerSidecar({ id: KIWIX_SIDECAR_ID, command: ["/bin/true"], port: PORT });
}

beforeEach(() => {
  unregisterSidecar(KIWIX_SIDECAR_ID);
  __resetAnswerImageFetchForTests();
});

afterEach(() => {
  unregisterSidecar(KIWIX_SIDECAR_ID);
  __resetAnswerImageFetchForTests();
});

describe("fetchAnswerImages reads library: sources from the sidecar", () => {
  test("a library: picture comes from the sidecar's own /raw endpoint", async () => {
    sidecarUp();
    const bytes = await syntheticPhoto(7);
    const seen: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      seen.push(input.toString());
      return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const result = await fetchAnswerImages([{ id: "lib", url: SOURCE }], { fetch: fetcher as unknown as typeof fetch });
    expect(seen).toEqual([`${BASE}/raw/wikipedia_en_all_maxi/I/cat.jpg`]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.id).toBe("lib");
    expect(result.originals["lib"]).toBe(SOURCE);
  });

  test("a library: picture served as html is dropped", async () => {
    sidecarUp();
    let calls = 0;
    const fetcher = async () => { calls++; return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }); };
    const result = await fetchAnswerImages([{ id: "lib", url: SOURCE }], { fetch: fetcher as unknown as typeof fetch });
    expect(calls).toBe(1);
    expect(result.images).toHaveLength(0);
  });

  test("no sidecar registered: the library picture is dropped as library_unavailable, and nothing is fetched", async () => {
    const fetcher = async () => { throw new Error("the sidecar is down; fetch must not be called"); };
    const result = await fetchAnswerImages([{ id: "lib", url: SOURCE }], { fetch: fetcher as unknown as typeof fetch });
    expect(result.images).toHaveLength(0);
    expect(result.dropped_by_fetch.library_unavailable).toBe(1);
  });

  test("a library: source only ever reaches the sidecar's own host", async () => {
    sidecarUp();
    const bytes = await syntheticPhoto(8);
    const seen: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      seen.push(input.toString());
      return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    await fetchAnswerImages([
      { id: "one", url: SOURCE },
      { id: "two", url: libraryImageUrl("vikidia_en_all_nopic", "I/a b.png") },
    ], { fetch: fetcher as unknown as typeof fetch });
    expect(seen).toHaveLength(2);
    for (const raw of seen) expect(new URL(raw).host).toBe(new URL(BASE).host);
  });
});

describe("parseLibraryImageUrl", () => {
  test("rejects traversal and empty pieces", () => {
    expect(parseLibraryImageUrl("library:b/../x")).toBeNull();
    expect(parseLibraryImageUrl("library:b/./x")).toBeNull();
    expect(parseLibraryImageUrl("library:/x")).toBeNull();
    expect(parseLibraryImageUrl("library:b/")).toBeNull();
    expect(parseLibraryImageUrl("library:b")).toBeNull();
    expect(parseLibraryImageUrl("https://example/library")).toBeNull();
  });

  test("round-trips libraryImageUrl with a space in the path", () => {
    const url = libraryImageUrl("vikidia_en_all_nopic", "I/a b.png");
    expect(parseLibraryImageUrl(url)).toEqual({ book: "vikidia_en_all_nopic", imagePath: "I/a b.png" });
  });
});
