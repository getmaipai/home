// HA-EVENTS-01: one LAN-only Home Assistant websocket shared by mapped
// entity subscribers. The socket carries only state_changed events; entity
// filtering happens here before any subscriber sees an event.
import { getHouseholdSettingValue } from "@/lib/settings";
import { raiseIssue, resolveIssue } from "@/lib/issues";

export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantChange {
  entityId: string;
  oldState: HomeAssistantState | null;
  newState: HomeAssistantState;
  at: string;
}

export interface HomeAssistantEventsHealth {
  state: "disabled" | "connecting" | "connected" | "reconnecting";
  subscribedEntities: number;
  lastConnectedAt: string | null;
  lastError: string | null;
}

type SocketLike = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener">;
type Subscriber = { entities: Set<string>; callback: (change: HomeAssistantChange) => void };
type Settings = { baseUrl: string; accessToken: string };
type Adapters = {
  socket: (url: string) => SocketLike;
  readState: (settings: Settings, entityId: string) => Promise<HomeAssistantState | null>;
};

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
let backoffMinMs = BACKOFF_MIN_MS;
let backoffMaxMs = BACKOFF_MAX_MS;
const subscribers = new Map<string, Subscriber>();
let socket: SocketLike | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let socketSequence = 0;
let health: HomeAssistantEventsHealth = {
  state: "disabled", subscribedEntities: 0, lastConnectedAt: null, lastError: null,
};
let adapters: Adapters = {
  socket: (url) => new WebSocket(url),
  readState: async (settings, entityId) => {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/api/states/${encodeURIComponent(entityId)}`, {
      headers: { authorization: `Bearer ${settings.accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return validState(value) ? value : null;
  },
};
const lastStates = new Map<string, HomeAssistantState>();

function validState(value: unknown): value is HomeAssistantState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.entity_id === "string" && typeof state.state === "string" &&
    !!state.attributes && typeof state.attributes === "object" && !Array.isArray(state.attributes);
}

function settings(): Settings | null {
  const baseUrl = getHouseholdSettingValue("home.base_url");
  const accessToken = getHouseholdSettingValue("home.access_token");
  if (typeof baseUrl !== "string" || typeof accessToken !== "string" || !baseUrl || !accessToken) {
    publishHealth({ ...health, state: "disabled", lastError: null });
    resolveIssue("home-assistant-events", "connection");
    return null;
  }
  if (!isLanHomeAssistantUrl(baseUrl)) {
    health = { ...health, state: "reconnecting", lastError: "Home Assistant URL must point to a LAN address" };
    void setHealthIssue("Home Assistant URL must point to a LAN address");
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), accessToken };
}

function ipv4Lan(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

export function isLanHomeAssistantUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "homeassistant" || host.endsWith(".local") || host.endsWith(".lan")) return true;
    if (ipv4Lan(host)) return true;
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  } catch {
    return false;
  }
}

function websocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/websocket`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function desiredEntities(): Set<string> {
  return new Set([...subscribers.values()].flatMap((subscriber) => [...subscriber.entities]));
}

function publishHealth(next: HomeAssistantEventsHealth): void {
  health = { ...next, subscribedEntities: desiredEntities().size };
}

async function setHealthIssue(detail: string): Promise<void> {
  await raiseIssue({ source: "home-assistant-events", key: "connection", severity: "warning",
    title: "Home Assistant sensor updates are unavailable", detail });
}

function connected(sequence: number, ws: SocketLike): void {
  if (sequence !== socketSequence || socket !== ws) return;
  reconnectAttempt = 0;
  const connectedAt = new Date().toISOString();
  publishHealth({ state: "connected", subscribedEntities: desiredEntities().size, lastConnectedAt: connectedAt, lastError: null });
  resolveIssue("home-assistant-events", "connection");
  const config = settings();
  if (!config) return;
  // Re-read each current value after every connection. These reads seed the
  // baseline and are deliberately not delivered as changes to subscribers.
  void Promise.all([...desiredEntities()].map(async (entityId) => {
    try {
      const current = await adapters.readState(config, entityId);
      if (current) lastStates.set(entityId, current);
    } catch (error) {
      health = { ...health, lastError: error instanceof Error ? error.message : String(error) };
    }
  }));
}

function scheduleReconnect(sequence: number, error: unknown): void {
  if (sequence !== socketSequence || subscribers.size === 0) return;
  socket = null;
  const message = error instanceof Error ? error.message : String(error ?? "socket closed");
  reconnectAttempt += 1;
  const delay = Math.min(backoffMaxMs, backoffMinMs * 2 ** Math.min(reconnectAttempt - 1, 5));
  publishHealth({ ...health, state: "reconnecting", lastError: message });
  if (reconnectAttempt >= 3) void setHealthIssue(message);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(), delay);
}

function handleStateChanged(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== "event" || !envelope.event || typeof envelope.event !== "object") return;
  const event = envelope.event as Record<string, unknown>;
  if (event.event_type !== "state_changed" || !event.data || typeof event.data !== "object") return;
  const data = event.data as Record<string, unknown>;
  if (typeof data.entity_id !== "string" || !desiredEntities().has(data.entity_id) || !validState(data.new_state)) return;
  const newState = data.new_state;
  const oldState = validState(data.old_state) ? data.old_state : null;
  lastStates.set(data.entity_id, newState);
  const change: HomeAssistantChange = { entityId: data.entity_id, oldState, newState, at: new Date().toISOString() };
  for (const subscriber of subscribers.values()) {
    if (!subscriber.entities.has(data.entity_id)) continue;
    try { subscriber.callback(change); } catch (error) { console.error(`[home-assistant] subscriber failed: ${String(error)}`); }
  }
}

function connect(): void {
  if (subscribers.size === 0) {
    publishHealth({ ...health, state: "disabled", subscribedEntities: 0 });
    return;
  }
  const config = settings();
  if (!config) {
    publishHealth({ ...health, state: "reconnecting" });
    return;
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = undefined; }
  const sequence = ++socketSequence;
  publishHealth({ ...health, state: reconnectAttempt ? "reconnecting" : "connecting" });
  let ws: SocketLike;
  try { ws = adapters.socket(websocketUrl(config.baseUrl)); }
  catch (error) { scheduleReconnect(sequence, error); return; }
  socket = ws;
  let authSent = false;
  let subscribeSent = false;
  ws.addEventListener("open", () => {
    if (sequence !== socketSequence) return;
    publishHealth({ ...health, state: "connecting" });
  });
  ws.addEventListener("message", (event) => {
    if (sequence !== socketSequence || typeof event.data !== "string") return;
    let message: unknown;
    try { message = JSON.parse(event.data) as unknown; } catch { return; }
    if (!message || typeof message !== "object") return;
    const frame = message as Record<string, unknown>;
    if (frame.type === "auth_required" && !authSent) {
      authSent = true;
      ws.send(JSON.stringify({ type: "auth", access_token: config.accessToken }));
    } else if (frame.type === "auth_ok" && !subscribeSent) {
      subscribeSent = true;
      ws.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
    } else if (frame.type === "result" && frame.id === 1 && frame.success === true) {
      connected(sequence, ws);
    } else if (frame.type === "auth_invalid") {
      scheduleReconnect(sequence, new Error("Home Assistant rejected the access token"));
      ws.close();
    } else if (frame.type === "result" && frame.id === 1 && frame.success === false) {
      scheduleReconnect(sequence, new Error("Home Assistant refused the state_changed subscription"));
      ws.close();
    } else handleStateChanged(message);
  });
  ws.addEventListener("close", () => { if (socket === ws) scheduleReconnect(sequence, new Error("Home Assistant websocket closed")); });
  ws.addEventListener("error", () => { if (socket === ws) scheduleReconnect(sequence, new Error("Home Assistant websocket error")); });
}

/** Register a module/package consumer. Only these entity ids can reach its callback. */
export function subscribeHomeAssistantEntities(owner: string, entityIds: readonly string[], callback: (change: HomeAssistantChange) => void): () => void {
  const entities = new Set(entityIds.filter((id) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id)));
  if (!owner) return () => {};
  subscribers.delete(owner);
  if (entities.size === 0) {
    publishHealth({ ...health, subscribedEntities: desiredEntities().size });
    if (subscribers.size === 0) {
      ++socketSequence;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      socket?.close();
      socket = null;
      publishHealth({ ...health, state: "disabled", subscribedEntities: 0 });
    }
    return () => {};
  }
  subscribers.set(owner, { entities, callback });
  publishHealth({ ...health, subscribedEntities: desiredEntities().size });
  if (!socket && !reconnectTimer) connect();
  return () => {
    subscribers.delete(owner);
    publishHealth({ ...health, subscribedEntities: desiredEntities().size });
    if (subscribers.size === 0) {
      ++socketSequence;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      socket?.close();
      socket = null;
      publishHealth({ ...health, state: "disabled", subscribedEntities: 0 });
    }
  };
}

export function homeAssistantEventsHealth(): HomeAssistantEventsHealth { return { ...health, subscribedEntities: desiredEntities().size }; }

/** Explicit baseline read for a new subscriber or an alarm sensor restore. */
export async function readHomeAssistantEntityState(entityId: string): Promise<HomeAssistantState | null> {
  if (!desiredEntities().has(entityId)) return null;
  const config = settings();
  if (!config) return null;
  const state = await adapters.readState(config, entityId);
  if (state) lastStates.set(entityId, state);
  return state;
}

/** Re-evaluate URL/token changes after a household settings write. */
export function refreshHomeAssistantEvents(): void {
  if (subscribers.size === 0) return;
  ++socketSequence;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  socket?.close();
  socket = null;
  reconnectAttempt = 0;
  backoffMinMs = BACKOFF_MIN_MS;
  backoffMaxMs = BACKOFF_MAX_MS;
  connect();
}

export function __resetHomeAssistantEventsForTests(): void {
  ++socketSequence;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  socket?.close();
  socket = null;
  subscribers.clear();
  lastStates.clear();
  reconnectAttempt = 0;
  backoffMinMs = BACKOFF_MIN_MS;
  backoffMaxMs = BACKOFF_MAX_MS;
  health = { state: "disabled", subscribedEntities: 0, lastConnectedAt: null, lastError: null };
  adapters = { socket: (url) => new WebSocket(url), readState: async () => null };
}

export function __setHomeAssistantEventAdaptersForTests(next: Partial<Adapters>): void { adapters = { ...adapters, ...next }; }
export function __setHomeAssistantReconnectForTests(minMs: number, maxMs: number): void {
  backoffMinMs = minMs;
  backoffMaxMs = maxMs;
}
