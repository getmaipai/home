import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { decide } from "@/lib/gate/decide";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { photoUploadsAllowed } from "@/lib/chatPictures";
import { getPersonSettingValue, setValue } from "@/lib/settings";
import { createBenchPeople } from "../../scripts/bench/conversationRunner";
import { resetDb } from "../reset-db";

beforeEach(() => resetDb());

describe("GATE-04 media offer capabilities", () => {
  test("IMG-OFFER-01: show_images is offered to an adult only; the gate policy allows every band but the turn gate admits adults alone", () => {
    const { owner, child } = createBenchPeople();
    const teen = db.insert(people).values({ ...owner, id: "teen-media", displayName: "Teen", role: "teen" }).returning().get()!;
    const cases = [
      { actor: child, band: "child" as const, expected: false },
      { actor: teen, band: "teen" as const, expected: false },
      { actor: owner, band: "adult" as const, expected: true },
    ];
    for (const row of cases) {
      const decision = decide({ who: { personId: row.actor.id, role: row.actor.role as "child" | "teen" | "owner", band: row.band }, what: { capabilities: ["tool.offer:show_images"] } });
      expect(decision.kind).toBe("allow");
      expect(answerImagesAllowed({ actor: row.actor, band: row.band, surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false })).toBe(row.expected);
      expect(answerImagesAllowed({ actor: row.actor, band: row.band, surfaceClass: "spoken", spoken: true, temporary: false, bare: false, ephemeral: false })).toBe(false);
      expect(answerImagesAllowed({ actor: row.actor, band: row.band, surfaceClass: "written", spoken: false, temporary: true, bare: false, ephemeral: false })).toBe(false);
      expect(answerImagesAllowed({ actor: row.actor, band: row.band, surfaceClass: "written", spoken: false, temporary: false, bare: true, ephemeral: false })).toBe(false);
      expect(answerImagesAllowed({ actor: row.actor, band: row.band, surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: true })).toBe(false);
    }
    expect(setValue(owner, `person:${child.id}`, "reference.images", true).ok).toBe(true);
    // A parent turning the child's setting on no longer admits the child (owner ruling 2026-10-10: adults only).
    expect(answerImagesAllowed({ actor: child, band: "child", surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false })).toBe(false);
    // A teen who keeps the setting on (its default) is still not admitted.
    expect(getPersonSettingValue(teen, "reference.images")).not.toBe(false);
    expect(answerImagesAllowed({ actor: teen, band: "teen", surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false })).toBe(false);
  });

  test("photo upload setting gate remains exact for child, teen, and adult", () => {
    const { owner, child } = createBenchPeople();
    const teen = db.insert(people).values({ ...owner, id: "teen-upload", displayName: "Teen", role: "teen" }).returning().get()!;
    for (const band of ["child", "teen", "adult"] as const) {
      const actor = band === "child" ? child : band === "teen" ? teen : owner;
      const gate = decide({ who: { personId: actor.id, role: actor.role as "child" | "teen" | "owner", band }, what: { capabilities: ["upload.photo"] } });
      expect(gate).toMatchObject({ kind: "allow_with_limits", limits: ["setting_gated"] });
      if (band !== "child") expect(setValue(actor, `person:${actor.id}`, "chat.photo_uploads", false).ok).toBe(true);
      expect(photoUploadsAllowed(actor)).toBe(false);
    }
    expect(setValue(child, `person:${child.id}`, "chat.photo_uploads", true).ok).toBe(false);
    expect(setValue(owner, `person:${child.id}`, "chat.photo_uploads", true).ok).toBe(true);
    expect(setValue(teen, `person:${teen.id}`, "chat.photo_uploads", true).ok).toBe(true);
    expect(setValue(owner, `person:${owner.id}`, "chat.photo_uploads", true).ok).toBe(true);
    expect(photoUploadsAllowed(child)).toBe(true);
    expect(photoUploadsAllowed(teen)).toBe(true);
    expect(photoUploadsAllowed(owner)).toBe(true);
  });
});
