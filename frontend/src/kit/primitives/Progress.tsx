import { getIcon } from "@/kit/icons";

interface ProgressProps {
  mode: "spinner" | "determinate";
  value?: number;
  label?: string;
}

// v0 only ever renders `spinner` (Chat has nothing determinate to show
// yet); `determinate` is typed to match spec/ui/schema.json's mode enum
// but has no real caller tonight, same "typed, not yet implemented"
// posture as llm.ts's role list.
export function Progress({ mode, value, label }: ProgressProps) {
  const Spinner = getIcon("loader");
  if (mode === "determinate") {
    const pct = Math.max(0, Math.min(100, value ?? 0));
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
      <Spinner className="h-4 w-4 animate-spin" aria-hidden />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
