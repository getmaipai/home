import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type Roster } from "@/lib/api";
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
  const settingsResolved = settings.isSuccess || settings.isError;
  const wanted = settings.isSuccess && valueOf("companions.allowed") !== false && valueOf("companions.dock") !== false;
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, enabled: wanted });
  const activeId = valueOf("persona.active_id");
  const list = companions.data?.companions ?? [];
  const companion = !settingsResolved || (wanted && !companions.isSuccess && !companions.isError)
    ? undefined
    : list.find(({ id }) => id === activeId) ?? list.find(({ id }) => id === companions.data?.default_id);
  const companionId = companion?.id;
  const avatar = useQuery({ queryKey: [...COMPANION_AVATAR_QUERY_KEY, person.id, companionId ?? null], queryFn: () => api.companionAvatar(companionId), enabled: wanted && companionId !== undefined, staleTime: 5 * 60_000 });
  const activity = useQuery({ queryKey: ["companion-dock-activity", companionId ?? null], queryFn: () => api.companionActivity(companionId!), enabled: wanted && companionId !== undefined, staleTime: 0, refetchOnWindowFocus: true });
  const refetchActivity = activity.refetch;
  useEffect(() => { if (wanted && companionId !== undefined) void refetchActivity(); }, [pathname, wanted, companionId, refetchActivity]);

  if (!wanted || !companion || (avatar.isPending && !avatar.isError)) return null;
  const states = avatar.data?.avatar ? mapCompanionClips(avatar.data.avatar.states) : undefined;
  const still = companion.portrait ? api.companionPortrait(companion.portrait) : (avatar.data?.avatar?.portrait ?? (states?.idle ?? Object.values(states ?? {})[0])?.still);
  const row = (activity.data?.activity ?? []).find((item) => item.needs_you && item.kind !== "chat");
  return {
    companion,
    clips: states,
    portrait: avatar.data?.avatar?.portrait ?? undefined,
    still,
    action: row ? { label: "Review", onClick: () => navigate(`/companions/${encodeURIComponent(companion.id)}?tab=tasks&task=${encodeURIComponent(row.id)}`) } : undefined,
  };
}
