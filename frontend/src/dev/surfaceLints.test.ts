import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { scanSurfaces, type SurfaceAllow } from "@maipai/ui/src/surfaceLints";

// SURFACE-SYSTEM-01 (owner, 2026-11-13: modal shadows were square and did not match the rounded panel; one style everywhere).
// The scanner is the kit's own (`@maipai/ui/src/surfaceLints`), so the rule has one definition: a shadow sits on the element that
// has its radius and comes from the surface tokens (`--elev-*`, `--elevation-*`). Home draws a surface with a kit part or with
// a kit level utility (`surface-card`, `surface-float`, `surface-menu`, `surface-dialog`, `surface-sheet`), never with its own
// shadow class beside a radius class on another element. docs/design/RULES.md rule 9 still forbids shape classes on kit Elements.
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** The only places a shadow may stay off the surface tokens or apart from its radius. */
const ALLOW: SurfaceAllow[] = [
  {
    file: "src/lib/vision/faceCaptureFeedback.ts",
    match: /shadow-\[inset_0_0_36px_var\(--hue-green\)\]/,
    reason: "The face-capture camera frame glows green inside the video when the face is placed well: a status glow in a hue token over live camera pixels, not a surface.",
  },
];

describe("surface lint", () => {
  test("no shadow in Home sits off the surface tokens or apart from its radius", () => {
    const { findings, unused } = scanSurfaces(SRC, ALLOW);
    expect(findings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.text}`)).toEqual([]);
    expect(unused.map((u) => `${u.file} ${u.match}`)).toEqual([]);
  });
});
