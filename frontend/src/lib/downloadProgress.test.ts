import { describe, expect, test } from "bun:test";
import { downloadProgress, nextByteRates } from "@/lib/downloadProgress";
import { referenceDownload } from "@/apps/settings/ReferenceLibrarySettings";

const job = (state: "queued" | "waiting_window" | "downloading" | "paused" | "failed", completedBytes = 1_000_000) =>
  ({ id: "j1", setId: "wikipedia-en:maxi", state, completedBytes, totalBytes: 119_000_000_000, message: state === "waiting_window" ? "Waiting for the nightly download window." : null });

describe("downloadProgress", () => {
  test("a book waiting for the nightly window shows as queued with the reason in plain words", () => {
    expect(downloadProgress(referenceDownload(job("waiting_window"), "Wikipedia"))).toMatchObject({ downloadState: "queued", downloadStatus: expect.stringContaining("nightly download window"), completedBytes: 1_000_000, totalBytes: 119_000_000_000 });
  });
  test("a running book download gets speed and time left once a rate is known", () => {
    const view = downloadProgress(referenceDownload(job("downloading", 19_000_000_000), "Wikipedia", 50_000_000));
    expect(view).toMatchObject({ downloadState: "running", bytesPerSecond: 50_000_000, etaSeconds: 2000 });
  });
  test("a paused download carries no speed", () => {
    expect(downloadProgress(referenceDownload(job("paused"), "Wikipedia", 50_000_000)).bytesPerSecond).toBeUndefined();
  });
  test("a failed download ends with a failed outcome", () => {
    expect(downloadProgress(referenceDownload(job("failed"), "Wikipedia"))).toMatchObject({ outcome: { status: "failed" } });
  });
});

describe("nextByteRates", () => {
  test("the rate comes from two polls and is smoothed after that", () => {
    let samples = nextByteRates(new Map(), [{ id: "a", completedBytes: 0, running: true }], 0);
    expect(samples.get("a")?.rate).toBeUndefined();
    samples = nextByteRates(samples, [{ id: "a", completedBytes: 10_000_000, running: true }], 1000);
    expect(samples.get("a")?.rate).toBe(10_000_000);
    samples = nextByteRates(samples, [{ id: "a", completedBytes: 30_000_000, running: true }], 2000);
    expect(samples.get("a")?.rate).toBe(13_000_000);
  });
  test("a paused or finished job drops out", () => {
    const samples = nextByteRates(new Map([["a", { bytes: 5, at: 0, rate: 1 }]]), [{ id: "a", completedBytes: 5, running: false }], 1000);
    expect(samples.size).toBe(0);
  });
});
