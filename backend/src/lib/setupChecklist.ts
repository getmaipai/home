import { listActivePeople, isOwnerOrAdmin } from "@/lib/access";
import { listBiometricPrints } from "@/lib/biometricPrints";
import { getSmbTarget } from "@/lib/backupTargets";
import { hasRedeemedDeviceToken } from "@/lib/deviceTokens";
import { hasNonDefaultInstalledPackage } from "@/lib/plugins";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { getPersonSettingValue } from "@/lib/settings";
import { effectiveMode } from "@/lib/retrieval/sourceMode";
import type { PersonRow } from "@/types";
import type { SetupChecklistItem } from "@/wire";

export const SETUP_CHECKLIST_ITEMS = [
  { id: "face-sign-in", title: "Set up face sign-in", reason: "A face print lets Home recognise you.", open: { label: "Open", href: "face" } },
  { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", open: { label: "Open", href: "/settings/home/people" } },
  { id: "backup-target", title: "Choose where backups go", reason: "A second place keeps a copy if this computer fails.", open: { label: "Open", href: "/settings/home/storage" } },
  { id: "phone-or-tablet", title: "Add a phone or tablet", reason: "Sign in on another device to use Home there.", open: { label: "Open", href: "/devices" } },
  { id: "web-search", title: "Fix web search", reason: "Home cannot complete its web search check yet.", open: { label: "Open", href: "/settings/home/search" } },
  { id: "apps", title: "Add apps", reason: "Add an app to give Home another useful skill.", open: { label: "Open", href: "/store" } },
] as const;

export type SetupChecklist = SetupChecklistItem[];

const DISMISSED_CHECKLIST_KEY = "setup.checklist_dismissed";

function dismissedIds(actor: PersonRow): Set<string> {
  const raw = getPersonSettingValue(actor, DISMISSED_CHECKLIST_KEY);
  if (typeof raw !== "string") return new Set();
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

/** Facts for the owner and admin setup checklist. The item definition is
 * kept together so a later fact adds one entry here. */
export async function getSetupChecklist(actor: PersonRow): Promise<SetupChecklist> {
  if (!isOwnerOrAdmin(actor)) return [];
  const activePeople = listActivePeople();
  const owner = activePeople.find((person) => person.role === "owner");
  const facePrints = owner ? listBiometricPrints(owner, owner.id) : null;
  const target = getSmbTarget();
  const hasDevice = hasRedeemedDeviceToken();
  const webIsOffline = effectiveMode("web", "adult") === "offline";
  const searchStatus = webIsOffline ? null : await checkSearchInstance({ updateRepairs: false });
  const searchWorks = webIsOffline || Boolean(searchStatus?.checks.length && searchStatus.checks.every((check) => check.state === "pass"));
  const appsAdded = hasNonDefaultInstalledPackage();
  const dismissed = dismissedIds(actor);

  const doneById: Record<(typeof SETUP_CHECKLIST_ITEMS)[number]["id"], boolean> = {
    "face-sign-in": Boolean(facePrints?.ok && facePrints.value.some((print) => print.modality === "face" && print.deleted_at === null)),
    family: activePeople.length > 1,
    "backup-target": target !== null,
    "phone-or-tablet": hasDevice,
    "web-search": searchWorks,
    apps: appsAdded,
  };

  return SETUP_CHECKLIST_ITEMS
    .filter((item) => !dismissed.has(item.id))
    .map((item) => ({
      ...item,
      done: doneById[item.id],
      open: item.id === "face-sign-in" && owner
        ? { ...item.open, href: `/people/${owner.id}/enroll-face` }
        : item.open,
    }));
}
