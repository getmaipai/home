// STACK-MENU-SYNC-01: a Stack screen that has no kit page yet. Each row is the screen's title, the one-line question the Stack admin shows for it,
// and the button that opens the Stack admin (the same address rules as everywhere: this computer, the remote address, or the Stack's plain reason).
// Drawn only from shipped kit Items (ItemGroup, Item, ItemTitle, ItemDescription, ItemActions), as the Media cards do; no className on any of them.
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { stackAdminButton, useStackAdminLink } from "@/apps/settings/StackAdminLink";
import { screenLabel, screenQuestion, stubScreensOf } from "@/apps/settings/stack/stackScreens";
import { i18n } from "@lingui/core";

export function StackScreenStubs({ tab }: { tab: string }) {
  const link = useStackAdminLink();
  const screens = stubScreensOf(tab);
  if (screens.length === 0) return null;
  const label = i18n._({ id: "Open in Stack admin", message: "Open in Stack admin" });
  return (
    <section className="flex flex-col gap-3" data-testid={`stack-stubs-${tab}`}>
      {link.ready && !link.href && link.reason ? <p className="text-supporting">{link.reason}</p> : null}
      <ItemGroup variant="card">
        {screens.map((screen) => (
          <Item key={screen.id} size="setting" data-testid={`stack-screen-${screen.id}`}>
            <ItemContent>
              <ItemTitle>{screenLabel(screen)}</ItemTitle>
              <ItemDescription clamp={false}>{screenQuestion(screen)}</ItemDescription>
            </ItemContent>
            <ItemActions>{stackAdminButton(link.href, label)}</ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}
