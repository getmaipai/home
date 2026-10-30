// MEM-SPACE-04 / TIER-PRIO-02: Customize, the one home of the priorities panel and the profile table (making-space note section 5 item 5). Every field states its effect first; a change here makes the page read Custom.
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { CATEGORIES, CATEGORY_WORDS, ROW_WORDS, cellOptions, parseList, parseProfiles, specKey, type Category, type Cell } from "@/apps/settings/performanceModel";

type Value = (key: string) => unknown;
type Write = (changes: Record<string, unknown>) => Promise<void>;
const CELL_WORDS: Record<Cell, string> = { reduced: "Reduced", standard: "Standard", boost: "Boost", max: "Max", queued: "Waits", off: "Off" };

function NumberRow({ id, value, write, onError }: { id: string; value: Value; write: Write; onError: (message: string) => void }) {
  const entry = specKey(id) as ReturnType<typeof specKey> & { range?: { min?: number; max?: number } };
  const min = entry.range?.min ?? 0;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value(id));
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft);
    setDraft(null);
    if (!Number.isFinite(next) || next < min || (entry.range?.max !== undefined && next > entry.range.max)) return onError(`${entry.label} must be a whole number of seconds from ${min}${entry.range?.max !== undefined ? ` to ${entry.range.max}` : ""}.`);
    write({ [id]: Math.round(next) }).catch(() => onError("Home could not save that change. Check your connection and try again."));
  };
  return (
    <div data-testid={`number-${id}`}><Item size="setting">
      <ItemContent><ItemTitle>{entry.label}</ItemTitle><ItemDescription clamp={false}>{entry.help}</ItemDescription></ItemContent>
      <ItemActions><Input type="number" inputMode="numeric" aria-label={entry.label} min={min} value={shown} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} /></ItemActions>
    </Item></div>
  );
}

export function PerformanceCustomize({ value, write }: { value: Value; write: Write }) {
  const [error, setError] = useState<string | null>(null);
  const save = (changes: Record<string, unknown>) => { setError(null); write(changes).catch(() => setError("Home could not save that change. Check your connection and try again.")); };
  // Chat and voice stay first and cannot move; the list holds the other categories.
  const order = parseList(value("resources.priority")).filter((id) => id !== "chat");
  const move = (index: number, by: -1 | 1) => { const next = [...order]; const target = index + by; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; save({ "resources.priority": JSON.stringify(["chat", ...next]) }); };
  const profiles = parseProfiles(value("resources.profiles"));
  const setCell = (row: string, category: Category | "tools", cell: Cell) => save({ "resources.profiles": JSON.stringify({ ...profiles, [row]: { ...profiles[row], [category]: cell } }) });
  const columns: (Category | "tools")[] = [...CATEGORIES, "tools"];
  return (
    <div data-testid="performance-customize" role="group" aria-label="Customize">
      {error ? <p role="alert">{error}</p> : null}
      <section aria-label="Order of importance">
        <ItemGroup variant="card">
          <Item size="setting"><ItemContent><ItemTitle>{specKey("resources.priority").label}</ItemTitle><ItemDescription clamp={false}>Chat and voice always go first. When two big jobs want the same room, the one higher here goes first.</ItemDescription></ItemContent></Item>
          {order.map((id, index) => (
            <Item key={id} size="setting">
              <ItemContent><ItemTitle>{CATEGORY_WORDS[id as Category] ?? id}</ItemTitle></ItemContent>
              <ItemActions>
                <Button variant="outline" aria-label={`Move ${CATEGORY_WORDS[id as Category] ?? id} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</Button>
                <Button variant="outline" aria-label={`Move ${CATEGORY_WORDS[id as Category] ?? id} down`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>Down</Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>
      <section aria-label="Timing">
        <ItemGroup variant="card">
          <NumberRow id="resources.quiet_seconds" value={value} write={write} onError={setError} />
          <NumberRow id="resources.quiet_max_wait" value={value} write={write} onError={setError} />
          <Item size="setting">
            <ItemContent><ItemTitle>{specKey("resources.quiet_timeout").label}</ItemTitle><ItemDescription clamp={false}>{specKey("resources.quiet_timeout").help}</ItemDescription></ItemContent>
            <ItemActions>
              <Select value={String(value("resources.quiet_timeout"))} onValueChange={(next) => save({ "resources.quiet_timeout": next })}>
                <SelectTrigger aria-label={specKey("resources.quiet_timeout").label}><SelectValue /></SelectTrigger>
                <SelectContent>{(specKey("resources.quiet_timeout").range?.options ?? []).map((option) => <SelectItem key={option} value={option}>{option === "proceed" ? "Go ahead" : "Keep waiting"}</SelectItem>)}</SelectContent>
              </Select>
            </ItemActions>
          </Item>
          <NumberRow id="resources.cooldown_seconds" value={value} write={write} onError={setError} />
        </ItemGroup>
      </section>
      <section aria-label="Lower without asking">
        <ItemGroup variant="card">
          {CATEGORIES.map((category) => {
            const id = `resources.lower_without_asking.${category}`;
            return (
              <Item key={id} size="setting">
                <ItemContent><ItemTitle>{specKey(id).label}</ItemTitle><ItemDescription clamp={false}>{specKey(id).help}</ItemDescription></ItemContent>
                <ItemActions><Switch aria-label={specKey(id).label} checked={value(id) === true} onCheckedChange={(on) => save({ [id]: on })} /></ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </section>
      <section aria-label={specKey("resources.profiles").label}>
        <ItemGroup variant="card">
          <Item size="setting"><ItemContent><ItemTitle>{specKey("resources.profiles").label}</ItemTitle><ItemDescription clamp={false}>Each row is a big job. Each column says what that category does while the job runs. Chat is never paused, only made simpler.</ItemDescription></ItemContent></Item>
        </ItemGroup>
        <Table data-testid="profile-table">
          <TableHeader><TableRow><TableHead>While this runs</TableHead>{columns.map((column) => <TableHead key={column}>{CATEGORY_WORDS[column]}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {Object.entries(profiles).map(([row, cells]) => (
              <TableRow key={row}>
                <TableCell>{ROW_WORDS(row)}</TableCell>
                {columns.map((column) => (
                  <TableCell key={column}>
                    <Select value={cells[column] ?? "standard"} onValueChange={(next) => setCell(row, column, next as Cell)}>
                      <SelectTrigger aria-label={`${ROW_WORDS(row)}: ${CATEGORY_WORDS[column]}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{cellOptions(column).map((cell) => <SelectItem key={cell} value={cell}>{CELL_WORDS[cell]}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
