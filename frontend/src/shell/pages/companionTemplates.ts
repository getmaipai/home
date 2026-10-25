import type { CompanionFields } from "@/lib/api";

export type CompanionTemplate = {
  id: string;
  name: string;
  tagline: string;
  preset: Pick<CompanionFields, "formality" | "complexity" | "engagement" | "filler_density" | "interests" | "tagline">;
};

export const companionTemplates: CompanionTemplate[] = [
  {
    id: "chat-buddy",
    name: "Chat buddy",
    tagline: "A friendly voice for everyday questions.",
    preset: { formality: "casual", complexity: "standard", engagement: "curious", filler_density: "light", interests: [], tagline: "A friendly voice for everyday questions." },
  },
  {
    id: "research",
    name: "Research",
    tagline: "Find useful facts and explain where they came from.",
    preset: { formality: "neutral", complexity: "advanced", engagement: "balanced", filler_density: "none", interests: ["research", "reading"], tagline: "Find useful facts and explain where they came from." },
  },
  {
    id: "homework-helper",
    name: "Homework helper",
    tagline: "Work through school questions one step at a time.",
    preset: { formality: "casual", complexity: "simple", engagement: "curious", filler_density: "light", interests: ["school"], tagline: "Work through school questions one step at a time." },
  },
  {
    id: "storyteller",
    name: "Storyteller",
    tagline: "Make up characters, worlds, and stories together.",
    preset: { formality: "casual", complexity: "standard", engagement: "curious", filler_density: "frequent", interests: ["stories"], tagline: "Make up characters, worlds, and stories together." },
  },
  {
    id: "custom",
    name: "Custom",
    tagline: "Choose the style and interests yourself.",
    preset: {},
  },
];
