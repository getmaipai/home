import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { fillTemplate, fillTemplateDeep } from "@/kit/schema/fieldPath";
import type { Action } from "@/kit/schema/types";

// The five declared actions (platform plan 6.2). `ask` has no consumer
// yet (nothing this session builds is voice-driven) - dispatching it
// throws rather than silently no-oping, the same "loud, not quiet" gap
// binding.ts's `host` source leaves.
async function runAction(action: Action, item: Record<string, unknown>, navigate: (to: string) => void): Promise<void> {
  if ("navigate" in action) {
    navigate(fillTemplate(action.navigate.to, item));
    return;
  }
  if ("call" in action) {
    const target = fillTemplate(action.call.target, item);
    const args = action.call.args ? fillTemplateDeep(action.call.args, item) : undefined;
    await request(target, { method: action.call.method ?? "POST", body: args ? JSON.stringify(args) : undefined });
    return;
  }
  if ("play" in action) {
    throw new Error(`kit/schema: action "play" has no interpreter support yet (media_id: ${action.play.media_id})`);
  }
  if ("confirm" in action) {
    // Handled by useDispatchAction itself (below), which needs to show a
    // real dialog and await the household member's choice before
    // recursing into on_confirm - a plain async function can't pause for
    // that the way a React confirm dialog needs to.
    throw new Error("kit/schema: confirm must be dispatched through useDispatchAction, not runAction directly");
  }
  if ("ask" in action) {
    throw new Error(`kit/schema: action "ask" has no interpreter support yet (prompt: ${action.ask.prompt})`);
  }
}

export interface PendingConfirm {
  prompt: string;
  busy: boolean;
  error: string | null;
  confirm(): void;
  cancel(): void;
}

// `{count}` is the one placeholder fillTemplate can't resolve from a
// single item's own fields (spec/ui/schema.json's action.confirm.prompt
// doc comment) - substituted here, once, ahead of the normal per-item
// substitution, so "Archive {count} memories?" reads right for both a
// single row_action (count always 1) and a batch action over N selected.
function fillCount(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}

/** Dispatches any of the five actions against one or more bound items
 * (a row_action passes exactly one; a list's batch action passes every
 * selected item, or every loaded item for `scope: "all"`), resolving
 * `{field}`/`{count}` placeholders. `confirm` shows a real dialog and
 * waits for the household member's choice rather than executing
 * immediately; every other action kind runs straight away, once per
 * item, sequentially (never `Promise.all` - a partial failure has to
 * stop at the item that failed, not fire the rest of the batch anyway).
 * After every item settles, every schema-bound query is invalidated
 * (kit/schema/binding.ts's `["schema-binding", path]` key) - simple and
 * safe at this app's scale (a household's own data), matching how
 * NotificationBell.tsx/MemoryPage.tsx's own mutations already invalidate
 * broadly rather than tracking exactly which binding an action affects. */
export function useDispatchAction(): {
  dispatch(action: Action, items?: Record<string, unknown>[]): void;
  pendingConfirm: PendingConfirm | null;
} {
  const navigateTo = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ action: Action; items: Record<string, unknown>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback((to: string) => navigateTo(to), [navigateTo]);

  const runAndInvalidate = useCallback(
    async (action: Action, items: Record<string, unknown>[]) => {
      for (const item of items) await runAction(action, item, navigate);
      await queryClient.invalidateQueries({ queryKey: ["schema-binding"] });
    },
    [navigate, queryClient],
  );

  const dispatch = useCallback(
    (action: Action, items: Record<string, unknown>[] = [{}]) => {
      if ("confirm" in action) {
        setError(null);
        setPending({ action, items });
        return;
      }
      void runAndInvalidate(action, items);
    },
    [runAndInvalidate],
  );

  const pendingConfirm: PendingConfirm | null = pending
    ? {
        prompt: fillCount(
          fillTemplate((pending.action as { confirm: { prompt: string } }).confirm.prompt, pending.items[0] ?? {}),
          pending.items.length,
        ),
        busy,
        error,
        confirm() {
          setBusy(true);
          setError(null);
          void runAndInvalidate((pending.action as { confirm: { on_confirm: Action } }).confirm.on_confirm, pending.items)
            .then(() => setPending(null))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong."))
            .finally(() => setBusy(false));
        },
        cancel() {
          setPending(null);
          setError(null);
        },
      }
    : null;

  return { dispatch, pendingConfirm };
}
