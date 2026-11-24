// The ids of the AI jobs and of the two plan-row ids that stand in for the hub's own parts. Split out of aiChoices.ts
// so the code that only names a job does not depend on the card builder (which is being replaced by the Stack's feature rows).
export type AiJobId = "chat" | "pictures" | "picturesdetailed" | "videos" | "music" | "sounds" | "stems" | "voice" | "wakeword" | "vision" | "coding" | "faces" | "ingredients";
/** The plan-row ids that stand in for the hub's own parts: the wizard and the cards use them, no disk plan holds them. */
export const FACES_ROW_ID = "faces-finder";
export const INGREDIENTS_ROW_ID = "ingredients-adapter";
