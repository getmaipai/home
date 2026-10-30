export type AlarmDraft = {
  time: string;
  days: number[];
  label: string;
  tag: string;
  sound: "default" | "none" | "bell" | "chime" | "digital" | "rise" | "gentle" | "gentle_wake";
  snooze_minutes: 5 | 10 | 15 | 30 | 60 | null;
};
