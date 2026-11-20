// The speaker of a film's lines: the plan's one speaking character (its name), else the film's narration. Never an invented name. A small module of its own (no heavy imports), shared by the film runner, the voiced rough cut and the storyboard rows.
import type { FilmPlan } from "./plan";

export function speakerOfPlan(plan: Pick<FilmPlan, "cast">): { name: string; member: FilmPlan["cast"][number] | null } {
  const characters = plan.cast.filter((entry) => entry.kind === "character");
  return characters.length === 1 ? { name: characters[0]!.name, member: characters[0]! } : { name: "Narration", member: null };
}
