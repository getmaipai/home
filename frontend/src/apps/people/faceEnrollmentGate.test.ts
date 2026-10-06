import { describe, expect, test } from "bun:test";
import { canEnrollFace } from "@/apps/people/faceEnrollmentGate";

describe("canEnrollFace", () => {
  test("a child can never enroll themself, even though canManagePerson allows self-edit", () => {
    const child = { id: "person-child", role: "child" as const };
    expect(canEnrollFace(child, child)).toBe(false);
  });

  test("an adult can enroll themself", () => {
    const adult = { id: "person-adult", role: "adult" as const };
    expect(canEnrollFace(adult, adult)).toBe(true);
  });

  test("a teen can directly consent to their own enrollment", () => {
    const teen = { id: "person-teen", role: "teen" as const };
    expect(canEnrollFace(teen, teen)).toBe(true);
  });

  test("an admin cannot enroll a teen on their behalf", () => {
    const admin = { id: "person-admin", role: "admin" as const };
    const teen = { id: "person-teen", role: "teen" as const };
    expect(canEnrollFace(admin, teen)).toBe(false);
  });

  test("a guest cannot enroll", () => {
    const guest = { id: "person-guest", role: "guest" as const };
    expect(canEnrollFace(guest, guest)).toBe(false);
    const owner = { id: "person-owner", role: "owner" as const };
    expect(canEnrollFace(owner, guest)).toBe(false);
  });

  test("an owner can enroll a child", () => {
    const owner = { id: "person-owner", role: "owner" as const };
    const child = { id: "person-child", role: "child" as const };
    expect(canEnrollFace(owner, child)).toBe(true);
  });

  test("an admin can enroll a child", () => {
    const admin = { id: "person-admin", role: "admin" as const };
    const child = { id: "person-child", role: "child" as const };
    expect(canEnrollFace(admin, child)).toBe(true);
  });

  test("an adult cannot enroll another adult", () => {
    const actor = { id: "person-a", role: "adult" as const };
    const target = { id: "person-b", role: "adult" as const };
    expect(canEnrollFace(actor, target)).toBe(false);
  });

  test("a teen cannot enroll a child", () => {
    const teen = { id: "person-teen", role: "teen" as const };
    const child = { id: "person-child", role: "child" as const };
    expect(canEnrollFace(teen, child)).toBe(false);
  });
});
