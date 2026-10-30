import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { api, type WorldPlaceView } from "@/lib/api";
import { CLOCK_ADD_EVENT } from "@/apps/clock/clockHeader";

const worldPlacesKey = ["world-places"];

type ClockPlace = WorldPlaceView & { isHome: boolean };

function zoneOffsetMinutes(zone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function offsetText(zone: string, homeZone: string, date: Date) {
  const difference = zoneOffsetMinutes(zone, date) - zoneOffsetMinutes(homeZone, date);
  if (!difference) return "same time";
  const hours = Math.floor(Math.abs(difference) / 60);
  const minutes = Math.abs(difference) % 60;
  const amount = hours
    ? `${hours} ${hours === 1 ? "hour" : "hours"}${minutes ? ` ${minutes} minutes` : ""}`
    : `${minutes} minutes`;
  return `${amount} ${difference > 0 ? "ahead of you" : "behind"}`;
}

function dayMarker(zone: string, homeZone: string, date: Date) {
  const localDay = (timeZone: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const difference = (Date.parse(`${localDay(zone)}T00:00:00Z`) - Date.parse(`${localDay(homeZone)}T00:00:00Z`)) / 86_400_000;
  if (difference > 0) return "Tomorrow";
  if (difference < 0) return "Yesterday";
  return "Today";
}

function localClock(place: ClockPlace, now: number, homeZone: string) {
  const date = new Date(now);
  const time = new Intl.DateTimeFormat(undefined, { timeZone: place.zone, hour: "numeric", minute: "2-digit" }).format(date);
  const dateText = new Intl.DateTimeFormat(undefined, { timeZone: place.zone, weekday: "long", month: "long", day: "numeric" }).format(date);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: place.zone, hour: "numeric", hourCycle: "h23" }).format(date));
  return { time, dateText, day: dayMarker(place.zone, homeZone, date), offset: offsetText(place.zone, homeZone, date), daytime: hour >= 6 && hour < 18 };
}

export function WorldClocksTab({ homeZone: providedZone, enabled = true }: { homeZone?: string; enabled?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: worldPlacesKey, queryFn: api.worldPlaces, enabled });
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.localSearchPlaces>>>([]);
  const [limitMessage, setLimitMessage] = useState("");
  const homeZone = providedZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const saved = useMemo(() => query.data ?? [], [query.data]);
  const places: ClockPlace[] = useMemo(() => [
    { id: "home", name: "Home", country: "", zone: homeZone, position: -1, isHome: true },
    ...saved.map((place) => ({ ...place, isHome: false })),
  ], [homeZone, saved]);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    const addPlace = () => {
      if (!enabled) return;
      setSearch("");
      setResults([]);
      setLimitMessage("");
      setOpen(true);
    };
    window.addEventListener(CLOCK_ADD_EVENT, addPlace);
    return () => window.removeEventListener(CLOCK_ADD_EVENT, addPlace);
  }, [enabled]);

  useEffect(() => {
    const term = search.trim();
    if (!enabled || term.length < 2) {
      setResults([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void api.localSearchPlaces(term).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [enabled, search]);

  async function refreshPlaces() {
    await client.invalidateQueries({ queryKey: worldPlacesKey });
  }

  async function addPlace(place: { name: string; country: string; zone: string }) {
    try {
      await api.createWorldPlace({ ...place, source: "local" });
      setOpen(false);
      await refreshPlaces();
    } catch (error) {
      setLimitMessage(error instanceof Error ? error.message : "You can save up to 12 places.");
    }
  }

  async function movePlace(place: WorldPlaceView, direction: -1 | 1) {
    const index = saved.findIndex((item) => item.id === place.id);
    const target = index + direction;
    if (target < 0 || target >= saved.length) return;
    const reordered = [...saved];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    await Promise.all(reordered.map((item, position) => api.updateWorldPlace(item.id, position)));
    await refreshPlaces();
  }

  if (!enabled) return null;

  return (
    <section aria-label="World clocks" className="py-2">
      {query.isError ? <p role="alert">Could not load world clocks.</p> : null}
      {places.length === 1 ? <p className="py-10 text-center">
        <span className="block text-lg">No places yet</span>
        <span className="text-muted-foreground">Keep your favorite places close.</span>
      </p> : <ul className="m-0 list-none p-0">
        {places.map((place) => {
          const clock = localClock(place, now, homeZone);
          return <li key={place.id} className="flex flex-wrap items-center justify-between gap-4 border-b py-5">
            <div className="min-w-40">
              <h2 className="m-0 font-semibold">{place.name}</h2>
              {place.country ? <p className="m-0 text-sm text-muted-foreground">{place.country}</p> : null}
              <p className="m-0 text-sm text-muted-foreground">{clock.offset} · {clock.day}</p>
            </div>
            <div className="text-right">
              <time className="block text-3xl tabular-nums">{clock.time}</time>
              <span className="text-sm text-muted-foreground">{clock.dateText} · <span aria-label={clock.daytime ? "Daytime" : "Nighttime"}>{clock.daytime ? "☀" : "☾"}</span></span>
            </div>
            {!place.isHome ? <div className="flex gap-1">
              <Button type="button" variant="ghost" aria-label={`Move ${place.name} up`} onClick={() => void movePlace(place, -1)}>↑</Button>
              <Button type="button" variant="ghost" aria-label={`Move ${place.name} down`} onClick={() => void movePlace(place, 1)}>↓</Button>
              <Button type="button" variant="ghost" aria-label={`Remove ${place.name}`} onClick={() => void api.deleteWorldPlace(place.id).then(refreshPlaces)}>Remove</Button>
            </div> : null}
          </li>;
        })}
      </ul>}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Add a place</SheetTitle>
            <SheetDescription>Search offline city data for a time zone.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-3 px-4">
            <Label htmlFor="world-search">City</Label>
            <Input id="world-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cities" />
            {limitMessage ? <p role="alert">{limitMessage}</p> : null}
            <ul className="m-0 list-none p-0">
              {results.map((place) => <li key={`${place.name}-${place.zone}`}>
                <Button type="button" variant="ghost" align="start" width="full" onClick={() => void addPlace({ name: place.name, country: place.country, zone: place.zone })}>{place.name}, {place.country}</Button>
              </li>)}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
