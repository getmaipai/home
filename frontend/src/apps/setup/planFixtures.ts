import { buildAiCards, type AiCopy } from "../../../../shared/aiChoices";
import type { DiskPlan } from "../../../../shared/diskPlanMath";

export const fakeCopy: AiCopy = {
  card: (job) => ({ title: job === "videos" ? "Videos" : job === "pictures" ? "Pictures" : job === "picturesdetailed" ? "More picture styles" : job === "sounds" ? "Sound effects" : `Job ${job}`, summary: job === "sounds" ? "Make short sound effects and ambience, like rain or a door slam. Stays on this computer." : `About ${job}.` }),
  choice: (id) => ({ label: id === "videos.detailed" ? "Detailed videos" : id === "videos.quick" ? "Quick videos" : id === "music.sound" ? "Make better sound effects" : `Choice ${id}`, description: `What ${id} does.` }),
};
export function cardsFor(plan: DiskPlan) {
  return buildAiCards({ copy: fakeCopy, plan, components: null, settings: { pictureQuickModel: "ernie", pictureDetailedEnabled: false, videoQuality: "quick", musicEnabled: false }, freeBytes: null });
}
