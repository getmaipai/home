import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
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
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <UsersIcon size={16} className="text-muted-foreground" />
          Users
        </CardTitle>
      </CardHeader>
      {canManage ? (
        <UsersSection person={person} />
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage users.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
