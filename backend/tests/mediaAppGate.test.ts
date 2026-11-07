// AUDIT-DUP-ROUTES-01: the media-app gate is mounted once per path prefix. For each media app, every route its router registers
// answers a signed-in person who does not have the app with the same 404 ("no such app"), and a caller who is not signed in with 401.
// The route list comes from the router itself, so a route added without the gate fails here.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { packageStatus } from "@/db/schema";
import { mediaAppRoutes } from "@/routes/mediaApps";
import { MEDIA_APP_REFUSAL } from "@/middleware/mediaAppGate";
import { TestClient } from "./client";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const concrete = (path: string) => path.replace(/:[A-Za-z_]+/g, "x").replace(/\*/g, "x");

describe("the media-app gate", () => {
  for (const { id, routes } of mediaAppRoutes) {
    const registered = routes.routes.filter((route) => route.method !== "ALL").map((route) => ({ method: route.method, path: concrete(route.path) }));
    const unique = [...new Map(registered.map((route) => [`${route.method} ${route.path}`, route])).values()];

    test(`${id}: every route refuses a person without the app with the same 404`, async () => {
      expect(unique.length).toBeGreaterThan(0);
      const { client } = await owner();
      db.insert(packageStatus).values({ packageId: id, status: "disabled", lastSmokeAt: null, smokeOk: false, smokeMessage: "x" }).run();
      const answers: string[] = [];
      for (const route of unique) {
        const response = await client.request(`/api/plugins/${id}${route.path}`, { method: route.method, ...(route.method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) });
        answers.push(`${route.method} ${route.path} ${response.status} ${response.status === 404 ? JSON.stringify(await response.json()) : ""}`);
      }
      expect(answers).toEqual(unique.map((route) => `${route.method} ${route.path} 404 ${JSON.stringify({ error: MEDIA_APP_REFUSAL })}`));
    });

    test(`${id}: a caller who is not signed in gets 401 on every route`, async () => {
      const anonymous = new TestClient();
      for (const route of unique) {
        const response = await anonymous.request(`/api/plugins/${id}${route.path}`, { method: route.method, ...(route.method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) });
        expect({ route: `${route.method} ${route.path}`, status: response.status }).toEqual({ route: `${route.method} ${route.path}`, status: 401 });
      }
    });
  }
});
