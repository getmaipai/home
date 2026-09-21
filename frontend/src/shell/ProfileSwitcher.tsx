import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as RadixPopover from "@radix-ui/react-popover";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Separator } from "@maipai/ui/src/ui/separator";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { getIcon } from "@maipai/ui/src/icons";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";
import { pauseTvNavForOverlay } from "@maipai/ui/src/tvNav";
import { api, ApiError, type Roster } from "@/lib/api";

interface ProfileSwitcherProps {
  person: Roster;
  onSwitched: () => Promise<void>;
  onSignOut: () => void;
  /** Extra rows above "Switch profile" (HOME-UI-02f: the phone header
   * fold has nowhere else to put Search/Appearance/Notifications, so
   * they join this same menu rather than a second one). A render prop,
   * not a bare node: those rows close this same popover on click, the
   * way Profile/Sign out below already do, so they need this popover's
   * own close function rather than owning a second one. `close`'s own
   * `keepFocus` (a code review, HOME-UI-02f) is for a row that opens
   * ANOTHER overlay right after closing this one (Search, opening the
   * kit's command palette) - Radix Popover's default `onCloseAutoFocus`
   * returns focus to this popover's own trigger the moment it closes,
   * which can race the new overlay's own autofocus for the same tab
   * stop; `keepFocus: true` skips that return so the new overlay's own
   * focus wins uncontested. Omitted on desktop, where those three stay
   * separate header controls. */
  extraActions?: (close: (opts?: { keepFocus?: boolean }) => void) => ReactNode;
  /** A small dot on the trigger's own avatar (HOME-UI-02f: "the bell's
   * count shows as a dot on the avatar") - only meaningful alongside
   * `extraActions`, since the desktop bell already shows its own count. */
  dot?: boolean;
}

// The header's primary action (docs/plans/session-b-ui.md step 2:
// "a profile switcher... replacing sign-out as the primary action, with
// sign-out inside the menu"). A non-modal Popover, not a Dialog or the
// generated DropdownMenu - same reasoning as NotificationBell: switching
// or backing out never blocks the rest of the page, and this reuses that
// same hand-rolled Radix Popover rather than inventing a second small-
// panel pattern. Internally swaps between a profile grid and a PIN prompt
// exactly the way the full-screen `SignIn` picker does, sharing its
// `usePinAutoSubmit` hook for the auto-submit-on-4-digits behavior rather
// than a second copy.
export function ProfileSwitcher({ person, onSwitched, onSignOut, extraActions, dot }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Roster[] | null>(null);
  const [selected, setSelected] = useState<Roster | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read by RadixPopover.Content's own onCloseAutoFocus below - see
  // extraActions's own close/keepFocus doc comment above.
  const keepFocusOnCloseRef = useRef(false);
  function close(opts?: { keepFocus?: boolean }) {
    keepFocusOnCloseRef.current = opts?.keepFocus ?? false;
    setOpen(false);
  }

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

  usePinAutoSubmit({ secret, selected, busy, onSubmit: () => void handleSecretSubmit() });

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
  const ProfileIcon = getIcon("user");

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
          <Avatar name={person.display_name} className="h-9 w-9 text-sm" dot={dot} />
          <span className="hidden text-base sm:inline">{person.display_name}</span>
        </Button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={8}
          className="z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-lg"
          onCloseAutoFocus={(e) => {
            // Self-resetting: every OTHER close path here (switching
            // profiles, signing in, Profile) calls plain setOpen(false),
            // never close() - without resetting the flag after reading
            // it, one Search click's keepFocus:true would silently keep
            // suppressing focus-return on every later close too, not
            // just the one it was meant for.
            if (keepFocusOnCloseRef.current) {
              keepFocusOnCloseRef.current = false;
              e.preventDefault();
            }
          }}
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
              {extraActions ? (
                <>
                  {extraActions(close)}
                  <Separator className="my-1" />
                </>
              ) : null}
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
              {/* "Profile" opens the signed-in person's own profile
                  (owner ruling, "Navigation, corrected," 2026-09-20) -
                  where Memories moved once they left the rail. */}
              <Button asChild type="button" variant="ghost" onClick={() => setOpen(false)} className="h-auto min-h-12 justify-start gap-2 px-2">
                <Link to={`/people/${person.id}`}>
                  <ProfileIcon className="h-4 w-4" aria-hidden />
                  <span className="text-base">Profile</span>
                </Link>
              </Button>
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
