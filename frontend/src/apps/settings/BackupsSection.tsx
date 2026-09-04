import { useCallback, useEffect, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type BackupInfo } from "@/lib/api";
import { formatBytes } from "@/apps/settings/formatBytes";

// 2.5's real backup mechanism (backend/src/lib/backup.ts: encrypted,
// scheduled, retained, provably restorable) has had no UI at all. This is
// the safe half of that story: list what exists and trigger one on
// demand, both owner/admin-only routes that were already real. Restore
// stays deliberately unbuilt (backup.ts's own comment: swapping a live
// database safely needs the staged update/rollback machinery 2.4
// describes, which doesn't exist since no release has ever been cut) -
// building a restore button without that machinery would be the unsafe
// thing, not the missing thing.
export function BackupsSection() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .backups()
      .then(setBackups)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load backups."));
  }, []);

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

  return (
    <Section heading="Backups">
      {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
      {backups === null ? (
        <Progress mode="spinner" label="Loading backups" />
      ) : backups.length === 0 ? (
        <p className="text-base text-[hsl(var(--muted-foreground))]">No backups yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
          {backups.map((b) => (
            <div key={b.filename} className="flex items-center justify-between py-2 text-base">
              <span>{new Date(b.createdAt).toLocaleString()}</span>
              <span className="text-[hsl(var(--muted-foreground))]">{formatBytes(b.bytes)}</span>
            </div>
          ))}
        </div>
      )}
      <Button variant="secondary" size="sm" onClick={handleRunBackup} disabled={running} className="w-fit">
        {running ? "Backing up…" : "Back up now"}
      </Button>
    </Section>
  );
}
