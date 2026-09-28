import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { List } from "@maipai/ui/src/primitives/List";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type DeviceInfo, type DiscoveredRobotInfo } from "@/lib/api";
import { RobotPasswordRow } from "./RobotPasswordSection";

const TOTP_REQUIRED_MESSAGE = "A current TOTP code is required to approve a new device";
const AWAIT_ROBOT_POLL_MS = 2000;
// quickConnect.ts's own TTL_MS for a Quick Connect request, counted from
// when it was CREATED (the robot spoke the code), not from when this
// page approved it - so this is a generous upper bound on how much
// longer the underlying request can possibly still be good for, not a
// promise of the server's own exact expiry moment. Good enough for a
// "this is clearly not happening, start over" nudge, which is all it's
// for; the real enforcement is server-side (deviceAuth.ts's redeem gate).
const CODE_TTL_MS = 5 * 60_000;

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
//
// "The add flow refuses to finish while the unit's published default SSH
// password stands" (design record section 8): approving a code does not
// itself create the Device row - the robot's own poll does, asynchronously,
// once it finishes its side of Quick Connect - so this page can't just
// show the rotation form for a device id it doesn't have yet. Instead, once
// approved, it remembers which robot ids already existed and polls the
// household-wide robot list until a new one appears, then embeds
// RobotPasswordRow for exactly that device, defaulted open, and does not
// call the flow "done" until that rotation succeeds.
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
  const [priorRobotIds, setPriorRobotIds] = useState<Set<string> | null>(null);
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const [rotationDone, setRotationDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const awaitingRobot = priorRobotIds !== null && !rotationDone;
  const robotsQuery = useQuery<DeviceInfo[]>({
    queryKey: ["robot-devices"],
    queryFn: () => api.robotDevices(),
    enabled: awaitingRobot,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const data = query.state.data;
      if (!data || priorRobotIds === null) return AWAIT_ROBOT_POLL_MS;
      const found = data.some((d) => !priorRobotIds.has(d.id));
      return found ? false : AWAIT_ROBOT_POLL_MS;
    },
  });
  const newRobot = awaitingRobot
    ? (robotsQuery.data ?? []).find((d) => priorRobotIds !== null && !priorRobotIds.has(d.id))
    : undefined;
  // A code review (2026-09-27) found this flow had no way out when the
  // robot never claims the approval at all (an expired code, a reboot
  // mid-pairing, RM-05 not existing yet so nothing ever polls) - the
  // form stayed unmounted forever with only the failed-poll retry button
  // covering a different case (a poll that errors, not one that just
  // keeps succeeding with an empty list). "Start over" is available the
  // whole time waiting, not only once presumed-expired, since an admin
  // who realizes they mistyped or the robot rebooted shouldn't have to
  // wait out the clock either.
  const presumedExpired = awaitingSince !== null && Date.now() - awaitingSince > CODE_TTL_MS;
  // react-query's own structural sharing keeps the same `data` reference
  // (and skips notifying this observer at all) across a poll that keeps
  // returning an equally-empty list, so nothing here would ever
  // naturally re-render to notice presumedExpired flip true - a live
  // bug this ticking state exists purely to force, independent of
  // whether the query's own data ever changes.
  const [, forceRecheck] = useState(0);
  useEffect(() => {
    if (!awaitingRobot) return;
    const interval = setInterval(() => forceRecheck((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [awaitingRobot]);

  function startOver() {
    setPriorRobotIds(null);
    setAwaitingSince(null);
    setRotationDone(false);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRotationDone(false);
    // Cleared synchronously, not just reassigned once the snapshot below
    // resolves: otherwise a second pairing right after the first one's
    // rotation briefly re-derives `awaitingRobot` from the PRIOR robot's
    // now-stale snapshot before the fresh one lands, flashing "waiting for
    // the robot" with the code input already gone.
    setPriorRobotIds(null);
    setAwaitingSince(null);
    setSubmitting(true);
    try {
      // Snapshot who already exists before approving, so the poll below
      // can tell "the robot that just paired" apart from any other robot
      // already on this household.
      const existing = await api.robotDevices();
      await api.approveRobotCode(code.trim(), needsTotp ? totpToken.trim() : undefined);
      setCode("");
      setTotpToken("");
      setNeedsTotp(false);
      setPriorRobotIds(new Set(existing.map((d) => d.id)));
      setAwaitingSince(Date.now());
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

      {!awaitingRobot ? (
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
          {rotationDone ? (
            <p className="text-base text-[var(--primary)]">
              Paired and its password is rotated - it's ready to use.
            </p>
          ) : null}
          <Button type="submit" disabled={submitting} className="w-fit">
            {submitting ? "Pairing…" : "Pair"}
          </Button>
        </form>
      ) : newRobot ? (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-base text-[var(--primary)]">
            Approved and paired. It still has the vendor's published default password - rotate
            it now to finish adding it.
          </p>
          <RobotPasswordRow device={newRobot} defaultOpen onRotated={() => setRotationDone(true)} />
        </div>
      ) : robotsQuery.isError ? (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-base text-[var(--destructive)]">
            Approved, but checking whether it finished pairing failed. It may still be paired -
            check the robot list below, or try again.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="w-fit" onClick={() => robotsQuery.refetch()}>
              Check again
            </Button>
            <Button variant="ghost" className="w-fit" onClick={startOver}>
              Start over
            </Button>
          </div>
        </div>
      ) : presumedExpired ? (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-base text-[var(--destructive)]">
            The robot hasn't finished pairing and the code has likely expired. Turn the robot's
            Wi-Fi setup back on so it speaks a fresh code, then try again.
          </p>
          <Button variant="outline" className="w-fit" onClick={startOver}>
            Start over
          </Button>
        </div>
      ) : (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-base text-[var(--muted-foreground)]">
            Approved. Waiting for the robot to finish pairing on its own end…
          </p>
          <Button variant="ghost" className="w-fit" onClick={startOver}>
            Start over
          </Button>
        </div>
      )}
    </Section>
  );
}
