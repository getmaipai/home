import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { LocationField, type PlaceAdapter } from "@maipai/ui/src/settings/LocationField";
import { api } from "@/lib/api";

const PLACES_KEY = ["entities", "place"];

/** Saved coordinates are kept to two decimals (about 1 km), whatever the search returned. Nothing here logs them. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The kit location field's adapter, wired to the hub's places and entities
 * routes.
 * The browser prompt runs only inside `useCurrent`, which the kit calls
 * from its button; the position it reads is dropped, never sent or stored. */
export function usePlaceAdapter(scope: "household" | "person", options: { enabled?: boolean; incognito?: boolean } = {}): PlaceAdapter {
  const { enabled = true, incognito = false } = options;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PLACES_KEY, queryFn: () => api.entities("place"), enabled });
  const data = query.data;
  return useMemo(() => {
    const rows = (data ?? []).filter((e) => e.kind === "place");
    const names = new Map(rows.map((e) => [e.id, e.name]));
    return {
      labelFor: (id) => names.get(id) ?? "Saved place",
      // Incognito saves nothing and looks nothing up: no search request leaves, no place is stored.
      search: (q) => (incognito ? Promise.resolve([]) : api.searchPlaces(q)),
      add: async (hit) => {
        if (incognito) return null;
        try {
          const created = await api.createEntity({
            kind: "place",
            place_kind: "map",
            name: hit.name,
            scope,
            geo: { lat: round2(hit.lat), lon: round2(hit.lon), precision: "exact", area: hit.area ?? null, from: "search" },
          });
          await queryClient.invalidateQueries({ queryKey: PLACES_KEY });
          return created.id;
        } catch {
          return null;
        }
      },
      rename: async (id, name) => {
        if (incognito) return false;
        try {
          await api.updateEntity(id, { name });
          await queryClient.invalidateQueries({ queryKey: PLACES_KEY });
          return true;
        } catch {
          return false;
        }
      },
      // A person's own saved place is deleted (a tombstone with its clock stamp) when they remove it from their list.
      // The household home is never removed here: only a person-scope place, and the hub refuses the rest.
      remove: async (id) => {
        if (incognito || scope !== "person") return false;
        if (rows.find((e) => e.id === id)?.scope !== "person") return false;
        try {
          await api.deleteEntity(id);
          await queryClient.invalidateQueries({ queryKey: PLACES_KEY });
          return true;
        } catch {
          return false;
        }
      },
      useCurrent: () =>
        new Promise<boolean>((resolve) => {
          if (incognito) return resolve(false);
          if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(false);
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 10000, maximumAge: 600000 },
          );
        }),
      choices: rows.filter((e) => e.scope === "person").map((e) => e.id),
    } satisfies PlaceAdapter;
  }, [scope, data, queryClient, incognito]);
}

/** One `location` row: the kit's LocationField with the hub's place calls. */
export function LocationSetting({ def, value, onChange, disabled }: { def: SettingsKey; value: unknown; onChange: (v: unknown) => Promise<boolean>; disabled?: boolean }) {
  const adapter = usePlaceAdapter(def.scope === "household" ? "household" : "person");
  const range = (def.range ?? {}) as { multiple?: boolean; allow_current?: boolean };
  return (
    <LocationField
      value={value}
      multiple={Boolean(range.multiple)}
      allowCurrent={Boolean(range.allow_current)}
      adapter={adapter}
      onValueChange={(v) => void onChange(v)}
      disabled={disabled}
      ariaLabel={def.label}
    />
  );
}
