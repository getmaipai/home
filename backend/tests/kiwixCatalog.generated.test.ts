import { describe, expect, test } from "bun:test";
import { selectKiwixBinary } from "@/lib/kiwixCatalog";
import type { HardwareInfo } from "@/lib/hardware";

function hw(overrides: Partial<Pick<HardwareInfo, "platform" | "arch">> = {}): Pick<HardwareInfo, "platform" | "arch"> {
  return { platform: overrides.platform ?? "darwin", arch: overrides.arch ?? "arm64" };
}

describe("selectKiwixBinary", () => {
  test("the macOS arm64 release keeps its reviewed URL and checksum", () => {
    const result = selectKiwixBinary(hw({}));
    expect(result?.id).toBe("kiwix-tools-3.8.2-macos-arm64");
    expect(result?.archive.url).toBe(
      "https://download.kiwix.org/release/kiwix-tools/kiwix-tools_macos-arm64-3.8.2.tar.gz",
    );
    expect(result?.archive.sha256).toBe(
      "5c64d43176627e558a117146b02ea36b7da2b0cd3a332cbff075cde05d9585f9",
    );
    expect(result?.verified).toBe(true);
  });
});
