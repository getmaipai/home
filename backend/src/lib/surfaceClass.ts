// U4 (docs/plans/turn-machine-state-record-2026-09-22.md; RESP-01, folded
// into U4): the register follows the surface, declared once. A typed
// screen (chat, tv) gets the written register (full answers, structure,
// no act cap); voice (robot, pod, phone) keeps today's spoken register
// exactly; a shared glance surface (overlay) keeps the card. `spoken`
// forces the spoken class regardless of surface - a dictated chat turn
// (spoken input, typed screen) still gets the spoken register, since the
// person is listening, not reading; nothing sets it yet (no dictation
// marker exists today - RESP-01's own point 1), so this is plumbed and
// tested, ahead of a real caller.
import type { Surface } from "@/lib/turnEngine";

export type SurfaceClass = "written" | "spoken" | "glance";

export function surfaceClassOf(surface: Surface, spoken = false): SurfaceClass {
  if (spoken) return "spoken";
  if (surface === "chat" || surface === "tv") return "written";
  if (surface === "overlay") return "glance";
  return "spoken"; // robot, pod, phone
}
