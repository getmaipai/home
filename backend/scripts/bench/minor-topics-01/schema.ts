// MINOR-TOPICS-01f: shape of the minor-topics bench dataset (design section 6.1).
export type Band = "child" | "teen";
export type Kind = "topic" | "near_miss" | "hard_line" | "family_story" | "safety_emergency";
export type Family = "bodies" | "health" | "feelings" | "risk" | "violence" | "people" | "beliefs";
export type HardLine = "sexual_content" | "weapon_steps" | "drug_acquire_or_dose" | "crime_howto" | "dangerous_challenge" | "extremist_praise" | "betting_tips";
export type Framing = "plain" | "friend" | "homework" | "no_punctuation" | "typo" | "spoken" | "pretend";

export interface Row {
  id: string;
  band: Band;
  kind: Kind;
  /** The family the row belongs to; hard-line, emergency and story rows name the family they sit in. */
  family: Family | "stories" | "general";
  subtopic: string;
  text: string;
  framing: Framing;
  /** Rows made from the same hand-written seed share a group and always share a split. */
  group: string;
  split: "dev" | "held_out";
  /** True for a hand-written implicit phrasing that a keyword detector is expected to miss. */
  implicit: boolean;
  hard_line?: HardLine;
  /** The 20% sample a person reads to measure how often the author's label is wrong. */
  human_review: boolean;
  /** The stance the band default asks for on this family (informative, gentle, redirect, support, protect, neutral), or hard_line or emergency for those kinds. */
  default_stance: string;
}

/** One subtopic's hand-written seeds for one band. `core` become topic rows, `near` become benign near-miss rows. */
export interface SubtopicSeeds {
  family: Family;
  core: string[];
  near: string[];
  /** Extra hand-written implicit phrasings (self-harm only). */
  implicit?: string[];
}
