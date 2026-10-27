import { useEffect, useState, type ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar, AvatarImage } from "@maipai/ui/src/elements/ui/avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import type { CompanionDock } from "@maipai/ui/src/elements/companion-dock";
import { api, type Roster } from "@/lib/api";
import { COMPANION_AVATAR_QUERY_KEY, mapCompanionClips } from "@/apps/chat/useCompanionAvatar";

const MINIMIZED_KEY = "maipai.companion.dock.minimized";
function readMinimized(): boolean { try { return localStorage.getItem(MINIMIZED_KEY) === "true"; } catch { return false; } }
function saveMinimized(value: boolean) { try { if (value) localStorage.setItem(MINIMIZED_KEY, "true"); else localStorage.removeItem(MINIMIZED_KEY); } catch { /* the dock still works when storage is blocked */ } }

/** The props of the corner dock outside Chat, or null when it should not draw: on Chat, while companions or the dock are off for this person, or while there is no companion to show. */
export function useCompanionDock(person: Roster): ComponentProps<typeof CompanionDock> | null {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [minimized, setMinimizedState] = useState(readMinimized);
  const scope = `person:${person.id}`;
  const onChat = pathname === "/chat" || pathname.startsWith("/chat/");
  const settings = useQuery({ queryKey: ["settingsValues", scope], queryFn: () => api.settingsValues(scope) });
  const values = Array.isArray(settings.data) ? settings.data : [];
  const valueOf = (key: string) => values.find((setting) => setting.key === key)?.value;
  const wanted = settings.isSuccess && valueOf("companions.allowed") !== false && valueOf("companions.dock") !== false && !onChat;
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, enabled: wanted });
  const activeId = valueOf("persona.active_id");
  const list = companions.data?.companions ?? [];
  const companion = list.find(({ id }) => id === activeId) ?? list.find(({ id }) => id === companions.data?.default_id);
  const companionId = companion?.id;
  const avatar = useQuery({ queryKey: [...COMPANION_AVATAR_QUERY_KEY, person.id, companionId ?? null], queryFn: () => api.companionAvatar(companionId), enabled: wanted && companionId !== undefined, staleTime: 5 * 60_000 });
  const activity = useQuery({ queryKey: ["companion-dock-activity", companionId ?? null], queryFn: () => api.companionActivity(companionId!), enabled: wanted && companionId !== undefined, staleTime: 0, refetchOnWindowFocus: true });
  const refetchActivity = activity.refetch;
  // A plain refetch when the person moves between pages, never on a timer (RULES.md S6).
  useEffect(() => { if (wanted && companionId !== undefined) void refetchActivity(); }, [pathname, wanted, companionId, refetchActivity]);

  if (!wanted || !companion) return null;
  const states = avatar.data?.avatar ? mapCompanionClips(avatar.data.avatar.states) : undefined;
  const still = companion.portrait ? api.companionPortrait(companion.portrait) : (states?.idle ?? Object.values(states ?? {})[0])?.still;
  const row = (activity.data?.activity ?? []).find((item) => item.needs_you && item.kind !== "chat");
  const setMinimized = (value: boolean) => { saveMinimized(value); setMinimizedState(value); };
  return {
    name: companion.name,
    face: still ? <Avatar><AvatarImage src={still} alt="" /></Avatar> : <SeededAvatar name={companion.name} seed={companion.id} />,
    line: row ? row.waiting_reason || "Waiting for you." : "Here when you need me.",
    reviewLabel: row ? "Review" : undefined,
    onReview: row ? () => navigate(`/companions/${encodeURIComponent(companion.id)}?tab=tasks&task=${encodeURIComponent(row.id)}`) : undefined,
    minimized,
    onMinimizedChange: setMinimized,
    onClose: () => { void api.setSetting(scope, "companions.dock", false).then(() => queryClient.invalidateQueries({ queryKey: ["settingsValues", scope] })); },
    minimizeLabel: `Minimize ${companion.name}`,
    expandLabel: `Show ${companion.name}`,
    closeLabel: `Hide ${companion.name}`,
    docked: true,
  };
}
