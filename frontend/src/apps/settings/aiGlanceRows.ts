// The job list the setup wizard draws its plan step from (icons, order, hub parts). The Settings page reads the Stack's rows
// through the kit StackModelsPage; the staged-change and projection code that lived here served the old glance page and is gone.
import type { AiCard, AiChoice } from "../../../../shared/aiChoices";
import type { AiJobId } from "../../../../shared/aiJobs";

export const JOB_ORDER: AiJobId[] = ["chat", "pictures", "picturesdetailed", "videos", "music", "sounds", "stems", "voice", "wakeword", "vision", "coding", "faces", "ingredients"];
/** The icon name of each job, shared by Settings and the setup wizard. */
export const JOB_ICONS: Record<AiJobId, string> = { chat: "message-circle", pictures: "palette", picturesdetailed: "sparkles", videos: "film", music: "music", sounds: "audio-waveform", stems: "audio-waveform", voice: "mic-vocal", wakeword: "ear", vision: "eye", coding: "code", faces: "users", ingredients: "clapperboard" };
/** Jobs the hub installs itself (its own pinned files or one Stack library entry), with no On/Off engine setting: the switch installs or removes them through the choose route. */
export const HUB_PART_JOBS: ReadonlySet<AiJobId> = new Set<AiJobId>(["wakeword", "faces", "ingredients"]);
const HIDDEN = new Set(["pictures.edit"]);

/** The models a person picks between for a job: the radio and fixed choices (plus the Apple-chip chat engine and any choice the card starts on), or the job's own switch. */
export function optionsOf(card: AiCard): AiChoice[] {
  // WAN-DEFAULT-01: a choice flagged defaultOn (the minors-only video model, listed only where a child or teen lives) is an option beside the radio choices (the setup wizard reads this list).
  const picks = card.choices.filter((choice) => (choice.kind === "radio" || choice.kind === "fixed" || choice.id === "chat.mlx" || choice.defaultOn === true) && !HIDDEN.has(choice.id));
  return picks.length > 0 ? picks : card.choices.filter((choice) => choice.kind === "switch" && !HIDDEN.has(choice.id)).slice(0, 1);
}
