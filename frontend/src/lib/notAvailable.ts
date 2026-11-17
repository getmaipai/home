import { i18n } from "@lingui/core";

/**
 * UNSEEN-01 (RULES.md C10): the one fixed sentence for something a person may not use, for the few places no model is in the
 * loop. It gives no age, role, rule, rating or filter as a reason and never says the thing does not exist. A control the
 * person may not use is left off the screen instead; this line is only for a direct address or a call that still got through.
 */
export const NOT_AVAILABLE_HERE = (): string => i18n._({ id: "That one isn't available here. Try something else.", message: "That one isn't available here. Try something else." });
