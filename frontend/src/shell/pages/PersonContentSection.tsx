import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { api, type ResolvedSetting } from "@/lib/api";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";

/** CONTENT-POLICY-05: the keys a person sees on their own page (their own lowering and their own filters). The hub leaves out a key
 * the person may not set, so a missing one is simply not drawn (absent, not locked). Every label and option is the spec's. */
export const OWN_CONTENT_KEYS = ["content.own_ceiling", "content.own_unrated", "content.filters"] as const;

/** Whether the person's own page has any content control to show. It reads the same settings list the renderer below does, so it is one request. */
export function useOwnContentKeys(personId: string, enabled: boolean): boolean {
  const query = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", `person:${personId}`], queryFn: () => api.settingsValues(`person:${personId}`), enabled });
  return enabled && (query.data ?? []).some((value) => (OWN_CONTENT_KEYS as readonly string[]).includes(value.key));
}

/** The content controls of one person's page. `viewingSelf`: their own lowering and filters. An owner or admin on someone else's page: that
 * person's content level, unrated choices and the filters the admin may set, read through the one narrow override read (`GET /api/people/:id/overrides`),
 * because an admin's ordinary settings read reaches a child only. The registry renders every control. */
export function PersonContentSection({ personId, viewingSelf, heading = false, onSaved }: { personId: string; viewingSelf: boolean; heading?: boolean; onSaved?: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="person-content-section">
      {heading ? <h2 className="text-section">{i18n._({ id: "Content", message: "Content" })}</h2> : null}
      {viewingSelf
        ? <SettingsRenderer scope="person" scopeValue={`person:${personId}`} only={["person.allowance"]} includeKeys={OWN_CONTENT_KEYS} plainRows onSaved={onSaved} />
        : <SettingsRenderer scope="person" scopeValue={`person:${personId}`} only={["person.allowance"]} overrides plainRows onSaved={onSaved} />}
    </div>
  );
}
