import { getIcon } from "@/kit/icons";
import { Button } from "@/kit/components/Button";

interface EmptyStateProps {
  icon: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

// spec/ui/schema.json's empty_state: {type, icon, text, action?}. The
// action here is a plain callback rather than the schema's typed `action`
// union (navigate/call/play/confirm/ask). That dispatch belongs to the
// generic UiNode interpreter, deferred (home/docs/dev.md, this slice).
export function EmptyState({ icon, text, actionLabel, onAction }: EmptyStateProps) {
  const Icon = getIcon(icon);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon className="h-10 w-10 text-[hsl(var(--muted-foreground))]" aria-hidden />
      <p className="text-base text-[hsl(var(--muted-foreground))]">{text}</p>
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
