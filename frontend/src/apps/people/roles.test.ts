import { describe, expect, test } from "bun:test";
import { creatableRoles, canManagePeople, requiresSecret } from "@/apps/people/roles";

describe("creatableRoles", () => {
  test("an owner can create any role, including another owner", () => {
    expect(creatableRoles("owner")).toContain("owner");
    expect(creatableRoles("owner")).toContain("admin");
  });

  test("an admin cannot create an owner or another admin", () => {
    expect(creatableRoles("admin")).not.toContain("owner");
    expect(creatableRoles("admin")).not.toContain("admin");
    expect(creatableRoles("admin")).toContain("adult");
  });

  test("a non-managing role can create no one", () => {
    expect(creatableRoles("adult")).toEqual([]);
    expect(creatableRoles("teen")).toEqual([]);
    expect(creatableRoles("child")).toEqual([]);
    expect(creatableRoles("guest")).toEqual([]);
  });
});

describe("canManagePeople", () => {
  test("owner and admin can manage people", () => {
    expect(canManagePeople("owner")).toBe(true);
    expect(canManagePeople("admin")).toBe(true);
  });

  test("everyone else cannot", () => {
    expect(canManagePeople("adult")).toBe(false);
    expect(canManagePeople("guest")).toBe(false);
  });
});

describe("requiresSecret", () => {
  test("owner, admin, and adult require a secret", () => {
    expect(requiresSecret("owner")).toBe(true);
    expect(requiresSecret("admin")).toBe(true);
    expect(requiresSecret("adult")).toBe(true);
  });

  test("teens, children, and guests do not require a secret", () => {
    expect(requiresSecret("teen")).toBe(false);
    expect(requiresSecret("child")).toBe(false);
    expect(requiresSecret("guest")).toBe(false);
  });
});
