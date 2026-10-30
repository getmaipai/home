import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { UsersSection } from "@/apps/settings/UsersSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

export const UsersIcon = getIcon("users");

export function UsersPage({ person }: { person: Roster }) {
  useTabItem("Users");
  const canManage = isOwnerOrAdminRole(person.role);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <UsersSection person={person} />
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage users.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
