import { Hono } from "hono";
import { auth } from "@/routes/auth";
import { peopleRoutes } from "@/routes/people";
import { safetyRoutes } from "@/routes/safety";
import { memoryRoutes } from "@/routes/memory";
import { settingsRoutes } from "@/routes/settings";
import type { AppEnv } from "@/types";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", auth);
app.route("/api/people", peopleRoutes);
app.route("/api/safety", safetyRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/api/settings", settingsRoutes);
