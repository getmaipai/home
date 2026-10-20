import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Card } from "@maipai/ui/src/dashboard/components/ui/card";
import { RobotBody } from "@/apps/settings/RobotBody";
import { api, ApiError, type DeviceInfo, type Roster } from "@/lib/api";

/** ROBOT-ADMIN-PLACE-01: the people-facing robots, shown on the Family page. State, mute, live view and the
 * motor-restart answer only; every management action (settings, rename, Forget, Cancel install) lives in
 * Home settings, Devices. A robot is a household member like a pet (owner's ruling 2026-10-20): everyone signed in
 * sees every robot and who owns it. */
export function fetchFamilyBots(_person: Roster): Promise<DeviceInfo[]> {
  return api.robotDevices();
}

export function familyBotsQueryKey(person: Roster) { return ["robots", person.id, person.role] as const; }

export function RobotCards({ person }: { person: Roster }) {
  const queryClient = useQueryClient();
  const query = useQuery<DeviceInfo[]>({ queryKey: familyBotsQueryKey(person), queryFn: () => fetchFamilyBots(person), refetchInterval: 5000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: familyBotsQueryKey(person) });
  return (
    <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the robots."} loadingLabel="Loading robots">
      {(rows: DeviceInfo[]) => rows.length === 0 ? <EmptyState icon="inbox" text="No robots yet. An admin adds one in Settings, Home, Devices." /> : (
        <div className="flex flex-col gap-4">
          {rows.map((robot) => (
            <Card key={robot.id} data-testid="robot-card">
              <RobotBody
                device={robot}
                viewerRole={person.role}
                viewerId={person.id}
                onSetMuted={(muted) => api.setRobotMuted(robot.id, muted).then(() => undefined)}
                onAnswerMotorReboot={(answer) => api.answerMotorReboot(robot.id, answer).finally(refresh).then(() => undefined)}
                onStartLiveView={() => api.startRobotLiveView(robot.id)}
                onStopLiveView={(viewId) => api.stopRobotLiveView(viewId).then(() => undefined)}
              />
            </Card>
          ))}
        </div>
      )}
    </AsyncState>
  );
}
