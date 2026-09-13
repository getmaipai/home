import { CommandEmpty, CommandGroup, CommandItem } from "@/kit/ui/command";
import { getIcon } from "@/kit/icons";
import type { SearchGroup, SearchResultItem } from "@/shell/search/providers";

const AskIcon = getIcon("sparkles");

/** The shared result list both `CommandPalette.tsx` and `HomePage.tsx`'s
 * prompt box render inside their own `<Command>`/`<CommandList>` - one
 * definition of what a search result row looks like and how "ask MaiPai
 * instead" is offered.
 *
 * The "Ask" row renders FIRST, not last: cmdk auto-highlights whatever
 * renders first, and both boxes' own acceptance is "Enter with nothing
 * deliberately selected sends the typed text to chat" - the exact
 * behavior a plain, search-free prompt box already had. Putting a real
 * match first (as the palette used to) would make a bare Enter open
 * that match instead, a real behavior change nothing asked for. Arrowing
 * down to a real result still opens it; Enter with no arrowing asks
 * MaiPai either way, on both surfaces alike. */
export function SearchResultGroups({
  groups,
  trimmedQuery,
  onSelect,
  onAsk,
}: {
  groups: SearchGroup[];
  trimmedQuery: string;
  onSelect: (item: SearchResultItem) => void;
  onAsk: () => void;
}) {
  const hasResults = groups.length > 0;
  return (
    <>
      {!hasResults && trimmedQuery === "" ? <CommandEmpty>Type to search, or press Enter to ask MaiPai.</CommandEmpty> : null}
      {trimmedQuery !== "" ? (
        <CommandGroup heading="Ask">
          <CommandItem value="ask-maipai" onSelect={onAsk}>
            <AskIcon aria-hidden />
            <span>Ask MaiPai: {trimmedQuery}</span>
          </CommandItem>
        </CommandGroup>
      ) : null}
      {groups.map((group) => (
        <CommandGroup key={group.heading} heading={group.heading}>
          {group.items.map((item) => {
            const Icon = getIcon(item.icon);
            return (
              <CommandItem key={item.id} value={item.id} onSelect={() => onSelect(item)}>
                <Icon aria-hidden />
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {/* text-base, not text-xs: the type floor (docs/UI.md), lane 7 item 3. */}
                  {item.sublabel ? <span className="text-base text-muted-foreground">{item.sublabel}</span> : null}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </>
  );
}
