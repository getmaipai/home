// USE-AS-REFERENCE: "Use as a reference" sends a finished picture to Images Create as one of its (up to 3) reference pictures.
// It uses the same navigation state the Templates shelf uses (`pageState`), where `reference` joins ids with commas.
export const MAX_REFERENCES = 3;
export const REFERENCES_FULL_LINE = "The reference slot already holds 3 pictures. Remove one first.";

export type ReferenceHandoff = { ok: true; to: string; state: { pageState: { reference: string } } } | { ok: false; line: string };

/** `existing` is the comma-joined `reference` already chosen on Create. A chosen picture is kept: the new id is added, never swapped in. */
export function referenceHandoff(id: string, existing = ""): ReferenceHandoff {
  const held = existing.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (held.includes(id)) return { ok: true, to: "/apps/image/create", state: { pageState: { reference: held.join(",") } } };
  if (held.length >= MAX_REFERENCES) return { ok: false, line: REFERENCES_FULL_LINE };
  return { ok: true, to: "/apps/image/create", state: { pageState: { reference: [...held, id].join(",") } } };
}
