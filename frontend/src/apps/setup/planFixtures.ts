import { buildAiCards, type AiCopy } from "../../../../shared/aiChoices";
import type { DiskPlan } from "../../../../shared/diskPlanMath";

export const fakeCopy: AiCopy = {
  card: (job) => ({ title: job === "videos" ? "Videos" : job === "pictures" ? "Pictures" : job === "picturesdetailed" ? "More picture styles" : `Job ${job}`, summary: `About ${job}.` }),
  choice: (id) => ({ label: id === "videos.detailed" ? "Detailed videos" : id === "videos.quick" ? "Quick videos" : `Choice ${id}`, description: `What ${id} does.` }),
};
export function cardsFor(plan: DiskPlan) {
  return buildAiCards({ copy: fakeCopy, plan, components: null, settings: { pictureQuickModel: "ernie", pictureDetailedEnabled: false, videoQuality: "quick", musicEnabled: false }, freeBytes: null });
}
