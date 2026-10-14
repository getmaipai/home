import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Roster, type SetupChecklistItem } from "@/lib/api";

const DISMISSED_CHECKLIST_KEY = "setup.checklist_dismissed";
const CHECKLIST_KEY = (personId: string) => ["setup-checklist", personId] as const;
const SETTINGS_KEY = (personId: string) => ["setup-checklist-settings", personId] as const;

function isOwnerOrAdmin(person: Roster): boolean {
  return person.role === "owner" || person.role === "admin";
}

export function useSetupChecklist(person: Roster) {
  const queryClient = useQueryClient();
  const allowed = isOwnerOrAdmin(person);
  const checklist = useQuery<SetupChecklistItem[]>({
    queryKey: CHECKLIST_KEY(person.id),
    queryFn: api.setupChecklist,
    enabled: allowed,
  });
  const dismiss = useMutation({
    mutationFn: async (itemId: string) => {
      const currentSettings = await queryClient.fetchQuery({
        queryKey: SETTINGS_KEY(person.id),
        queryFn: () => api.settingsValues(`person:${person.id}`),
        staleTime: 0,
      });
      const raw = currentSettings.find((setting) => setting.key === DISMISSED_CHECKLIST_KEY)?.value;
      let values: string[] = [];
      if (typeof raw === "string") {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) values = parsed.filter((entry): entry is string => typeof entry === "string");
        } catch {
          values = [];
        }
      }
      if (!values.includes(itemId)) values.push(itemId);
      return api.setSetting(`person:${person.id}`, DISMISSED_CHECKLIST_KEY, JSON.stringify(values));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHECKLIST_KEY(person.id) }),
        queryClient.invalidateQueries({ queryKey: SETTINGS_KEY(person.id) }),
        queryClient.invalidateQueries({ queryKey: ["settings", "person", person.id, DISMISSED_CHECKLIST_KEY] }),
      ]);
    },
  });

  return { checklist, dismiss, allowed };
}

export function setupChecklistCountLine(count: number): string | null {
  if (count < 1) return null;
  return `${count} ${count === 1 ? "thing" : "things"} left to finish setting up`;
}
