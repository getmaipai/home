// Safari mic diagnostics: remembers the last capture failure (which step,
// which error) so the toast can show it and "Copy details" can hand it to
// the developer as plain text. Nothing is sent anywhere.

export type MicStep =
  | "secure check"
  | "microphone request"
  | "audio context"
  | "audio resume"
  | "audio source"
  | "worklet load"
  | "worklet node"
  | "script processor";

export interface MicFailure {
  step: MicStep;
  kind: string;
  name: string;
  message: string;
  at: string;
  /** Non-fatal notes from the same attempt, e.g. "worklet load failed, used ScriptProcessor". */
  notes: string[];
  audioContext?: string;
}

let last: MicFailure | null = null;
let notes: string[] = [];

export function errName(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "Error";
}
export function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err);
}

/** A step failed but capture carried on with a fallback. */
export function noteMicDegraded(step: MicStep, err: unknown, fallback: string): void {
  notes.push(`${step} failed (${errName(err)}: ${errMessage(err)}); ${fallback}`);
  console.warn(`[mic] ${step} failed, ${fallback}: ${errName(err)}: ${errMessage(err)}`);
}

/** Start of a capture attempt: forget the previous attempt's notes. */
export function beginMicAttempt(): void {
  notes = [];
}

export function recordMicFailure(step: MicStep, kind: string, err: unknown, audioContext?: string): MicFailure {
  last = { step, kind, name: errName(err), message: errMessage(err), at: new Date().toISOString(), notes: [...notes], audioContext };
  return last;
}

/** Fallbacks taken by the most recent capture attempt that still succeeded. */
export function micAttemptNotes(): string[] {
  return [...notes];
}

export function lastMicFailure(): MicFailure | null {
  return last;
}


/** One line for the toast: "Step: worklet load. NotSupportedError: ...". */
export function micFailureLine(failure: MicFailure): string {
  return `Step: ${failure.step}. ${failure.name}: ${failure.message}`;
}

export function micEnvironmentLines(): string[] {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const controlled = Boolean(nav?.serviceWorker?.controller);
  return [
    `Browser: ${nav?.userAgent ?? "unknown"}`,
    `Secure context: ${typeof window === "undefined" ? "unknown" : String(window.isSecureContext)}`,
    `Address: ${typeof location === "undefined" ? "unknown" : location.origin}`,
    `Service worker controls this page: ${String(controlled)}`,
  ];
}

export function micDetailsText(failure: MicFailure | null = last): string {
  const lines = ["MaiPai Home microphone details", ...micEnvironmentLines()];
  if (failure) {
    lines.push(`Step: ${failure.step}`, `Error: ${failure.name}: ${failure.message}`, `Kind: ${failure.kind}`, `Time: ${failure.at}`);
    if (failure.audioContext) lines.push(`Audio context: ${failure.audioContext}`);
    for (const note of failure.notes) lines.push(`Note: ${note}`);
  } else {
    lines.push("No microphone failure recorded in this page.");
  }
  if (!failure || failure.notes.length === 0) {
    for (const note of notes) lines.push(`Note: ${note}`);
  }
  return lines.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function copyMicDetails(failure: MicFailure | null = last): Promise<boolean> {
  return copyText(micDetailsText(failure));
}
