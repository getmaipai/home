import { describe, expect, test } from "bun:test";
import { getHomeSupervisorRoles } from "@/lib/homeSupervisorRoles";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests } from "@/lib/stackEngine";

describe("Home role state without a configured Stack", () => {
  test("does not report a Home-owned chat engine as ready", async () => {
    setHouseholdSettingValue("engines.stack.url", "");
    __setStackClientForTests(null);
    const roles = await getHomeSupervisorRoles();
    const chat = roles.find((role) => role.id === "chat")!;
    expect(chat.state.state).toBe("offline");
    expect(chat.state.reason).toBe("The MaiPai Stack is not configured.");
    expect(chat.endpoints).toEqual([]);
  });
});
