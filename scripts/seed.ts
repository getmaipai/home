#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { seedToursDisabledForCapture } from "./screenshotTourSeed";

export interface SeedOptions {
  baseUrl: string;
  dataDir: string;
  secret?: string;
  stackUrl?: string | null;
  searxngUrl?: string | null;
  homePlace?: string | null;
}

export interface SeedResult {
  cookie: string;
  people: { sage: string; marlow: string; nova: string };
}

async function request(baseUrl: string, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
}

async function requireOk(response: Response, label: string): Promise<void> {
  if (!response.ok) throw new Error(`${label}: ${response.status} ${await response.text()}`);
}

export async function seedDemoHousehold(options: SeedOptions): Promise<SeedResult> {
  const secret = options.secret ?? "correcthorsebattery";
  const setup = await request(options.baseUrl, "/api/auth/setup", {
    method: "POST", body: JSON.stringify({ displayName: "Sage", secret }),
  });
  await requireOk(setup, "setup failed");
  const cookie = setup.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("setup response carried no session cookie");

  const settings: [string, unknown][] = [];
  if (options.stackUrl) settings.push(["engines.stack.url", options.stackUrl], ["engines.stack.use_chat", true], ["engines.stack.use_embeddings", true]);
  if (options.searxngUrl) settings.push(["search.searxng_url", options.searxngUrl]);
  for (const [key, value] of settings) {
    await requireOk(await request(options.baseUrl, "/api/settings", {
      method: "PUT", cookie, body: JSON.stringify({ scope: "household", key, value }),
    }), `setting ${key} failed`);
  }

  for (const person of [{ displayName: "Marlow", role: "teen" }, { displayName: "Nova", role: "child" }]) {
    await requireOk(await request(options.baseUrl, "/api/people", { method: "POST", cookie, body: JSON.stringify(person) }), `creating ${person.displayName} failed`);
  }
  const rosterResponse = await request(options.baseUrl, "/api/people", { cookie });
  await requireOk(rosterResponse, "listing people failed");
  const roster = await rosterResponse.json() as { id: string; display_name: string }[];
  const sage = roster.find((person) => person.display_name === "Sage");
  const marlow = roster.find((person) => person.display_name === "Marlow");
  const nova = roster.find((person) => person.display_name === "Nova");
  if (!sage || !marlow || !nova) throw new Error("the seeded roster is missing Sage, Marlow, or Nova");
  const people = { sage: sage.id, marlow: marlow.id, nova: nova.id };

  await requireOk(await request(options.baseUrl, "/api/settings", {
    method: "PUT", cookie, body: JSON.stringify({ scope: "household", key: "home.robots.enabled", value: true }),
  }), "enabling robots for the demo household failed");
  const robotRequest = await request(options.baseUrl, "/api/auth/quick-connect/code", {
    method: "POST", body: JSON.stringify({ label: "Rover", kind: "robot", capabilities: [] }),
  });
  await requireOk(robotRequest, "requesting demo robot pairing failed");
  const pairing = await robotRequest.json() as { code: string; poll_token: string };
  await requireOk(await request(options.baseUrl, "/api/auth/quick-connect/approve", {
    method: "POST", cookie, body: JSON.stringify({ code: pairing.code }),
  }), "approving demo robot pairing failed");
  const robotPoll = await request(options.baseUrl, `/api/auth/quick-connect/poll?poll_token=${encodeURIComponent(pairing.poll_token)}`);
  await requireOk(robotPoll, "pairing demo robot failed");
  const paired = await robotPoll.json() as { status: string; device_token?: string };
  if (paired.status !== "approved" || !paired.device_token) throw new Error("demo robot pairing was not approved");
  const robotsResponse = await request(options.baseUrl, "/api/devices/robots", { cookie });
  await requireOk(robotsResponse, "listing demo robots failed");
  const robots = await robotsResponse.json() as Array<{ id: string; name: string }>;
  const rover = robots.find((device) => device.name === "Rover");
  if (!rover) throw new Error("paired demo robot Rover was not listed");
  const companionsResponse = await request(options.baseUrl, "/api/companions", { cookie });
  await requireOk(companionsResponse, "listing demo companions failed");
  const companionList = await companionsResponse.json() as { default_id?: string };
  if (!companionList.default_id) throw new Error("demo household has no default companion for Rover");
  await requireOk(await request(options.baseUrl, `/api/devices/${encodeURIComponent(rover.id)}`, {
    method: "PATCH", cookie, body: JSON.stringify({ area: "Living room" }),
  }), "setting Rover's room failed");
  for (const [key, value] of [["robot.companion.id", companionList.default_id], ["robot.face.color", "mint"]] as const) {
    await requireOk(await request(options.baseUrl, "/api/settings", {
      method: "PUT", cookie, body: JSON.stringify({ scope: `device:${rover.id}`, key, value }),
    }), `setting Rover's ${key} failed`);
  }

  const db = new Database(join(options.dataDir, "hub.db"));
  try {
    seedToursDisabledForCapture(db, Object.values(people));
  } finally {
    db.close();
  }

  const homePlace = options.homePlace === undefined ? "Seattle, WA" : options.homePlace;
  if (homePlace !== null) {
    const entityResponse = await request(options.baseUrl, "/api/entities", {
      method: "POST", cookie, body: JSON.stringify({ kind: "place", place_kind: "map", name: homePlace, scope: "household", geo: null }),
    });
    await requireOk(entityResponse, "creating household home place failed");
    const entity = await entityResponse.json() as { id: string };
    await requireOk(await request(options.baseUrl, "/api/settings", {
      method: "PUT", cookie, body: JSON.stringify({ scope: "household", key: "household.home", value: entity.id }),
    }), "setting household.home failed");
  }
  return { cookie, people };
}

function parseArgs(args: string[]): SeedOptions {
  const values = new Map<string, string>();
  let noPlace = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--no-place") { noPlace = true; continue; }
    if (!["--base", "--data-dir", "--stack", "--searxng", "--secret"].includes(arg)) throw new Error(`unknown argument: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    values.set(arg, value);
  }
  const baseUrl = values.get("--base");
  const dataDir = values.get("--data-dir");
  if (!baseUrl || !dataDir) throw new Error("usage: bun run scripts/seed.ts --base <url> --data-dir <dir> [--stack <url>] [--searxng <url>] [--secret <s>] [--no-place]");
  return { baseUrl: baseUrl.replace(/\/$/, ""), dataDir, ...(values.has("--secret") ? { secret: values.get("--secret")! } : {}), ...(values.has("--stack") ? { stackUrl: values.get("--stack")! } : {}), ...(values.has("--searxng") ? { searxngUrl: values.get("--searxng")! } : {}), ...(noPlace ? { homePlace: null } : {}) };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await seedDemoHousehold(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
