import { describe, expect, test } from "bun:test";
import { mapModelDownloadStackJob, mapStackJobToHomeJob } from "@/lib/jobProducers";

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: "job-abc123",
    kind: "image.generate",
    state: "running",
    percent: 40,
    completedBytes: 4,
    totalBytes: 10,
    status: "working",
    result: null,
    input: {},
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:01:00Z",
    ...over,
  }) as never;
const owner = { startedBy: "person-aaaaaa", forPerson: "person-bbbbbb", title: "A picture" };

describe("mapStackJobToHomeJob", () => {
  test("copies the job fields and takes the owner fields from the owner", () => {
    const home = mapStackJobToHomeJob(job(), owner);
    expect(home).toMatchObject({
      id: "job-abc123",
      kind: "image.generate",
      startedBy: "person-aaaaaa",
      forPerson: "person-bbbbbb",
      title: "A picture",
      state: "running",
      progress: { percent: 40, completedBytes: 4, totalBytes: 10, status: "working" },
      resultRef: null,
      errorKind: null,
      provenance: { producer: "stack", stackJobId: "job-abc123" },
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:01:00Z",
    });
  });
  test("resultRef is the result's fileId only when it is a string", () => {
    expect(mapStackJobToHomeJob(job({ result: { fileId: "file-abc123" } }), owner).resultRef).toBe("file-abc123");
    expect(mapStackJobToHomeJob(job({ result: { fileId: 7 } }), owner).resultRef).toBeNull();
    expect(mapStackJobToHomeJob(job({ result: "text" }), owner).resultRef).toBeNull();
  });
  test("a failed job carries errorKind failed", () => {
    expect(mapStackJobToHomeJob(job({ state: "failed" }), owner).errorKind).toBe("failed");
  });
});

describe("mapModelDownloadStackJob", () => {
  test("names the job after the model and marks it as system-started", () => {
    const home = mapModelDownloadStackJob(job({ kind: "model.install", input: { model: "qwen-small" } }));
    expect(home).toMatchObject({ id: "stack:job-abc123", kind: "model_download", startedBy: "system", forPerson: null, title: "qwen-small", errorKind: null });
    expect(home.provenance).toMatchObject({ producer: "stack", stackJobId: "job-abc123" });
  });
  test("falls back to the job id when the input has no model name", () => {
    expect(mapModelDownloadStackJob(job({ input: {} })).title).toBe("job-abc123");
  });
  test("a failed download carries errorKind failed", () => {
    expect(mapModelDownloadStackJob(job({ state: "failed" })).errorKind).toBe("failed");
  });
});
