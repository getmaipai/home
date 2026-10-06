import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetHomeAssistantEventsForTests,
  __setHomeAssistantEventAdaptersForTests,
  __setHomeAssistantReconnectForTests,
  homeAssistantEventsHealth,
  isLanHomeAssistantUrl,
  subscribeHomeAssistantEntities,
  type HomeAssistantState,
} from "@/lib/integrations/homeAssistant";
import { setHouseholdSettingValue } from "@/lib/settings";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const items = this.listeners.get(type) ?? [];
    items.push(listener);
    this.listeners.set(type, items);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close", {}); }
  emit(type: string, event: { data?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

afterEach(() => __resetHomeAssistantEventsForTests());

describe("Home Assistant event subscriptions", () => {
  test("uses only LAN URLs", () => {
    expect(isLanHomeAssistantUrl("http://homeassistant.local:8123")).toBe(true);
    expect(isLanHomeAssistantUrl("http://192.168.1.10:8123")).toBe(true);
    expect(isLanHomeAssistantUrl("https://ha.example.com")).toBe(false);
    expect(isLanHomeAssistantUrl("http://user:pass@homeassistant.local")).toBe(false);
  });

  test("forwards a mapped entity once and filters an unmapped entity", async () => {
    const ws = new FakeSocket();
    const received: string[] = [];
    const initial: HomeAssistantState = { entity_id: "binary_sensor.door", state: "off", attributes: {} };
    __setHomeAssistantEventAdaptersForTests({
      socket: () => ws as never,
      readState: async () => initial,
    });
    setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
    setHouseholdSettingValue("home.access_token", "test-ha-token");
    const unsubscribe = subscribeHomeAssistantEntities("test", ["binary_sensor.door"], (change) => received.push(change.entityId));
    ws.emit("open", {});
    ws.message({ type: "auth_required" });
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "auth", access_token: expect.any(String) });
    ws.message({ type: "auth_ok" });
    expect(JSON.parse(ws.sent[1]!)).toMatchObject({ id: 1, type: "subscribe_events", event_type: "state_changed" });
    ws.message({ type: "result", id: 1, success: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = (entity_id: string, next: string) => ({
      type: "event", event: { event_type: "state_changed", data: {
        entity_id, old_state: { entity_id, state: "off", attributes: {} },
        new_state: { entity_id, state: next, attributes: {} },
      } },
    });
    ws.message(state("binary_sensor.other", "on"));
    ws.message(state("binary_sensor.door", "on"));
    expect(received).toEqual(["binary_sensor.door"]);
    expect(homeAssistantEventsHealth()).toMatchObject({ state: "connected", subscribedEntities: 1 });
    unsubscribe();
  });

  test("reconnects after a dropped socket and re-reads state without replaying it", async () => {
    const sockets: FakeSocket[] = [];
    let reads = 0;
    const received: string[] = [];
    __setHomeAssistantReconnectForTests(5, 5);
    __setHomeAssistantEventAdaptersForTests({
      socket: () => { const ws = new FakeSocket(); sockets.push(ws); return ws as never; },
      readState: async (_settings, entityId) => {
        reads += 1;
        return { entity_id: entityId, state: "on", attributes: {} };
      },
    });
    setHouseholdSettingValue("home.base_url", "http://homeassistant.local:8123");
    setHouseholdSettingValue("home.access_token", "test-ha-token");
    subscribeHomeAssistantEntities("test-reconnect", ["binary_sensor.smoke"], (change) => received.push(change.newState.state));
    const handshake = (ws: FakeSocket) => {
      ws.emit("open", {});
      ws.message({ type: "auth_required" });
      ws.message({ type: "auth_ok" });
      ws.message({ type: "result", id: 1, success: true });
    };
    handshake(sockets[0]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    sockets[0]!.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sockets).toHaveLength(2);
    handshake(sockets[1]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(2);
    expect(received).toEqual([]);
    expect(homeAssistantEventsHealth().state).toBe("connected");
  });
});
