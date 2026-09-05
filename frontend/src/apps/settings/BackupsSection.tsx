import { useCallback, useEffect, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type BackupInfo, type PendingRestore, type Roster } from "@/lib/api";
import { formatBytes } from "@/apps/settings/formatBytes";

interface BackupsSectionProps {
  person: Roster;
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

// 2.5's backup mechanism, with restore (2026-09-05). Restore is staged,
// not applied live: the hub holds an open handle to the database being
// replaced, so the swap happens at the next start
// (backend/src/lib/restoreStaging.ts explains the reasoning). That shapes
// this UI as much as the backend - what a parent is told here has to
// match what actually happens, which is "this will take effect when you
// restart MaiPai Home", not "restoring…".
//
// The confirmation is a real step, not a bare button, and not a browser
// confirm(): a native dialog blocks the page, cannot be styled to say
// what is actually about to happen, and cannot be tested. It replaces the
// row with a panel that names the backup by date and says in plain words
// what will be lost.
export function BackupsSection({ person }: BackupsSectionProps) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyFilename, setBusyFilename] = useState<string | null>(null);

  // Only the household owner may stage or cancel a restore
  // (routes/backups.ts), so only they get those buttons. Reading the
  // pending state is owner-or-admin, and an admin genuinely needs to
  // see it: the household database is about to be replaced at the next
  // start, and someone who can restart the hub should not be the last
  // to know. A code review (2026-09-05) found this hiding the banner
  // from admins on a wrong claim that the route would 403.
  const canRestore = person.role === "owner";
  const canSeePending = person.role === "owner" || person.role === "admin";

  /** A staged restore knows its backup's filename; the date a parent
   * cares about lives on the backup itself. */
  function backupDate(filename: string): string {
    const match = (backups ?? []).find((b) => b.filename === filename);
    return match ? whenText(match.createdAt) : "the one you chose";
  }

  const load = useCallback(() => {
    setError(null);
    api
      .backups()
      .then(setBackups)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load backups."));
    if (canSeePending) {
      api
        .pendingRestore()
        .then((r) => setPending(r.pending))
        .catch(() => setPending(null));
    }
  }, [canSeePending]);

  useEffect(load, [load]);

  async function handleRunBackup() {
    setRunning(true);
    setError(null);
    try {
      await api.runBackup();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not run a backup.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRestore(filename: string) {
    setBusyFilename(filename);
    setError(null);
    try {
      const { pending: staged } = await api.stageRestore(filename);
      setPending(staged);
      setConfirming(null);
    } catch (e) {
      // The backend's refusals are written for the person reading them
      // ("that backup was made by a newer version of MaiPai Home"), so
      // they are shown as-is rather than replaced with a generic message.
      setError(e instanceof ApiError ? e.message : "Could not get that backup ready.");
    } finally {
      setBusyFilename(null);
    }
  }

  async function handleCancel() {
    setError(null);
    try {
      await api.cancelRestore();
      setPending(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel the restore.");
    }
  }

  return (
    <Section heading="Backups">
      {error ? <p className="text-base text-[hsl(var(--destructive))]">{error}</p> : null}

      {pending ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--primary))] p-3">
          <p className="text-base font-medium">Ready to restore</p>
          <p className="text-base text-[hsl(var(--muted-foreground))]">
            {/* The backup's own date, not `stagedAt`. Naming a backup by
                the minute someone pressed the button tells a parent
                nothing about which point in time they are going back to,
                which is the only thing they actually need to know here.
                Caught by looking at the real banner in a browser. */}
            The backup from {backupDate(pending.filename)} will replace everything in MaiPai Home the next time it
            starts. Nothing has changed yet. Restart MaiPai Home to finish
            {canRestore ? ", or cancel to leave things as they are" : ""}.
          </p>
          {/* An admin is told, but only the owner may cancel: staging and
              cancelling are owner-only on the backend (routes/backups.ts),
              while reading the pending state is owner-or-admin because
              someone who can restart the hub should not be the last to
              know the database is about to be replaced. */}
          {canRestore ? (
            <Button variant="secondary" onClick={handleCancel} className="w-fit">
              Cancel restore
            </Button>
          ) : null}
        </div>
      ) : null}

      {backups === null ? (
        <Progress mode="spinner" label="Loading backups" />
      ) : backups.length === 0 ? (
        <p className="text-base text-[hsl(var(--muted-foreground))]">No backups yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
          {backups.map((b) =>
            confirming === b.filename ? (
              <div key={b.filename} className="flex flex-col gap-2 py-3">
                <p className="text-base font-medium">Restore the backup from {whenText(b.createdAt)}?</p>
                <p className="text-base text-[hsl(var(--muted-foreground))]">
                  Everyone in your household, everything MaiPai remembers, and every conversation will go back to
                  how they were then. Anything added since will be gone. This takes effect the next time MaiPai
                  Home starts.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => handleRestore(b.filename)}
                    disabled={busyFilename === b.filename}
                  >
                    {busyFilename === b.filename ? "Getting it ready…" : "Yes, restore this backup"}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(null)}>
                    Keep things as they are
                  </Button>
                </div>
              </div>
            ) : (
              <div key={b.filename} className="flex items-center justify-between gap-3 py-2 text-base">
                <span>{whenText(b.createdAt)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[hsl(var(--muted-foreground))]">{formatBytes(b.bytes)}</span>
                  {canRestore && !pending ? (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirming(b.filename)}
                      aria-label={`Restore the backup from ${whenText(b.createdAt)}`}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <Button variant="secondary" onClick={handleRunBackup} disabled={running} className="w-fit">
        {running ? "Backing up…" : "Back up now"}
      </Button>
    </Section>
  );
}
