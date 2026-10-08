import { DevicesSection } from "@/apps/settings/DevicesSection";
import { AddRobotSection } from "@/apps/settings/AddRobotSection";
import { RobotPasswordSection } from "@/apps/settings/RobotPasswordSection";
import { EngineLinkCredentialSection } from "@/apps/settings/EngineLinkCredentialSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";

interface DevicesPageProps {
  person: Roster;
}

// Session E step 6: "sessions and devices with revoke," a personal
// Profile page (own devices/sessions, not household-admin) - nested
// under SettingsPage's own route (App.tsx) the same way Voices/Commands
// are, since a device/session list with revoke is a real management
// surface, not a settings toggle.
//
// ROBOT-DEVICE-01 adds "Add a robot" on the same page: pairing new
// hardware is a household-admin action (the backend route it calls is
// requireRole("owner", "admin")). A plain role check, not
// AdminGatedContent (that component's own "denied" card assumes it owns
// the whole page, "Back to Settings" button included - wrong fit for
// gating one section on a page the rest of stays open to everyone): a
// non-admin simply does not see this section at all, the same way
// renderAction hides the revoke button on someone else's session below.
export function DevicesPage({ person }: DevicesPageProps) {
  return (
    <>
      {isOwnerOrAdminRole(person.role) ? (
        <>
          <AddRobotSection />
          <RobotPasswordSection />
          <EngineLinkCredentialSection />
        </>
      ) : null}
      <DevicesSection />
    </>
  );
}
