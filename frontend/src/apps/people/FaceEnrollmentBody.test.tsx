import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { Card } from "@maipai/ui/src/ui/card";
import { MemoryRouter } from "react-router-dom";
import { FaceEnrollmentBody } from "@/apps/people/FaceEnrollmentBody";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);
const owner = { id: "person-owner", role: "owner" } as Roster;
const child = { id: "person-child", role: "child" } as Roster;
const enrolled = [{ id: "p1", person_id: "person-owner", modality: "face", model_id: "m", model_sha256: "x", dim: 1, captured_by: null, consent_at: "2026-09-01T00:00:00.000Z", consented_by_person_id: "person-owner", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", deleted_at: null, hlc: "x" }];
function setup(viewer: Roster, profile: Roster, prints: unknown[] = []) {
  const original = globalThis.fetch;
  const key = { key: "ui.enrollment_sounds", scope: "person", selector: "boolean", default: true, label: "Enrollment sounds", level: "basic", lives_in: "person.profile", honoured_by: ["home"] } as SettingsKey;
  globalThis.fetch = mock((input: RequestInfo | URL) => { const url = String(input); if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json(prints)); if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([key])); if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([{ key: key.key, value: true, source: "default", label: key.label, level: key.level, secret: false }])); return Promise.resolve(Response.json([])); }) as unknown as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><Card><FaceEnrollmentBody viewer={viewer} profile={profile} /></Card></MemoryRouter>);
  return { ...view, restore: () => { globalThis.fetch = original; } };
}
describe("FaceEnrollmentBody", () => {
  test("shows not set up and Enroll for a person without a face record", async () => { const s = setup(owner, owner); try { expect(await s.findByText("Not set up yet")).toBeTruthy(); expect(s.getByRole("link", { name: "Enroll" }).getAttribute("href")).toBe("/people/person-owner/enroll-face"); } finally { s.restore(); } });
  test("shows setup date and Re-enroll", async () => { const s = setup(owner, owner, enrolled); try { expect(await s.findByText("Set up on Sep 1, 2026")).toBeTruthy(); expect(s.getByRole("link", { name: "Re-enroll" })).toBeTruthy(); } finally { s.restore(); } });
  test("a child viewing their profile sees the admin sentence and no button or sounds switch", async () => { const s = setup(child, child); try { expect(await s.findByText("Ask an admin to set this up.")).toBeTruthy(); expect(s.queryByRole("link", { name: "Enroll" })).toBeNull(); expect(s.queryByRole("switch", { name: "Enrollment sounds" })).toBeNull(); } finally { s.restore(); } });
  test("a manager can enroll someone else and sees the sounds switch", async () => { const s = setup(owner, child); try { expect(await s.findByRole("link", { name: "Enroll" })).toBeTruthy(); expect(s.getByRole("switch", { name: "Enrollment sounds" })).toBeTruthy(); } finally { s.restore(); } });
});
