import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { LightTile } from "@maipai/ui/src/elements/light-tile";
import { SwitchTile } from "@maipai/ui/src/elements/switch-tile";
import { SceneTile } from "@maipai/ui/src/elements/scene-tile";
import { LockTile } from "@maipai/ui/src/elements/lock-tile";
import { request } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

type HouseEntity = { id: string; name: string; kind: string; on: boolean; brightness: number | null; swatch: string | null; locked?: boolean; unavailable: boolean; sensitive: boolean; canControl: boolean };
type HouseRoom = { id: string; name: string; entities: HouseEntity[] };
type RoomsResponse = { rooms: HouseRoom[]; status?: "not_configured" | "unreachable" };
type ActionResponse = { ok: boolean; undoId?: string };
const queryKey = ["house-rooms"];

export function HousePage() {
  useTabItem("House");
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => request<RoomsResponse>("/api/house/rooms"), refetchInterval: () => document.visibilityState === "visible" ? 5000 : false, refetchIntervalInBackground: false });
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function act(room: HouseRoom, entity: HouseEntity, action: string, value?: number) {
    if (!entity.canControl || entity.unavailable || pending.has(entity.id)) return;
    const prior = client.getQueryData<RoomsResponse>(queryKey);
    const next = new Set(pending); next.add(entity.id); setPending(next);
    setErrors((old) => { const copy = { ...old }; delete copy[room.id]; return copy; });
    if (action === "turn_on" || action === "turn_off") client.setQueryData<RoomsResponse>(queryKey, (data) => data && ({ ...data, rooms: data.rooms.map((r) => ({ ...r, entities: r.entities.map((e) => e.id === entity.id ? { ...e, on: action === "turn_on" } : e) })) }));
    if (action === "set_brightness") client.setQueryData<RoomsResponse>(queryKey, (data) => data && ({ ...data, rooms: data.rooms.map((r) => ({ ...r, entities: r.entities.map((e) => e.id === entity.id ? { ...e, on: true, brightness: value ?? e.brightness } : e) })) }));
    try {
      const result = await request<ActionResponse>("/api/house/act", { method: "POST", body: JSON.stringify({ entity: entity.id, action, ...(value !== undefined ? { value } : {}) }) });
      if (!result.ok) throw new Error("action_failed");
      const refreshed = await client.fetchQuery({ queryKey, queryFn: () => request<RoomsResponse>("/api/house/rooms"), staleTime: 0 });
      const confirmed = refreshed.rooms.flatMap((r) => r.entities).find((item) => item.id === entity.id);
      if (!confirmed || ((action === "turn_on" || action === "turn_off") && confirmed.on !== (action === "turn_on")) || (action === "set_brightness" && confirmed.brightness !== value)) throw new Error("not_confirmed");
    } catch {
      if (prior) client.setQueryData(queryKey, prior);
      setErrors((old) => ({ ...old, [room.id]: `The ${entity.name} did not respond. Try again.` }));
    } finally { setPending((old) => { const copy = new Set(old); copy.delete(entity.id); return copy; }); }
  }
  const body = query.data;
  // AUDIT-UI-01: the route (PageHeaderLayout) draws this page's one h1; a second one here made two.
  return <div className="flex h-full min-w-0 flex-col"><main className="p-4">
    {query.isPending ? <p role="status">Loading rooms…</p> : query.isError ? <p role="status">Home could not load rooms. Try again.</p> : body?.status === "not_configured" ? <EmptyState icon="house" text="Home Assistant is not set up yet. Connect it in Settings to control your lights, locks and scenes here." actionLabel="Open Settings" onAction={() => { window.location.href = "/settings"; }} /> : body?.status === "unreachable" ? <p>Home Assistant did not answer. Check that it is on, then reload.</p> : !body?.rooms.length ? <p>No devices are shared with you yet.</p> : <div className="space-y-6">{body.rooms.map((room) => {
      const active = room.entities.filter((entity) => entity.on).length;
      return <section key={room.id} aria-labelledby={`room-${room.id}`}>
        <header className="mb-3"><h2 id={`room-${room.id}`} className="text-lg font-semibold">{room.name}</h2><p className="text-sm text-muted-foreground">{active} of {room.entities.length} on</p></header>
        <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2 min-[960px]:grid-cols-3">{room.entities.map((entity) => {
          const busy = pending.has(entity.id), unavailable = entity.unavailable || !entity.canControl;
          const toggle = () => void act(room, entity, entity.on ? "turn_off" : "turn_on");
          if (entity.kind === "light") return <LightTile key={entity.id} name={entity.name} room={room.name} on={entity.on} brightness={entity.brightness ?? 100} pending={busy} unavailable={unavailable} swatch={entity.swatch ?? undefined} onToggle={toggle} onBrightness={(v) => void act(room, entity, "set_brightness", v)} />;
          if (entity.kind === "scene") return <div key={entity.id} className="relative">{unavailable ? <div className="absolute inset-0 z-10" /> : null}<SceneTile name={entity.name} room={room.name} onActivate={() => { if (!unavailable) void act(room, entity, "activate"); }} /></div>;
          if (entity.kind === "lock") return <LockTile key={entity.id} name={entity.name} room={room.name} locked={entity.locked ?? !entity.on} pending={busy} unavailable={unavailable} onConfirm={() => void act(room, entity, entity.locked ? "unlock" : "lock")} />;
          return <SwitchTile key={entity.id} name={entity.name} room={room.name} on={entity.on} pending={busy} unavailable={unavailable} onToggle={() => void act(room, entity, entity.kind === "cover" ? entity.on ? "close" : "open" : entity.on ? "turn_off" : "turn_on")} />;
        })}</div>
        {errors[room.id] ? <p role="status" className="mt-2 text-sm text-muted-foreground">{errors[room.id]}</p> : null}
      </section>;
    })}</div>}
  </main></div>;
}
