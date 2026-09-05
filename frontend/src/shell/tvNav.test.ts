import { describe, expect, test, spyOn, beforeEach } from "bun:test";
import * as spatialNav from "@noriginmedia/norigin-spatial-navigation";
import { ensureTvNavInit, pauseTvNavForOverlay } from "@/shell/tvNav";

// A real regression test (docs/CLAUDE.md's testing standard): a code
// review, 2026-09-05, caught `pauseTvNavForOverlay` using a plain
// pause/resume toggle with no reference count, which breaks the moment
// two independent overlays (NotificationBell, ProfileSwitcher) can each
// be open at once - closing the second-opened one would resume the TV
// nav rail while the first overlay is still on screen.
describe("pauseTvNavForOverlay", () => {
  beforeEach(() => {
    ensureTvNavInit();
  });

  test("pauses on the first open and resumes once the last one closes", () => {
    const pause = spyOn(spatialNav, "pause");
    const resume = spyOn(spatialNav, "resume");
    try {
      pauseTvNavForOverlay(true);
      expect(pause).toHaveBeenCalledTimes(1);
      pauseTvNavForOverlay(false);
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      pause.mockRestore();
      resume.mockRestore();
    }
  });

  test("a second overlay opening while the first is still open does not double-pause, and closing it does not resume early", () => {
    const pause = spyOn(spatialNav, "pause");
    const resume = spyOn(spatialNav, "resume");
    try {
      pauseTvNavForOverlay(true); // bell opens
      pauseTvNavForOverlay(true); // switcher opens while bell is still open
      expect(pause).toHaveBeenCalledTimes(1);

      pauseTvNavForOverlay(false); // switcher closes; bell is still open
      expect(resume).not.toHaveBeenCalled();

      pauseTvNavForOverlay(false); // bell closes; nothing left open
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      pause.mockRestore();
      resume.mockRestore();
    }
  });
});
