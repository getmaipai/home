export interface RunningTimerRow {
  nextRunAt: string;
  inputs: string;
}

/** Format active timer rows against an injected clock, keeping every timer scoped by the caller's query. */
export function timerStatusReply(rows: RunningTimerRow[], now: Date): string {
  const descriptions = rows.map((row) => {
    const seconds = Math.max(0, Math.ceil((Date.parse(row.nextRunAt) - now.getTime()) / 1000));
    const label = (JSON.parse(row.inputs) as { label?: unknown }).label;
    const name = typeof label === "string" ? label.trim() : "";
    // "10 minutes" names a length ("10 minute timer"); any other label is the timer's own name ("pasta timer").
    const length = name ? `${/^\d/.test(name) ? name.replace(/s$/i, "") : name} timer` : "timer";
    const minutes = Math.floor(seconds / 60);
    const unit = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
    const remaining = seconds < 60 ? unit(seconds, "second") : seconds % 60 === 0 ? unit(minutes, "minute") : `${unit(minutes, "minute")} and ${unit(seconds % 60, "second")}`;
    return { length, remaining };
  });
  if (descriptions.length === 0) return "You have no timers running.";
  if (descriptions.length === 1) return `Your ${descriptions[0]!.length} has ${descriptions[0]!.remaining} left.`;
  return `Your timers: ${descriptions.map((timer) => `${timer.length} has ${timer.remaining} left`).join("; ")}.`;
}
