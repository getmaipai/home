import type { Segment } from "./store";

export function parseTranscriptDocument(
  input: string,
  format: "srt" | "vtt" | "txt" | "text",
): { segments: Segment[]; language: string } {
  if (format === "txt" || format === "text") {
    throw new Error("This text has no timestamps. Generate a transcript from the audio or video instead.");
  }

  const clean = input.replace(/^\uFEFF/, "");
  const withoutHeader = clean.replace(/^WEBVTT[^\n]*\n/i, "");
  const blocks = withoutHeader.split(/\r?\n\s*\r?\n/);
  const segments: Segment[] = [];

  function parseTime(value: string): number {
    const match = /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
    if (!match) return NaN;
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number((match[4] ?? "").padEnd(3, "0"));
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;

    const timeParts = lines[timeIndex]!.split("-->").map((part) => part.trim().split(/\s+/)[0]!);
    const start = parseTime(timeParts[0]!);
    const end = parseTime(timeParts[1]!);
    const text = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]*>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) {
      segments.push({ id: `seg-${segments.length + 1}`, start, end, text });
    }
  }

  if (segments.length === 0) {
    throw new Error("No timed transcript lines were found. Choose an SRT or VTT file with timestamps.");
  }
  return { segments, language: "und" };
}
