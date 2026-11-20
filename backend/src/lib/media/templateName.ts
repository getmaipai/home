// TEMPLATE-02: the one place that names a template saved from a clip (the feed row carries it for the toast, the save action uses it as the title).
/** The name "Save as a template" gives a clip: its first words, trimmed (the title is scrubbed of cast names again at save time). */
export function templateNameFromWords(words: string): string {
  const parts = words.replace(/\{\{[^}]*\}\}/g, "").trim().split(/\s+/).filter(Boolean);
  const text = parts.slice(0, 6).join(" ").replace(/[.,;:!?\s]+$/, "");
  return (parts.length > 6 ? `${text}…` : text).slice(0, 60) || "My template";
}
