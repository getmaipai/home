import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { Input } from "@/kit/ui/input";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { runSearchProviders, type SearchResultItem } from "@/shell/search/providers";
import { cn, FOCUS_RING } from "@/kit/utils";

// `far`'s own destination for the "Search" nav row and Cmd/Ctrl+K (step
// 6: "on far the palette is a page with no free text entry beyond the
// remote's keyboard") - the same providers as `CommandPalette.tsx`, laid
// out as a real page instead of a modal, since a Dialog over a remote-
// navigated ten-foot surface is the wrong shape (nothing to click
// outside of, no pointer to dismiss it with).
export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // A plain effect-driven focus, not the JSX `autoFocus` prop: the kit's
  // lint bans that outright (jsx-a11y/no-autofocus) - moving focus
  // without the household member asking for it is disorienting for
  // screen-reader and keyboard navigation in general. This page is the
  // one deliberate exception (its whole reason to exist is "type
  // immediately"), so the focus is still real, just requested this way
  // instead of via the banned attribute.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data: groups } = useQuery({
    queryKey: ["search", query],
    queryFn: () => runSearchProviders(query),
    placeholderData: (previous) => previous,
  });

  function select(item: SearchResultItem) {
    navigate(item.to, item.state ? { state: item.state } : undefined);
  }

  function askMaiPai() {
    navigate("/chat", { state: { initialText: query } });
  }

  const trimmed = query.trim();
  const AskIcon = getIcon("sparkles");

  return (
    <Page title="Search">
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, or ask MaiPai..."
          aria-label="Search"
        />
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
        <div tabIndex={0} className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto", FOCUS_RING)}>
          {(groups ?? []).map((group) => (
            <section key={group.heading} aria-label={group.heading}>
              <h2 className="mb-1 text-xs font-medium text-muted-foreground">{group.heading}</h2>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const Icon = getIcon(item.icon);
                  return (
                    <li key={item.id}>
                      <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => select(item)}>
                        <Icon aria-hidden />
                        <span className="flex flex-col items-start">
                          <span>{item.label}</span>
                          {item.sublabel ? <span className="text-xs text-muted-foreground">{item.sublabel}</span> : null}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {trimmed !== "" ? (
            <Button variant="secondary" className="justify-start gap-2" onClick={askMaiPai}>
              <AskIcon aria-hidden />
              Ask MaiPai: {trimmed}
            </Button>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
