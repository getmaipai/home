import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "@maipai/ui/src/dashboard/components/ui/card";

interface ManageLink {
  title: string;
  description: string;
  to: string;
}

const MANAGE_LINKS: readonly ManageLink[] = [
  { title: "Engines", description: "Roles, state and health of the Stack's own engines.", to: "/next/engines" },
  { title: "Updates", description: "What's available and what's already up to date.", to: "/next/updates" },
  { title: "Repairs", description: "Open issues and the fix each one names.", to: "/next/repairs" },
  { title: "Backups", description: "History, size, and anything staged to restore.", to: "/next/backups" },
];

/** Settings' own Household tab, bottom section (owner ruling, ui-v0.5.23's
 * rail restructuring): Engines, Updates, Repairs and Backups lost their
 * permanent rail entry the same release - real pages, real routes,
 * still reachable, just not rail weight for four pages a household
 * visits rarely. One Card per page here, the template's own primitives
 * and a plain `react-router-dom` `Link`, nothing drawn: a title, one
 * line, click through to the real page. Rendered only inside the
 * Household tab, which `NextSettingsPage.tsx` already gates to owner/
 * admin - the same visibility every one of these four pages already
 * enforces on its own. */
export function NextManageSection() {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">Manage</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {MANAGE_LINKS.map((link) => (
          <Link key={link.to} to={link.to} className="block">
            <Card className="py-4 transition-colors hover:bg-accent">
              <CardHeader>
                <CardTitle>{link.title}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
