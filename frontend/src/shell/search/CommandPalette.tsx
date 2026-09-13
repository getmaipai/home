import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandDialog, CommandInput, CommandList } from "@/kit/ui/command";
import { useSearchCommand } from "@/shell/search/useSearchCommand";
import { SearchResultGroups } from "@/shell/search/SearchResultGroups";
import type { SearchResultItem } from "@/shell/search/providers";

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
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const { visibleGroups, trimmed } = useSearchCommand(personId, query, open);

  function select(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
    onOpenChange(false);
  }

  function askMaiPai() {
    navigate("/chat", { state: { initialText: query } });
    onOpenChange(false);
  }

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
          <SearchResultGroups groups={visibleGroups} trimmedQuery={trimmed} onSelect={select} onAsk={askMaiPai} />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
