import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type DeviceInfo, type Roster } from "@/lib/api";
import { COMPANION_AVATAR_QUERY_KEY, mapCompanionClips } from "@/apps/chat/useCompanionAvatar";

/** The ambient companion data used by the shell, or null while settings load,
 * when the person turns it off, or when no companion is available. */
export function useAmbientCompanion(person: Roster) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scope = `person:${person.id}`;
  const settings = useQuery({ queryKey: ["settingsValues", scope], queryFn: () => api.settingsValues(scope) });
  const values = Array.isArray(settings.data) ? settings.data : [];
  const valueOf = (key: string) => values.find((setting) => setting.key === key)?.value;
  const wanted = settings.isSuccess && valueOf("companions.allowed") !== false && valueOf("companions.dock") !== false;
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, enabled: wanted });
  const robots = useQuery({ queryKey: ["devices", "robots"], queryFn: api.robotDevices, enabled: wanted });
  const refetchRobots = robots.refetch;
  useEffect(() => { if (wanted) void refetchRobots(); }, [pathname, wanted, refetchRobots]);
  const ambientBot = valueOf("companions.ambient_bot");
  const robotRows = Array.isArray(robots.data) ? robots.data : [];
  const robot = typeof ambientBot === "string" ? robotRows.find((item) => item.id === ambientBot && item.companion_id) : undefined;
  const activeId = valueOf("persona.active_id");
  const list = companions.data?.companions ?? [];
  const companion = list.find(({ id }) => id === activeId) ?? list.find(({ id }) => id === companions.data?.default_id);
  const companionId = companion?.id;
  const avatar = useQuery({ queryKey: [...COMPANION_AVATAR_QUERY_KEY, person.id, companionId ?? null], queryFn: () => api.companionAvatar(companionId), enabled: wanted && !robot && companionId !== undefined, staleTime: 5 * 60_000 });
  const activity = useQuery({ queryKey: ["companion-dock-activity", robot?.companion_id ?? companionId ?? null], queryFn: () => api.companionActivity((robot?.companion_id ?? companionId)!), enabled: wanted && (robot?.companion_id !== undefined || (!robot && companionId !== undefined)), staleTime: 0, refetchOnWindowFocus: true });
  const refetchActivity = activity.refetch;
  useEffect(() => { if (wanted && (robot?.companion_id || companionId) !== undefined) void refetchActivity(); }, [pathname, wanted, robot?.companion_id, companionId, refetchActivity]);

  if (!settings.isSuccess || (wanted && robots.isPending)) return undefined;
  if (!wanted) return null;
  if (robot) {
    const row = (activity.data?.activity ?? []).find((item) => item.needs_you && item.kind !== "chat");
    return {
      kind: "bot" as const,
      device: robot,
      companionId: robot.companion_id!,
      name: robot.name,
      face: { color: robot.face_color ?? "mint", night: robot.night ?? false },
      presence: robot.online ? robot.state?.presence ?? robot.state?.activity ?? "idle" : "offline",
      room: robot.area,
      battery: robot.state?.battery_level ?? null,
      onBattery: robot.state?.on_battery ?? null,
      online: robot.online ?? false,
      speaking: robot.speaking,
      action: row ? { label: "Review", onClick: () => navigate(`/companions/${encodeURIComponent(robot.companion_id!)}?tab=tasks&task=${encodeURIComponent(row.id)}`) } : undefined,
    };
  }
  if (!companion) return null;
  const states = avatar.data?.avatar ? mapCompanionClips(avatar.data.avatar.states) : undefined;
  const still = companion.portrait ? api.companionPortrait(companion.portrait) : (avatar.data?.avatar?.portrait ?? (states?.idle ?? Object.values(states ?? {})[0])?.still);
  const row = (activity.data?.activity ?? []).find((item) => item.needs_you && item.kind !== "chat");
  return {
    kind: "companion" as const,
    companion,
    clips: states,
    portrait: avatar.data?.avatar?.portrait ?? undefined,
    still,
    action: row ? { label: "Review", onClick: () => navigate(`/companions/${encodeURIComponent(companion.id)}?tab=tasks&task=${encodeURIComponent(row.id)}`) } : undefined,
  };
}

export type AmbientBot = Extract<NonNullable<ReturnType<typeof useAmbientCompanion>>, { kind: "bot" }>;
export type AmbientCompanion = Extract<NonNullable<ReturnType<typeof useAmbientCompanion>>, { kind: "companion" }>;
export type AmbientRobot = DeviceInfo;
