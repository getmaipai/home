import { i18n } from "@lingui/core";

/** I18N-B2: the "Could not ${verb}." sentence of useHubMutation, one catalog message per verb. Every `verb:` a screen passes has a row
 * here (hubMutationVerbs.test.ts walks the source); a verb with no row falls back to the English sentence, so a new call site never breaks. */
const COULD_NOT: Record<string, () => string> = {
  "change the timer": () => i18n._({ id: "Could not change the timer.", message: "Could not change the timer." }),
  "change this chat's companion": () => i18n._({ id: "Could not change this chat's companion.", message: "Could not change this chat's companion." }),
  "complete engine setup": () => i18n._({ id: "Could not complete engine setup.", message: "Could not complete engine setup." }),
  "delete the alarm": () => i18n._({ id: "Could not delete the alarm.", message: "Could not delete the alarm." }),
  "delete the quick timer": () => i18n._({ id: "Could not delete the quick timer.", message: "Could not delete the quick timer." }),
  "revoke the link key": () => i18n._({ id: "Could not revoke the link key.", message: "Could not revoke the link key." }),
  "save access": () => i18n._({ id: "Could not save access.", message: "Could not save access." }),
  "save the alarm": () => i18n._({ id: "Could not save the alarm.", message: "Could not save the alarm." }),
  "save the quick timer": () => i18n._({ id: "Could not save the quick timer.", message: "Could not save the quick timer." }),
  "save your appearance": () => i18n._({ id: "Could not save your appearance.", message: "Could not save your appearance." }),
  "skip the next alarm": () => i18n._({ id: "Could not skip the next alarm.", message: "Could not skip the next alarm." }),
  "test the connection": () => i18n._({ id: "Could not test the connection.", message: "Could not test the connection." }),
  "update reminders": () => i18n._({ id: "Could not update reminders.", message: "Could not update reminders." }),
  "update the alarm": () => i18n._({ id: "Could not update the alarm.", message: "Could not update the alarm." }),
  "update the reminder": () => i18n._({ id: "Could not update the reminder.", message: "Could not update the reminder." }),
};

export const HUB_MUTATION_VERBS: readonly string[] = Object.keys(COULD_NOT);

/** "Could not <verb>." in the person's language; English for a verb the table does not have. */
export function couldNotLine(verb: string): string {
  return COULD_NOT[verb]?.() ?? `Could not ${verb}.`;
}
