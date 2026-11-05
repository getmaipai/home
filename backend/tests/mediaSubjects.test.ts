import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaSubject, deleteMediaSubject, listMediaSubjects, shareMediaSubject, subjectsForNames } from "@/lib/mediaSubjects";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

function addPerson(id: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}

describe("saved picture subjects", () => {
  beforeEach(() => resetDb());

  test("are private by default, explicitly shareable, and deletable by their owner", () => {
    const owner = addPerson("subject-owner", "adult");
    const other = addPerson("subject-other", "adult");
    const subject = createMediaSubject(owner, { name: "Blue house", kind: "place", look: "A blue house" });
    expect(listMediaSubjects(other)).toEqual([]);
    expect(shareMediaSubject(owner, subject.id, other.id, true)?.shared_with).toContain(other.id);
    expect(listMediaSubjects(other).map((row) => row.id)).toEqual([subject.id]);
    expect(deleteMediaSubject(other, subject.id)).toBe(false);
    expect(deleteMediaSubject(owner, subject.id)).toBe(true);
    expect(listMediaSubjects(other)).toEqual([]);
  });

  test("real-person subjects are refused for children and teens and cannot be selected", () => {
    const child = addPerson("subject-child", "child");
    const teen = addPerson("subject-teen", "teen");
    const adult = addPerson("subject-adult", "adult");
    expect(() => createMediaSubject(child, { name: "Person", kind: "character", look: "person", real: true })).toThrow(/Real-person/);
    expect(() => createMediaSubject(teen, { name: "Person", kind: "character", look: "person", real: true })).toThrow(/Real-person/);
    const real = createMediaSubject(adult, { name: "Person", kind: "character", look: "person", real: true });
    shareMediaSubject(adult, real.id, child.id, true);
    expect(subjectsForNames(child, [real.name])).toBeNull();
  });
});
