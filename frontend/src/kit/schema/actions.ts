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
// doc comment) - substituted BEFORE fillTemplate runs, not after (a code
// review, 2026-09-05, found the original order let a bound item with its
// own field literally named `count` silently win: fillTemplate would
// already have consumed the `{count}` token from that field before this
// function ever saw it). Resolving it first turns `{count}` into a plain
// number, which fillTemplate's own `{field}` regex can't match again.
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
 * Every schema-bound query is invalidated (kit/schema/binding.ts's
 * `["schema-binding", path]` key) once the loop settles, success or
 * failure - a code review (2026-09-05) found the original version only
 * invalidated on full success, so items that DID mutate ahead of a
 * later failure in the same loop never refreshed out of the stale list,
 * and the failure itself surfaced nowhere (an unhandled rejection, no
 * user-visible error). `lastError` carries that message for a
 * non-confirm dispatch; `pendingConfirm.error` carries the equivalent
 * for a confirmed one. `onSettled` (a code review, 2026-09-05) is for a
 * caller like a list's own select-mode UI that needs to know when the
 * action actually FINISHED, not when it was merely dispatched - the
 * original version exited select mode (clearing the selection) the
 * instant a batch action was clicked, including a `confirm`-wrapped one,
 * so the selection was already gone underneath the confirm dialog before
 * the household member had even answered it; cancelling lost the
 * selection for nothing. `onSettled` fires once the action truly runs
 * (success or failure), never on a plain `cancel()`. */
export function useDispatchAction(): {
  dispatch(action: Action, items?: Record<string, unknown>[], onSettled?: () => void): void;
  pendingConfirm: PendingConfirm | null;
  lastError: string | null;
} {
  const navigateTo = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{
    action: Action;
    items: Record<string, unknown>[];
    onSettled?: () => void;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const navigate = useCallback((to: string) => navigateTo(to), [navigateTo]);

  const runAndInvalidate = useCallback(
    async (action: Action, items: Record<string, unknown>[]) => {
      try {
        for (const item of items) await runAction(action, item, navigate);
      } finally {
        // Whatever succeeded before a failure still needs to leave the
        // stale list, so this runs even when the loop above threw.
        await queryClient.invalidateQueries({ queryKey: ["schema-binding"] });
      }
    },
    [navigate, queryClient],
  );

  const dispatch = useCallback(
    (action: Action, items: Record<string, unknown>[] = [{}], onSettled?: () => void) => {
      if ("confirm" in action) {
        setError(null);
        // A stale lastError from an earlier failed non-confirm dispatch (a
        // code review, 2026-09-05, found it was never cleared by any later
        // confirm-based action, success or failure) would otherwise sit
        // under the list forever once set - clearing it here means
        // opening a new confirm always starts from a clean slate.
        setLastError(null);
        setPending({ action, items, onSettled });
        return;
      }
      setLastError(null);
      void runAndInvalidate(action, items)
        .catch((e: unknown) => setLastError(e instanceof Error ? e.message : "Something went wrong."))
        .finally(() => onSettled?.());
    },
    [runAndInvalidate],
  );

  const pendingConfirm: PendingConfirm | null = pending
    ? {
        prompt: fillTemplate(
          fillCount((pending.action as { confirm: { prompt: string } }).confirm.prompt, pending.items.length),
          pending.items[0] ?? {},
        ),
        busy,
        error,
        confirm() {
          setBusy(true);
          setError(null);
          void runAndInvalidate((pending.action as { confirm: { on_confirm: Action } }).confirm.on_confirm, pending.items)
            .then(() => {
              pending.onSettled?.();
              setPending(null);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong."))
            .finally(() => setBusy(false));
        },
        cancel() {
          setPending(null);
          setError(null);
        },
      }
    : null;

  return { dispatch, pendingConfirm, lastError };
}
