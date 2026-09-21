import FormLayoutsPage from "@maipai/ui/src/dashboard/views/pages/form";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@maipai/ui/src/dashboard/components/ui/tabs";

/** /next/settings: the stand-up's settings route (docs/plans/
 * shell-on-shadcndashboard-2026-09-21.md, step 1) - the template's own
 * form-layouts view under tabs, on its own demo data. The real page
 * structure (one section tree for both scopes, the scope switch, routed
 * link-out cards) is docs/dev/session-a-settings-rulings-2026-09-21.md;
 * this stand-up only proves the shipped tab/card primitives render. */
export function NextSettingsPage() {
  return (
    <Tabs defaultValue="household">
      <TabsList>
        <TabsTrigger value="household">Household</TabsTrigger>
        <TabsTrigger value="me">Me</TabsTrigger>
      </TabsList>
      <TabsContent value="household">
        <FormLayoutsPage />
      </TabsContent>
      <TabsContent value="me">
        <FormLayoutsPage />
      </TabsContent>
    </Tabs>
  );
}
