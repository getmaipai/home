import { APP_CATALOG, favoriteApps, filterApps } from "@/shell/appCatalog";
import { usePinnedApps } from "@/shell/usePinnedApps";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/kit/ui/command";
import { getIcon } from "@/kit/icons";
import { runSearchProviders, type SearchResultItem } from "@/shell/search/providers";

interface CommandPaletteProps {
  personId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The prompt box's other half (step 6): Cmd/Ctrl+K everywhere, and the
 * "Search" nav row on every surface but `far` (`Shell.tsx` sends `far` to
 * `/search` instead - no free text entry beyond the remote's keyboard).
 * `shouldFilter={false}`: the providers already do their own "last token
 * prefix-matched" filtering (`providers.ts`), so cmdk's built-in fuzzy
 * scorer would only re-rank what is already the right result set. */
export function CommandPalette({ open, onOpenChange, personId }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { pinned } = usePinnedApps(personId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const { data: groups } = useQuery({
    queryKey: ["search", query],
    queryFn: () => runSearchProviders(query),
    enabled: open,
    placeholderData: (previous) => previous,
  });

  function select(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
    onOpenChange(false);
  }

  function askMaiPai() {
    navigate("/chat", { state: { initialText: query } });
    onOpenChange(false);
  }

  const trimmed = query.trim();
  const localApps = filterApps(APP_CATALOG, query).slice(0, 8);
  const localFavorites = trimmed ? [] : favoriteApps(pinned).slice(0, 6);
  const toItem = (app: typeof APP_CATALOG[number]): SearchResultItem => ({ id: `app:${app.to}`, label: app.label, sublabel: app.description, icon: app.icon, to: app.to });
  const visibleGroups = [
    { heading: "Favorites", items: localFavorites.map(toItem) },
    { heading: "Apps", items: localApps.filter((app) => !localFavorites.includes(app)).map(toItem) },
    ...(groups ?? []).filter((group) => group.heading !== "Apps"),
  ].filter((group) => group.items.length > 0);
  const hasResults = visibleGroups.length > 0;
  const AskIcon = getIcon("sparkles");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Launch apps or search people, memories, settings, and commands, or ask MaiPai directly."
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search, or ask MaiPai..." value={query} onValueChange={setQuery} />
        <CommandList>
          {!hasResults && trimmed === "" ? <CommandEmpty>Type to search, or press Enter to ask MaiPai.</CommandEmpty> : null}
          {visibleGroups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = getIcon(item.icon);
                return (
                  <CommandItem key={item.id} value={item.id} onSelect={() => select(item)}>
                    <Icon aria-hidden />
                    <span className="flex flex-col">
                      <span>{item.label}</span>
                      {item.sublabel ? <span className="text-xs text-muted-foreground">{item.sublabel}</span> : null}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          {trimmed !== "" ? (
            <CommandGroup heading="Ask">
              <CommandItem value="ask-maipai" onSelect={askMaiPai}>
                <AskIcon aria-hidden />
                <span>Ask MaiPai: {trimmed}</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
