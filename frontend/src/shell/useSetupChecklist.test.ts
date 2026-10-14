import { describe, expect, test } from "bun:test";
import { setupChecklistCountLine } from "@/shell/useSetupChecklist";

describe("the setup checklist count line", () => {
  test("uses singular and plural wording and disappears at zero", () => {
    expect(setupChecklistCountLine(1)).toBe("1 thing left to finish setting up");
    expect(setupChecklistCountLine(3)).toBe("3 things left to finish setting up");
    expect(setupChecklistCountLine(0)).toBeNull();
  });
});
