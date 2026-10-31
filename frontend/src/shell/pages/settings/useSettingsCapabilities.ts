import { useQuery } from "@tanstack/react-query";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { meetsMinRole } from "@/apps/people/roles";
import { viewerBand } from "@/shell/pages/settings/settingsViewer";

/** The capability ids an area's `needs` can name, from what this home has
 * (APP-SET-02). The Coding check reads only the signed-in person's own key
 * eligibility. Child and teen profiles make no unrelated capability reads:
 * - `wakeword.assets`: the wake-word detector is installed (adults and up).
 * - `robot.paired`: a robot is paired (an admin asks for the household's,
 *   an adult for their own devices).
 * - `household.has_child`: the roster has a child (adult accounts only).
 * - `coding.allowed_for_me`: the signed-in person may manage their Coding keys (their own access check). */
export function useSettingsCapabilities(person: Roster, includeCodingAccess = false): { capabilities: readonly string[]; ready: boolean } {
  const adultOrUp = meetsMinRole(person.role, "adult");
  const adultBand = viewerBand(person) === "adult";
  const admin = isOwnerOrAdminRole(person.role);
  const wakeword = useQuery({ queryKey: ["wakeword-assets"], queryFn: () => api.wakewordStatus(), enabled: adultOrUp });
  const robots = useQuery({
    queryKey: ["settings-robots", admin ? "household" : "mine"],
    queryFn: async () => (admin ? await api.robotDevices() : await api.devices({ kind: "robot" })),
    enabled: adultOrUp && adultBand,
  });
  const settingsCapabilities = useQuery({
    queryKey: ["settings-capabilities"],
    queryFn: () => api.settingsCapabilities(),
    enabled: adultOrUp,
  });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: adultOrUp && adultBand });
  const coding = useQuery({ queryKey: ["coding-access", person.id], queryFn: api.codingAccess, enabled: includeCodingAccess && person.role !== "guest" });
  const capabilities: string[] = [];
  if (wakeword.data?.installed === true) capabilities.push("wakeword.assets");
  if ((robots.data?.length ?? 0) > 0) capabilities.push("robot.paired");
  if (adultOrUp && settingsCapabilities.data?.robotsEnabled === true) capabilities.push("robots.enabled");
  if (people.data?.some((entry) => entry.role === "child")) capabilities.push("household.has_child");
  if (coding.data?.allowed === true) capabilities.push("coding.allowed_for_me");
  const settled = (query: { isLoading: boolean; fetchStatus: string }) => !query.isLoading || query.fetchStatus === "idle";
  return { capabilities, ready: settled(wakeword) && settled(robots) && settled(settingsCapabilities) && settled(people) && settled(coding) };
}
