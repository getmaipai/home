import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { meetsMinRole } from "@/apps/people/roles";
import { viewerBand } from "@/shell/pages/settings/settingsViewer";

/** The capability ids an area's `needs` can name, from what this home has
 * (APP-SET-02). Each is read only for a viewer an area could show it to, so
 * a child's or teen's page makes none of these requests, and none of them is
 * a household-scope settings request:
 * - `wakeword.assets`: the wake-word detector is installed (adults and up).
 * - `robot.paired`: a robot is paired (an admin asks for the household's,
 *   an adult for their own devices).
 * - `household.has_child`: the roster has a child (adult accounts only). */
export function useSettingsCapabilities(person: Roster): { capabilities: readonly string[]; ready: boolean } {
  const adultOrUp = meetsMinRole(person.role, "adult");
  const adultBand = viewerBand(person) === "adult";
  const admin = isOwnerOrAdminRole(person.role);
  const wakeword = useQuery({ queryKey: ["wakeword-assets"], queryFn: () => api.wakewordStatus(), enabled: adultOrUp });
  const robots = useQuery({
    queryKey: ["settings-robots", admin ? "household" : "mine"],
    queryFn: async () => (admin ? await api.robotDevices() : (await api.devices()).filter((device) => device.kind === "robot")),
    enabled: adultOrUp && adultBand,
  });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: adultOrUp && adultBand });
  const capabilities: string[] = [];
  if (wakeword.data?.installed === true) capabilities.push("wakeword.assets");
  if ((robots.data?.length ?? 0) > 0) capabilities.push("robot.paired");
  if (people.data?.some((entry) => entry.role === "child")) capabilities.push("household.has_child");
  const settled = (query: { isLoading: boolean; fetchStatus: string }) => !query.isLoading || query.fetchStatus === "idle";
  return { capabilities, ready: settled(wakeword) && settled(robots) && settled(people) };
}
