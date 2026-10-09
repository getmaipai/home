import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import RailProfileMenu from "@maipai/ui/src/dashboard/layouts/full/vertical/rail/RailProfileMenu";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { ROLE_LABELS } from "@/apps/people/roles";
import { NotificationBell, useNotificationsQuery } from "@/shell/NotificationBell";
import { useStatusSummary } from "@/shell/StatusIndicator";

const HELP_URL = "https://github.com/getmaipai/home/blob/main/docs/user/README.md";

/** RAIL-01 (owner's layout, 2026-10-06): Home's data for the kit's rail
 * profile menu. Notifications, system status, Incognito, Settings, Help
 * and Log out live here instead of the old global header; each keeps its
 * existing behaviour. A child sees no status row while something is
 * paused or down, the same rule the old header pill followed
 * (CHAT-CALM-ERRORS-01d), and that state puts no dot on a child's avatar. */
export function RailProfile({
  person,
  incognito,
  onIncognitoChange,
  onSignedOut,
}: {
  person: Roster;
  incognito: boolean;
  onIncognitoChange: (on: boolean) => void;
  onSignedOut: () => void;
}) {
  const items = useNotificationsQuery().data;
  const pending = Array.isArray(items) ? items.length : 0;
  const urgent = Array.isArray(items) && items.some((n) => n.level === "immediate");
  const { summary } = useStatusSummary();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const queryClient = useQueryClient();
  const child = person.age_band === "child";
  const homeSettings = isOwnerOrAdminRole(person.role) && person.age_band !== "child" && person.age_band !== "teen"
    ? { href: "/settings/home", label: "Home settings" }
    : undefined;
  const problem = summary.level === "degraded" || summary.level === "offline";
  const status = child && problem
    ? undefined
    : { label: summary.level === "online" ? "Good" : summary.text, level: summary.level, href: "/status" };

  return (
    <RailProfileMenu
      displayName={person.display_name}
      subtitle={ROLE_LABELS[person.role]}
      notifications={{ count: pending, urgent, onOpen: () => setNotificationsOpen(true) }}
      status={status}
      incognito={{ on: incognito, onChange: onIncognitoChange }}
      settingsHref="/settings"
      homeSettings={homeSettings}
      helpHref={HELP_URL}
      onLogout={() => {
        // The next person on this browser must never see this person's
        // cached answers, so the whole query cache goes with the session.
        api.logout().then(() => {
          queryClient.clear();
          onSignedOut();
        }, () => toast.error("Could not log out. Try again."));
      }}
    >
      <NotificationBell anchored open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </RailProfileMenu>
  );
}
