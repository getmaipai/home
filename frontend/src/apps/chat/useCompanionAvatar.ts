import { useContext } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { CompanionClips } from "@maipai/ui/src/elements/companion-avatar-machine";
import { api } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

export const COMPANION_AVATAR_QUERY_KEY = ["companion-avatar"] as const;

export function mapCompanionClips(states: Record<string, { loop: boolean; urls: { h264: string; av1: string | null; still: string } }>): CompanionClips {
  return Object.fromEntries(Object.entries(states).map(([id, state]) => [id, {
    h264: state.urls.h264,
    av1: state.urls.av1 ?? undefined,
    still: state.urls.still,
    loop: state.loop,
  }])) as CompanionClips;
}

export function useCompanionAvatar(companionId?: string | null) {
  const person = useContext(WakeWordPersonContext);
  const query = useQuery({
    queryKey: [...COMPANION_AVATAR_QUERY_KEY, person?.id ?? null, companionId ?? null],
    queryFn: () => api.companionAvatar(companionId ?? undefined),
    enabled: person !== null,
    staleTime: 5 * 60_000,
  });
  const avatar = query.data?.avatar ?? null;
  return { avatar: query.isLoading || query.isPending ? null : avatar, clips: avatar ? mapCompanionClips(avatar.states) : null, loading: query.isLoading || query.isPending };
}

/** The idle still (else the first state's) of each companion, by id, plus `default` for the person's own default. Shares the avatar query cache. */
export function useCompanionStills(ids: string[]): Record<string, string | undefined> {
  const person = useContext(WakeWordPersonContext);
  const keys = [null, ...ids];
  const results = useQueries({
    queries: keys.map((id) => ({
      queryKey: [...COMPANION_AVATAR_QUERY_KEY, person?.id ?? null, id],
      queryFn: () => api.companionAvatar(id ?? undefined),
      enabled: person !== null,
      staleTime: 5 * 60_000,
    })),
  });
  const stills: Record<string, string | undefined> = {};
  keys.forEach((id, index) => {
    const states = results[index]?.data?.avatar?.states ?? {};
    stills[id ?? "default"] = (states.idle ?? Object.values(states)[0])?.urls.still;
  });
  return stills;
}
