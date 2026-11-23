import { describe, expect, test } from "bun:test";
import { INCOGNITO_COMPANION_ID, incognitoHeaderCompanion } from "@/apps/chat/incognitoCompanion";

const selected = { companionId: "rivet", companionName: "Rivet", defaultCompanionId: "rivet", companions: [{ id: "rivet", name: "Rivet", portrait: "rivet/look1" }, { id: "bruno", name: "Bruno" }] };

describe("incognitoHeaderCompanion", () => {
  test("with Incognito off the header data is passed through untouched", () => {
    expect(incognitoHeaderCompanion(false, selected)).toBe(selected);
  });

  test("with Incognito on the header shows a generic companion: no selected id, no picker list, no remembered name", () => {
    expect(incognitoHeaderCompanion(true, selected)).toEqual({ companionId: null, companionName: "Companion", defaultCompanionId: null, companions: [] });
  });

  test("the generic companion id is the one the ambient companion uses", () => {
    expect(INCOGNITO_COMPANION_ID).toBe("incognito");
  });
});
