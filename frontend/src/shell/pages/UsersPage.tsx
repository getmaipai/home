import { i18n } from "@lingui/core";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { PeopleAccess } from "@/apps/settings/PeopleAccess";
import { SafetyChangesSection } from "@/apps/settings/SafetyChangesSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

export const UsersIcon = getIcon("users");

export function UsersPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Users", message: "Users" }));
  const canManage = isOwnerOrAdminRole(person.role);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <>
          <PeopleAccess person={person} />
          <SafetyChangesSection viewerRole={person.role} />
        </>
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{i18n._({ id: "Only an owner or admin can manage users.", message: "Only an owner or admin can manage users." })}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
