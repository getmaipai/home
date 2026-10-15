export type CheckFixtureState = "green" | "amber" | "red";
export type CheckFixture = { id: string; title: string; state: CheckFixtureState; text: string };
export type TailnetFixture = "not_installed" | "stopped" | "direct" | "relay" | "peer_offline" | "allow_off";
export const CHECK_ROW_IDS = ["engine", "memory", "model-disk", "graphics-driver", "download-host", "hub-disk", "clock", "home-network", "engine-link", "tailnet-allow", "tailnet-peer", "tailnet-route", "tailnet-latency"] as const;

export const TAILNET_STATUS_FIXTURES: Record<Exclude<TailnetFixture, "not_installed" | "stopped" | "allow_off">, string> = {
  direct: JSON.stringify({ BackendState: "Running", Self: { UserID: 1 }, User: { "1": { ID: 1 } }, Peer: { key: { DNSName: "engine.example.com.", HostName: "engine", TailscaleIPs: ["100.64.0.20"], Online: true, CurAddr: "192.0.2.20:41641", Relay: "" } } }),
  relay: JSON.stringify({ BackendState: "Running", Peer: { key: { DNSName: "engine.example.com.", HostName: "engine", TailscaleIPs: ["100.64.0.20"], Online: true, CurAddr: "", Relay: "nyc" } } }),
  peer_offline: JSON.stringify({ BackendState: "Running", Peer: { key: { DNSName: "engine.example.com.", HostName: "engine", TailscaleIPs: ["100.64.0.20"], Online: false } } }),
};

const rows = (state: CheckFixtureState, exception?: string): CheckFixture[] => CHECK_ROW_IDS.map((id) => ({
  id, title: id, state: id === exception ? state : "green", text: id === exception ? (state === "amber" ? "This check needs attention but can continue." : "This check blocks setup.") : "This check passed.",
}));

export const CHECK_FIXTURES: Record<CheckFixtureState, CheckFixture[]> = {
  green: rows("green"),
  amber: rows("amber", "graphics-driver"),
  red: rows("red", "download-host"),
};

export const TAILNET_CHECK_FIXTURES: Record<TailnetFixture, CheckFixture[]> = {
  not_installed: [{ id: "tailnet-peer", title: "Engine computer on Tailscale", state: "amber", text: "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again." }],
  stopped: [{ id: "tailnet-peer", title: "Engine computer on Tailscale", state: "amber", text: "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again." }],
  direct: [{ id: "tailnet-peer", title: "Engine computer on Tailscale", state: "green", text: "The computer running Home's AI is on your Tailscale network." }, { id: "tailnet-route", title: "Tailscale connection", state: "green", text: "Home reaches its AI directly over Tailscale." }],
  relay: [{ id: "tailnet-peer", title: "Engine computer on Tailscale", state: "green", text: "The computer running Home's AI is on your Tailscale network." }, { id: "tailnet-route", title: "Tailscale connection", state: "amber", text: "Home reaches its AI through a Tailscale relay, so answers may be slower. This usually fixes itself; if it doesn't, see Tailscale's help on direct connections." }],
  peer_offline: [{ id: "tailnet-peer", title: "Engine computer on Tailscale", state: "amber", text: "The computer that runs Home's AI isn't on your Tailscale network right now. Open Tailscale on it and sign in with the same account, then press Try again." }],
  allow_off: [{ id: "tailnet-allow", title: "Tailscale access", state: "amber", text: "This computer reaches Home's AI through your Tailscale network. Allow that?" }],
};
