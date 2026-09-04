import { Hono } from "hono";
import { auth } from "@/routes/auth";
import { peopleRoutes } from "@/routes/people";
import type { AppEnv } from "@/types";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", auth);
app.route("/api/people", peopleRoutes);
