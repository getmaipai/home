import { app } from "@/app";

// A tiny cookie-jar wrapper around Hono's app.request so tests read like
// an HTTP client instead of hand-threading Set-Cookie headers.
export class TestClient {
  private cookie: string | null = null;

  async request(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers["cookie"] = this.cookie;

    const res = await app.request(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    return res;
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request(path, { method: "GET", headers });
  }

  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request(path, { method: "POST", body: body ?? {}, headers });
  }

  clearCookie(): void {
    this.cookie = null;
  }
}
