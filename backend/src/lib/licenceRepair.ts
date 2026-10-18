// LICENCE-ACK-01 (rule S6): the one admin prompt for a Home that never saw the wizard's licence wording is a Repairs item,
// raised while the household has no current acknowledgement and the AI engine lists a licensed part, resolved by the accept.
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { licenceOverview } from "@/lib/licenceFlow";

export const LICENCE_ISSUE = { source: "install", key: "licences.accept" } as const;

export async function syncLicenceIssue(): Promise<void> {
  const overview = await licenceOverview();
  if (overview.stack === "unreachable") return;
  if (overview.needs_prompt) {
    await raiseIssue({
      ...LICENCE_ISSUE, severity: "info", title: "Accept the licences for the AI models Home installs",
      detail: "Some AI models come with their maker's licence. Read the list and accept it once, and Home installs any of them without asking again.",
      learnMore: "/settings/models", suppressNotification: true,
    });
  } else resolveIssue(LICENCE_ISSUE.source, LICENCE_ISSUE.key, { suppressNotification: true });
}
