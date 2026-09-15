// ACT-02: the three label sets, each in a fixed order that IS the
// artifact's class index order - spec/schemas/turn-signal.schema.json's
// own enums, never reordered or renamed here. `stance` omits "unknown":
// that value is what a below-threshold prediction becomes (the head
// never predicts it directly), same as the emotion head never predicts
// a distinct "fallback" class.
export const ACT_LABELS = ["inform", "question", "directive", "commissive", "greeting", "closing", "backchannel"] as const;
export type ActLabel = (typeof ACT_LABELS)[number];

export const STANCE_LABELS = ["asserted", "reported", "quoted", "hypothetical", "joke"] as const;
export type StanceLabel = (typeof STANCE_LABELS)[number];

export const EMOTION_LABELS = ["neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear"] as const;
export type EmotionLabel = (typeof EMOTION_LABELS)[number];

export const LABEL_MAP_VERSION = 1;

// docs/dev.md section 12: "emotions 0 to 6 are neutral, anger, disgust,
// fear, happiness, sadness, surprise" - DailyDialog's own published
// order, pinned here since the mirror carries the label files without
// the paper's definitions.
export const DAILYDIALOG_EMOTION_ORDER: readonly EmotionLabel[] = ["neutral", "anger", "disgust", "fear", "happiness", "sadness", "surprise"];
// "acts 1 to 4 are inform, question, directive, commissive" - index 0 is
// unused (DailyDialog's own act files are 1-indexed).
export const DAILYDIALOG_ACT_ORDER: readonly (ActLabel | null)[] = [null, "inform", "question", "directive", "commissive"];

// GoEmotions' own published mapping onto Ekman's six
// (github.com/google-research/google-research, goemotions/data/
// ekman_mapping.json, fetched and pinned here rather than re-derived -
// "joy is our happiness" per docs/dev.md section 12). `neutral` is
// GoEmotions' own 28th label and maps to our `neutral` directly; it is
// not part of the published file.
export const GOEMOTIONS_TO_EKMAN: Record<string, EmotionLabel> = {
  anger: "anger",
  annoyance: "anger",
  disapproval: "anger",
  disgust: "disgust",
  fear: "fear",
  nervousness: "fear",
  joy: "happiness",
  amusement: "happiness",
  approval: "happiness",
  excitement: "happiness",
  gratitude: "happiness",
  love: "happiness",
  optimism: "happiness",
  relief: "happiness",
  pride: "happiness",
  admiration: "happiness",
  desire: "happiness",
  caring: "happiness",
  sadness: "sadness",
  disappointment: "sadness",
  embarrassment: "sadness",
  grief: "sadness",
  remorse: "sadness",
  surprise: "surprise",
  realization: "surprise",
  confusion: "surprise",
  curiosity: "surprise",
  neutral: "neutral",
};
