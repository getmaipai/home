import { describe, expect, test, afterEach } from "bun:test";
import {
  osBootTimeMs,
  bootFollowedUncleanShutdown,
  windowsEventIndicatesUncleanBoot,
  macosPanicReportsIndicateUncleanBoot,
  linuxPreviousBootLogIndicatesUncleanShutdown,
  initCrashBootHold,
  isInCrashBootHold,
  crashBootHoldRemainingMs,
  __setCrashBootHoldForTests,
} from "@/lib/dirtyBoot";

afterEach(() => {
  __setCrashBootHoldForTests(null);
});

describe("osBootTimeMs()", () => {
  test("is a sane point in the past, derived from real process uptime", () => {
    const ms = osBootTimeMs();
    expect(ms).toBeLessThanOrEqual(Date.now());
    expect(ms).toBeGreaterThan(0);
  });
});

describe("bootFollowedUncleanShutdown() (real OS query on this machine)", () => {
  // Not asserting a specific outcome - genuinely don't know whether this
  // machine's last shutdown was clean - but a real call must resolve to a
  // plain boolean without throwing, on whichever platform CI/dev actually
  // runs on. This is the "prove the real mechanism, not a simulation of
  // it" half; the parsing logic itself is unit-tested below against
  // synthetic text so the interesting branches don't depend on this
  // machine's own shutdown history.
  test("resolves to a boolean, never throws, on the real platform", async () => {
    const result = await bootFollowedUncleanShutdown();
    expect(typeof result).toBe("boolean");
  });
});

describe("windowsEventIndicatesUncleanBoot()", () => {
  const bootTimeMs = Date.parse("2026-09-06T08:00:00Z");

  test("a Kernel-Power 41 event within the match window is unclean", () => {
    const xml = `<Event><System><TimeCreated SystemTime='2026-09-06T08:00:02.000Z'/></System></Event>`;
    expect(windowsEventIndicatesUncleanBoot(xml, bootTimeMs)).toBe(true);
  });

  test("an event far from boot time (a stale/old event) is not this boot's crash", () => {
    const xml = `<Event><System><TimeCreated SystemTime='2026-08-01T00:00:00.000Z'/></System></Event>`;
    expect(windowsEventIndicatesUncleanBoot(xml, bootTimeMs)).toBe(false);
  });

  test("no event at all (an empty query result) is clean", () => {
    expect(windowsEventIndicatesUncleanBoot("", bootTimeMs)).toBe(false);
  });

  test("unparseable XML is clean, not a thrown error", () => {
    expect(windowsEventIndicatesUncleanBoot("not xml at all", bootTimeMs)).toBe(false);
  });
});

describe("macosPanicReportsIndicateUncleanBoot()", () => {
  const bootTimeMs = Date.parse("2026-09-06T08:00:00Z");

  test("a panic report timestamped near boot is unclean", () => {
    const files = [{ name: "Kernel-2026-09-06-080002.panic", mtimeMs: Date.parse("2026-09-06T08:00:02Z") }];
    expect(macosPanicReportsIndicateUncleanBoot(files, bootTimeMs)).toBe(true);
  });

  test("an old panic report from days ago is not this boot's crash", () => {
    const files = [{ name: "Kernel-2026-09-01-000000.panic", mtimeMs: Date.parse("2026-09-01T00:00:00Z") }];
    expect(macosPanicReportsIndicateUncleanBoot(files, bootTimeMs)).toBe(false);
  });

  test("a non-.panic file near boot time (an ordinary crash report) does not count", () => {
    const files = [{ name: "SomeApp-2026-09-06-080002.crash", mtimeMs: Date.parse("2026-09-06T08:00:02Z") }];
    expect(macosPanicReportsIndicateUncleanBoot(files, bootTimeMs)).toBe(false);
  });

  test("no reports at all (an ordinary restart, or an unreadable directory) is clean", () => {
    expect(macosPanicReportsIndicateUncleanBoot([], bootTimeMs)).toBe(false);
  });

  // The exact false-positive a code review (2026-09-06) caught in the
  // first version (a pmset "Shutdown Cause" blocklist that treated
  // ordinary restarts as crashes): a panic-report-based check has no
  // equivalent ambiguous code to misread in the first place - an
  // ordinary restart simply never writes one of these files.
  test("an ordinary restart with no panic report is never flagged, regardless of anything else in the directory", () => {
    const files = [{ name: "SomeApp-2026-09-06-075959.crash", mtimeMs: Date.parse("2026-09-06T07:59:59Z") }];
    expect(macosPanicReportsIndicateUncleanBoot(files, bootTimeMs)).toBe(false);
  });
});

describe("linuxPreviousBootLogIndicatesUncleanShutdown()", () => {
  const twoBoots = "0 abc123 Sat 2026-09-06\n-1 def456 Fri 2026-09-05";

  test("a previous boot log ending with a clean shutdown target is clean", () => {
    const log = "Sep 05 23:59:00 host systemd[1]: Reached target Shutdown.";
    expect(linuxPreviousBootLogIndicatesUncleanShutdown(twoBoots, log)).toBe(false);
  });

  // A code review (2026-09-06) found the original pattern only matched
  // "Reached target ...Shutdown" - newer systemd splits that into
  // separate Reboot/Power-Off/Halt targets with their own wording, which
  // would have misclassified a perfectly clean shutdown on a newer distro
  // as unclean.
  test("newer systemd's split Reboot/Power-Off/Halt target wording is also recognized as clean", () => {
    expect(linuxPreviousBootLogIndicatesUncleanShutdown(twoBoots, "systemd[1]: Reached target Reboot.")).toBe(false);
    expect(linuxPreviousBootLogIndicatesUncleanShutdown(twoBoots, "systemd[1]: Reached target Power-Off.")).toBe(false);
    expect(linuxPreviousBootLogIndicatesUncleanShutdown(twoBoots, "systemd[1]: Reached target Halt.")).toBe(false);
  });

  test("a previous boot log with no shutdown/halt line at all is unclean", () => {
    const log = "Sep 05 23:59:00 host kernel: some last message before it just stopped";
    expect(linuxPreviousBootLogIndicatesUncleanShutdown(twoBoots, log)).toBe(true);
  });

  test("only one boot recorded (nothing to compare against) is clean, best-effort", () => {
    expect(linuxPreviousBootLogIndicatesUncleanShutdown("0 abc123 Sat 2026-09-06", "anything")).toBe(false);
  });

  test("no journalctl output at all (non-systemd distro) is clean, best-effort", () => {
    expect(linuxPreviousBootLogIndicatesUncleanShutdown("", "")).toBe(false);
  });
});

describe("the crash-boot hold", () => {
  test("isInCrashBootHold() is false with nothing set", () => {
    expect(isInCrashBootHold()).toBe(false);
    expect(crashBootHoldRemainingMs()).toBe(0);
  });

  test("__setCrashBootHoldForTests() drives isInCrashBootHold() directly", () => {
    __setCrashBootHoldForTests(Date.now() + 60_000);
    expect(isInCrashBootHold()).toBe(true);
    expect(crashBootHoldRemainingMs()).toBeGreaterThan(0);
  });

  test("a hold time in the past reports not-held", () => {
    __setCrashBootHoldForTests(Date.now() - 1_000);
    expect(isInCrashBootHold()).toBe(false);
    expect(crashBootHoldRemainingMs()).toBe(0);
  });

  test("initCrashBootHold() sets a hold only when the OS reports an unclean boot", async () => {
    // Whatever this real machine's own history says, initCrashBootHold()
    // must be internally consistent with bootFollowedUncleanShutdown()'s
    // own real answer - proving the wiring between the two rather than
    // asserting a specific outcome neither test controls.
    const wasUnclean = await bootFollowedUncleanShutdown();
    await initCrashBootHold();
    expect(isInCrashBootHold()).toBe(wasUnclean);
  });
});
