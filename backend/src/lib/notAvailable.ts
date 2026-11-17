/**
 * UNSEEN-01 (RULES.md C10): the one fixed sentence for a feature a person may not use, said only where no model
 * is in the loop (an API error, a direct call to a route). It gives no age, role, rule, rating or filter as the
 * reason and never says the thing does not exist. Inside a chat turn the model is told instead and words the
 * redirect itself (chat rule 6); see the policy-refused drop in turnMachine/machine.ts.
 */
export const NOT_AVAILABLE_HERE = "That one isn't available here. Try something else.";

