import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";

const Chevron = getIcon("chevron-right");

/** A card of link rows (a section's "Manage" card): each row is the kit's
 * Item drawn as a router link with a trailing chevron. Data in, rows out. */
export function SettingsLinks({ label, links }: { label: string; links: readonly { label: string; href: string }[] }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{label}</h2>
      <ItemGroup variant="card">
        {links.map((link, index) => (
          <Fragment key={link.href}>
            {index > 0 ? <ItemSeparator variant="inset" /> : null}
            <Item size="setting" render={<Link to={link.href} />}>
              <ItemContent>
                <ItemTitle>{link.label}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Chevron aria-hidden />
              </ItemActions>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </section>
  );
}
