import { describe, expect, test } from "bun:test";
import { summarizeApproval } from "@/lib/approvals";

describe("summarizeApproval", () => {
  test("install_package prefers packageName, then id, then a generic phrase", () => {
    expect(summarizeApproval("install_package", { packageName: "Weather", id: "pkg-1" })).toBe('install "Weather"');
    expect(summarizeApproval("install_package", { id: "pkg-1" })).toBe('install "pkg-1"');
    expect(summarizeApproval("install_package", {})).toBe('install "a package"');
  });
  test("browse_url names the url or a generic phrase", () => {
    expect(summarizeApproval("browse_url", { url: "https://example.com/page" })).toBe("browse https://example.com/page");
    expect(summarizeApproval("browse_url", {})).toBe("browse a website");
  });
  test("an unknown kind is returned as is", () => {
    expect(summarizeApproval("something_else", { url: "https://example.com" })).toBe("something_else");
  });
});
