export const SNOOZE_OPTIONS = [
  { label: "5 minutes", input: { minutes: 5 } },
  { label: "10 minutes", input: { minutes: 10 } },
  { label: "15 minutes", input: { minutes: 15 } },
  { label: "30 minutes", input: { minutes: 30 } },
  { label: "60 minutes", input: { minutes: 60 } },
  { label: "Tomorrow morning", input: { until: "tomorrow_morning" as const } },
] as const;
