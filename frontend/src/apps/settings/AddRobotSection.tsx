import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { List } from "@maipai/ui/src/primitives/List";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type DiscoveredRobotInfo } from "@/lib/api";

const TOTP_REQUIRED_MESSAGE = "A current TOTP code is required to approve a new device";

// ROBOT-DEVICE-01 (bot/docs/dev/design-reachy-mini-2026-09-27.md sections
// 9 and 10): the robot has no screen, so it speaks its own six-digit
// pairing code (or shows it on its own settings page); an admin here
// discovers it on the LAN (for reassurance - "yes, that's the one I just
// unboxed" - not because the code needs the discovery list to work) and
// types the code it spoke. This reuses Quick Connect's own existing
// /approve route unchanged: it already mints a "robot" device token
// generically (routes/quickConnect.ts's DEVICE_KINDS already includes
// "robot"), so no new pairing route exists here - only discovery is new.
// The robot's own side of this (requesting the code, polling for
// approval) is bot repo's RM-05, not this page's job.
export function AddRobotSection() {
  const queryClient = useQueryClient();
  const discoveryQuery = useQuery<DiscoveredRobotInfo[]>({
    queryKey: ["discover-robots"],
    queryFn: () => api.discoverRobots(),
    // A browse window of a few seconds each time, not a background poll:
    // the admin opens this panel once, at pairing time, not continuously.
    staleTime: 0,
  });

  const [code, setCode] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await api.approveRobotCode(code.trim(), needsTotp ? totpToken.trim() : undefined);
      setCode("");
      setTotpToken("");
      setNeedsTotp(false);
      setSuccess(true);
      // The robot's own poll (not this page) is what actually finishes
      // pairing and creates the Device row; refresh in case it already
      // has by the time the admin looks at the devices list below.
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      await queryClient.invalidateQueries({ queryKey: ["robot-devices"] });
    } catch (err) {
      if (err instanceof ApiError && err.message === TOTP_REQUIRED_MESSAGE) {
        setNeedsTotp(true);
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not approve that code.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section heading="Add a robot">
      <p className="text-base text-[var(--muted-foreground)]">
        Turn on the robot near your Wi-Fi. It will speak a six-digit code (or show it on its
        own settings page) - type that code below to pair it.
      </p>

      <AsyncState
        data={discoveryQuery.data}
        error={discoveryQuery.isError}
        isFetching={discoveryQuery.isFetching}
        onRetry={() => discoveryQuery.refetch()}
        errorMessage="Could not search your network for a robot."
        loadingLabel="Searching your network"
      >
        {(robots) =>
          robots.length === 0 ? (
            <EmptyState
              icon="search"
              text="No robot found on your network yet."
              actionLabel="Search again"
              onAction={() => discoveryQuery.refetch()}
            />
          ) : (
            <List
              items={robots}
              getKey={(r) => `${r.host}:${r.port}`}
              label="Robots found on your network"
              renderItem={(r) => (
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                  <span className="truncate text-base font-medium">{r.name}</span>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {r.model ?? "Reachy Mini"}
                    {r.daemonVersion ? ` · v${r.daemonVersion}` : ""}
                  </span>
                </div>
              )}
            />
          )
        }
      </AsyncState>

      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        <Input
          placeholder="Six-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={submitting}
          required
          maxLength={6}
        />
        {needsTotp ? (
          <Input
            placeholder="Your current 2FA code"
            value={totpToken}
            onChange={(e) => setTotpToken(e.target.value)}
            disabled={submitting}
            required
            maxLength={6}
          />
        ) : null}
        {error ? <p className="text-base text-[var(--destructive)]">{error}</p> : null}
        {success ? (
          <p className="text-base text-[var(--primary)]">
            Approved. The robot should finish pairing in a moment - then rotate its password
            below before it's used day to day. It still has the vendor's published default
            until you do.
          </p>
        ) : null}
        <Button type="submit" disabled={submitting} className="w-fit">
          {submitting ? "Pairing…" : "Pair"}
        </Button>
      </form>
    </Section>
  );
}
