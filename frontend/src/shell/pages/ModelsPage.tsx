import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { isOwnerOrAdminRole, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

export const ModelsIcon = getIcon("cpu");

export function ModelsPage({ person }: { person: Roster }) {
  useTabItem("AI models");
  const canManage = isOwnerOrAdminRole(person.role);

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <ModelsIcon size={16} className="text-muted-foreground" />
          AI models
        </CardTitle>
      </CardHeader>
      {canManage ? (
        <ModelsSection />
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage AI models.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
