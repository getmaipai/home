import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { api, isOwnerOrAdminRole, type Roster } from "@/lib/api";

type Candidate = { name: string; area: string | null; lat: number; lon: number };
export const label = (c: Candidate) => (c.area ? `${c.name}, ${c.area}` : c.name);

/** WEATHER-HOME-ASK-01: asked once, on first use, until the household has a home. An owner or admin taps "Use my location"
 * (the browser asks; nothing is read before the tap) or types a city; the city is found in the offline gazetteer, confirmed
 * with one tap, then saved as the household home. Anyone else is told to ask a grown-up. Nothing leaves the home. */
export function HomePlaceAsk({ person }: { person: Roster }) {
  const queryClient = useQueryClient();
  const admin = isOwnerOrAdminRole(person.role);
  const home = useQuery({ queryKey: ["household-home"], queryFn: () => api.settingsValues("household", "household.home"), retry: false });
  const [typed, setTyped] = useState("");
  const [choices, setChoices] = useState<Candidate[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const row = Array.isArray(home.data) ? home.data.find((r) => r.key === "household.home") : undefined;
  if (home.isPending || home.isError || (row && row.value)) return null;
  if (!admin) {
    return (
      <section aria-label="Where is your home?" data-testid="home-place-card">
        <Card size="sm">
          <CardHeader><CardTitle>Where is your home?</CardTitle><CardDescription>Ask a grown-up to set the home location, so weather and sunrise know where you are.</CardDescription></CardHeader>
        </Card>
      </section>
    );
  }

  const find = async (q: string) => {
    setBusy(true); setNote(null);
    try {
      const hits = await api.localSearchPlaces(q);
      setChoices(hits);
      if (hits.length === 0) setNote("I could not find that city. Try the city and state, like Springfield MO.");
    } catch { setNote("Looking that up did not work. Try again."); }
    setBusy(false);
  };

  const useMyLocation = () => {
    setNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) { setNote("This browser cannot share a location. Type your city instead."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const hit = await api.nearestPlace(Number(pos.coords.latitude.toFixed(2)), Number(pos.coords.longitude.toFixed(2)));
          if (hit) setChoices([hit]); else setNote("I could not tell which city that is. Type your city instead.");
        } catch { setNote("Looking that up did not work. Type your city instead."); }
        setBusy(false);
      },
      () => { setNote("The browser did not share a location. Type your city instead."); setBusy(false); },
      { timeout: 10000, maximumAge: 600000 },
    );
  };

  const save = async (c: Candidate) => {
    setBusy(true); setNote(null);
    try {
      const created = await api.createEntity({ kind: "place", place_kind: "map", name: c.name, scope: "household", geo: { lat: c.lat, lon: c.lon, precision: "exact", area: c.area, from: "search" } });
      await api.setSetting("household", "household.home", created.id);
      await queryClient.invalidateQueries({ queryKey: ["household-home"] });
      await queryClient.invalidateQueries({ queryKey: ["widgets"] });
      await queryClient.invalidateQueries({ queryKey: ["widget-data"] });
    } catch { setNote("Saving did not work. Try again, or set it in Settings."); setBusy(false); }
  };

  return (
    <section aria-label="Where is your home?" data-testid="home-place-card">
    <Card size="sm">
      <CardHeader><CardTitle>Where is your home?</CardTitle><CardDescription>Asked once. Weather and sunrise use it. It stays in your home.</CardDescription></CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
        <div><Button onClick={useMyLocation} disabled={busy}>Use my location</Button></div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void find(typed); }}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type your city" aria-label="Your city" />
          <Button type="submit" variant="outline" disabled={busy || !typed.trim()}>Find</Button>
        </form>
        {choices.map((c) => (
          <div key={`${c.name}-${c.lat}-${c.lon}`} className="flex items-center justify-between gap-2">
            <span>{label(c)}?</span>
            <Button size="sm" onClick={() => void save(c)} disabled={busy}>Yes, save it</Button>
          </div>
        ))}
        {note ? <p role="status" className="text-sm">{note}</p> : null}
        </div>
      </CardContent>
    </Card>
    </section>
  );
}
