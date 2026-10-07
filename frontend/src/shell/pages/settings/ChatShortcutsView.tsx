import { Fragment } from "react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { CHAT_SHORTCUTS } from "@/shell/pages/chatShortcuts";

/** Chat settings > Keyboard shortcuts, view `chat.shortcuts`: the chat's own
 * shortcut list (`chatShortcuts.ts`, the one definition the Cmd+/ sheet draws
 * from too), one kit Item per shortcut. */
export function ChatShortcutsView() {
  return (
    <section aria-label="Keyboard shortcuts">
    <ItemGroup variant="card">
      {CHAT_SHORTCUTS.map(([label, shortcut], index) => (
        <Fragment key={label}>
          {index > 0 ? <ItemSeparator variant="inset" /> : null}
          <Item size="setting">
            <ItemContent>
              <ItemTitle>{label}</ItemTitle>
            </ItemContent>
            <ItemActions>{shortcut}</ItemActions>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
    </section>
  );
}
