import { describe, expect, test } from "bun:test";
import { chooseNativeFolder, type Runner } from "@/lib/nativeFolderDialog";

const ok = (stdout: string): Runner => async () => ({ code: 0, stdout, stderr: "" });

describe("chooseNativeFolder", () => {
  test("a Mac folder choice comes back without its trailing slash", async () => {
    expect(await chooseNativeFolder("Pick", ok("/Volumes/Big/models/\n"), "darwin", {})).toEqual({ status: "chosen", path: "/Volumes/Big/models" });
  });
  test("closing the Mac window is a cancel, not an error", async () => {
    const run: Runner = async () => ({ code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" });
    expect(await chooseNativeFolder("Pick", run, "darwin", {})).toEqual({ status: "cancelled" });
  });
  test("Linux without a display falls back to the in-page picker", async () => {
    expect(await chooseNativeFolder("Pick", ok("/x"), "linux", {})).toEqual({ status: "unavailable" });
  });
  test("Linux with a display uses zenity, then kdialog when zenity is missing", async () => {
    const calls: string[] = [];
    const run: Runner = async (command) => { calls.push(command); return command === "zenity" ? null : { code: 0, stdout: "/home/me/m\n", stderr: "" }; };
    expect(await chooseNativeFolder("Pick", run, "linux", { DISPLAY: ":0" })).toEqual({ status: "chosen", path: "/home/me/m" });
    expect(calls).toEqual(["zenity", "kdialog"]);
  });
  test("a missing program or an unsupported system reports unavailable", async () => {
    expect(await chooseNativeFolder("Pick", async () => null, "darwin", {})).toEqual({ status: "unavailable" });
    expect(await chooseNativeFolder("Pick", ok("C:\\x"), "win32", {})).toEqual({ status: "unavailable" });
  });
});
