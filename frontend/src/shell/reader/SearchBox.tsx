import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@maipai/ui/src/ui/input";
import { api, type ReferenceSuggestion } from "@/lib/api";
import { ArticleCard } from "./ArticleCard";

const SUGGEST_DEBOUNCE_MS = 250;

export interface ReaderSearchBoxProps {
  book: string | undefined;
  placeholder: string;
  routeFor: (book: string, path: string) => string;
  onSearch: (q: string) => void;
  /** Starts with this text (the page's current query), so a results page shows what was searched. */
  initial?: string;
}

/** The reader's search box: type-ahead titles under the box, Enter runs a full search, ⌘K or Ctrl+K focuses it. */
export function ReaderSearchBox({ book, placeholder, routeFor, onSearch, initial = "" }: ReaderSearchBoxProps) {
  const [text, setText] = useState(initial);
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setText(initial); }, [initial]);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(text.trim()), SUGGEST_DEBOUNCE_MS); return () => window.clearTimeout(timer); }, [text]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); input.current?.focus(); input.current?.select(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const suggestions = useQuery<ReferenceSuggestion[]>({ queryKey: ["reference-suggest", book, debounced], queryFn: () => api.referenceSuggest(book, debounced), enabled: Boolean(book && debounced), staleTime: 30_000, retry: false });
  const items = open && debounced ? suggestions.data ?? [] : [];
  return (
    <form role="search" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { setOpen(false); onSearch(text.trim()); } }} className="relative mx-auto w-full max-w-2xl">
      <Input ref={input} aria-label={placeholder} value={text} onChange={(event) => { setText(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} placeholder={placeholder} autoComplete="off" />
      {items.length ? (
        <ul aria-label="Suggested articles" className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-20 mt-1 flex max-h-[28rem] flex-col overflow-y-auto rounded-lg border shadow-md">
          {items.map((item) => <li key={`${item.book}:${item.path}`} className="hover:bg-muted border-b last:border-b-0"><ArticleCard variant="row" book={item.book} path={item.path} title={item.title} to={routeFor(item.book, item.path)} onOpen={() => setOpen(false)} /></li>)}
        </ul>
      ) : null}
    </form>
  );
}
