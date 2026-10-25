export type CompanionPreviewStatus = "Working" | "Idle" | "Needs approval";

export interface CompanionPreviewActivity {
  title: string;
  detail: string;
  icon: string;
}

export interface CompanionPreviewSample {
  status: CompanionPreviewStatus;
  activityLine: string;
  tasks: number;
  activities: readonly CompanionPreviewActivity[];
}

const samples: readonly Omit<CompanionPreviewSample, "tasks" | "activities">[] = [
  { status: "Working", activityLine: "Researching weekend plans" },
  { status: "Idle", activityLine: "Last: Reviewed project" },
  { status: "Needs approval", activityLine: "Expense report ready" },
];

const activitySets: readonly (readonly CompanionPreviewActivity[])[] = [
  [
    { title: "Researching weekend plans", detail: "Completed · 10:42 AM", icon: "check" },
    { title: "Plan a family outing", detail: "Scheduled · Next check tomorrow", icon: "calendar" },
  ],
  [
    { title: "Reviewed project", detail: "Completed · 10:42 AM", icon: "check" },
    { title: "Organize project notes", detail: "Scheduled · Next check tomorrow", icon: "calendar" },
  ],
  [
    { title: "Expense report ready", detail: "Scheduled · Next check tomorrow", icon: "file-text" },
    { title: "Check approval status", detail: "Completed · 10:42 AM", icon: "check" },
  ],
];

function hashId(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function companionPreviewSample(id: string): CompanionPreviewSample {
  const index = hashId(id) % samples.length;
  return {
    ...samples[index]!,
    tasks: hashId(`${id}:tasks`) % 4,
    activities: activitySets[index]!,
  };
}
