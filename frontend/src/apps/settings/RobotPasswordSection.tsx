import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { List } from "@maipai/ui/src/primitives/List";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type DeviceInfo } from "@/lib/api";

// ROBOT-DEVICE-01: "the add flow refuses to finish while the unit's
// published default SSH password stands and rotates it into the
// credentials center." Rotation still can't happen automatically the
// moment the device row appears - it needs the admin to type the
// vendor's own published default, which this hub never stores or
// guesses - but AddRobotSection now embeds this exact row, defaulted
// open, right after a fresh pairing, so the add flow doesn't consider
// itself finished until this succeeds. This standalone section (a
// household-wide list, one row per already-paired robot) is what an
// admin uses to rotate again later, or to catch a robot that was
// somehow paired without going through that flow.
export function RobotPasswordRow({
  device,
  defaultOpen = false,
  onRotated,
}: {
  device: DeviceInfo;
  defaultOpen?: boolean;
  onRotated?: () => void;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["robot-password-status", device.id],
    queryFn: () => api.robotPasswordStatus(device.id),
  });

  const [open, setOpen] = useState(defaultOpen);
  const [host, setHost] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRotate() {
    setError(null);
    setSubmitting(true);
    try {
      await api.rotateRobotPassword(device.id, host.trim(), currentPassword.trim());
      setOpen(false);
      setHost("");
      setCurrentPassword("");
      await queryClient.invalidateQueries({ queryKey: ["robot-password-status", device.id] });
      onRotated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rotate the password.");
    } finally {
      setSubmitting(false);
    }
  }

  const rotated = statusQuery.data?.rotated ?? false;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-base font-medium">{device.name}</span>
        {statusQuery.data ? (
          <Badge variant={rotated ? "secondary" : "destructive"}>
            {rotated ? "Rotated" : "Vendor default"}
          </Badge>
        ) : null}
      </div>

      {open ? (
        <div className="flex max-w-sm flex-col gap-2">
          <Input
            placeholder="Robot's LAN address"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={submitting}
          />
          <Input
            type="password"
            // A code review (2026-09-27) found re-pairing a
            // revoked-and-rediscovered robot could never complete: its
            // rotated password was orphaned under the deleted device
            // row, so this field demanded a vendor default that no
            // longer worked. The server now tries this device's own
            // stored credential, then the most recent one rotated at
            // this same host, before ever needing what's typed here -
            // left blank on a re-pair or a plain re-rotation, only
            // required for a genuinely new or factory-reset unit.
            placeholder="Current password (leave blank to try the last one used)"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
          />
          {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button onClick={handleRotate} disabled={submitting || !host.trim()}>
              {submitting ? "Rotating…" : "Rotate"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
          {rotated ? "Rotate again" : "Rotate password"}
        </Button>
      )}
    </div>
  );
}

export function RobotPasswordSection() {
  // Household-wide (api.robotDevices(), not api.devices()): Quick Connect
  // mints a robot's device under whichever admin approved the pairing, so
  // a different admin still needs to see it here to rotate its password.
  const devicesQuery = useQuery<DeviceInfo[]>({ queryKey: ["robot-devices"], queryFn: () => api.robotDevices() });
  const robots = devicesQuery.data ?? [];

  if (devicesQuery.isFetching && !devicesQuery.data) return null;
  if (robots.length === 0) return null;

  return (
    <Section heading="Robot passwords">
      <p className="text-base text-[var(--muted-foreground)]">
        Every robot ships with a published default password. Rotate it here using the password
        printed in the robot's own setup guide - this hub never stores or guesses it for you.
      </p>
      <AsyncState
        data={robots}
        error={devicesQuery.isError}
        isFetching={false}
        onRetry={() => devicesQuery.refetch()}
        errorMessage="Could not load your robots."
        loadingLabel="Loading"
      >
        {(rows) => (
          <List
            items={rows}
            getKey={(d) => d.id}
            label="Robots"
            renderItem={(d) => <RobotPasswordRow device={d} />}
          />
        )}
      </AsyncState>
    </Section>
  );
}
