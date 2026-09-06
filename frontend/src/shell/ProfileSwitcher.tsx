import { useEffect, useRef, useState, type FormEvent } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Button } from "@/kit/ui/button";
import { Input } from "@/kit/ui/input";
import { Separator } from "@/kit/ui/separator";
import { Avatar } from "@/kit/primitives/Avatar";
import { getIcon } from "@/kit/icons";
import { pauseTvNavForOverlay } from "@/shell/tvNav";
import { api, ApiError, type Roster } from "@/lib/api";

interface ProfileSwitcherProps {
  person: Roster;
  onSwitched: () => Promise<void>;
  onSignOut: () => void;
}

// The header's primary action (docs/plans/session-b-ui.md step 2:
// "a profile switcher... replacing sign-out as the primary action, with
// sign-out inside the menu"). A non-modal Popover, not a Dialog or the
// generated DropdownMenu - same reasoning as NotificationBell: switching
// or backing out never blocks the rest of the page, and this reuses that
// same hand-rolled Radix Popover rather than inventing a second small-
// panel pattern. Internally swaps between a profile grid and a PIN
// prompt exactly the way the full-screen `SignIn` picker does; the PIN
// auto-submit-on-4-digits behavior is intentionally duplicated in small
// form here rather than risking a refactor of SignIn.tsx's own tested
// flow under this session's time budget - a real follow-up (a shared
// `usePinAutoSubmit` hook) is worth doing, not done here.
export function ProfileSwitcher({ person, onSwitched, onSignOut }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Roster[] | null>(null);
  const [selected, setSelected] = useState<Roster | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSubmitDisabledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setSecret("");
    setError(null);
    api
      .profiles()
      .then(setProfiles)
      .catch(() => setError("Could not reach the hub"));
  }, [open]);

  useEffect(() => {
    autoSubmitDisabledRef.current = false;
  }, [selected]);

  useEffect(() => {
    if (!selected || busy) return;
    if (autoSubmitDisabledRef.current) return;
    if (!/^\d{4}$/.test(secret)) return;
    autoSubmitDisabledRef.current = true;
    void handleSecretSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same shape as SignIn.tsx's identical auto-submit effect.
  }, [secret, selected, busy]);

  async function switchTo(target: Roster) {
    if (target.hasSecret) {
      setSelected(target);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.select(target.id);
      await onSwitched();
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not switch profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSecretSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifySecret(selected.id, secret);
      await onSwitched();
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  const others = (profiles ?? []).filter((p) => p.id !== person.id);
  const LogOutIcon = getIcon("log-out");

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        pauseTvNavForOverlay(next);
      }}
    >
      <RadixPopover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-12 justify-start gap-2 px-2"
          aria-label={`${person.display_name}, switch profile or sign out`}
        >
          <Avatar name={person.display_name} className="h-9 w-9 text-sm" />
          <span className="hidden text-base sm:inline">{person.display_name}</span>
        </Button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={8}
          className="z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-lg"
        >
          {selected ? (
            <form onSubmit={handleSecretSubmit} className="flex flex-col gap-3 p-2">
              <div className="flex items-center gap-2">
                <Avatar name={selected.display_name} className="h-8 w-8 text-sm" />
                <span className="text-base font-medium">{selected.display_name}</span>
              </div>
              <Input
                type="password"
                placeholder="PIN or password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                // Same exception SignIn.tsx's identical PIN prompt takes:
                // this popover's entire visible content becomes the PIN
                // field the moment a profile is picked, nothing else to
                // silently steal focus from.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                required
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-1 p-1">
              <p className="px-2 py-1 text-sm text-muted-foreground">Switch profile</p>
              {profiles === null ? (
                <p className="px-2 py-2 text-base text-muted-foreground">Loading…</p>
              ) : others.length === 0 ? (
                <p className="px-2 py-2 text-base text-muted-foreground">No one else in this household yet.</p>
              ) : (
                others.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant="ghost"
                    onClick={() => switchTo(p)}
                    disabled={busy}
                    className="h-auto min-h-12 justify-start gap-2 px-2"
                  >
                    <Avatar name={p.display_name} className="h-8 w-8 text-sm" />
                    <span className="text-base">{p.display_name}</span>
                  </Button>
                ))
              )}
              {error ? <p className="px-2 text-sm text-destructive">{error}</p> : null}
              <Separator className="my-1" />
              <Button
                type="button"
                variant="ghost"
                onClick={onSignOut}
                className="h-auto min-h-12 justify-start gap-2 px-2 text-muted-foreground"
              >
                <LogOutIcon className="h-4 w-4" aria-hidden />
                <span className="text-base">Sign out</span>
              </Button>
            </div>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
