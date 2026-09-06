import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/kit/ui/command";
import { getIcon } from "@/kit/icons";
import { runSearchProviders, type SearchResultItem } from "@/shell/search/providers";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The prompt box's other half (step 6): Cmd/Ctrl+K everywhere, and the
 * "Search" nav row on every surface but `far` (`Shell.tsx` sends `far` to
 * `/search` instead - no free text entry beyond the remote's keyboard).
 * `shouldFilter={false}`: the providers already do their own "last token
 * prefix-matched" filtering (`providers.ts`), so cmdk's built-in fuzzy
 * scorer would only re-rank what is already the right result set. */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
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
  const hasResults = (groups ?? []).some((g) => g.items.length > 0);
  const AskIcon = getIcon("sparkles");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search pages, people, memories, settings, and commands, or ask MaiPai directly."
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search, or ask MaiPai..." value={query} onValueChange={setQuery} />
        <CommandList>
          {!hasResults && trimmed === "" ? <CommandEmpty>Type to search, or press Enter to ask MaiPai.</CommandEmpty> : null}
          {(groups ?? []).map((group) => (
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
