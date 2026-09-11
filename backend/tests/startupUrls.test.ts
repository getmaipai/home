import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { addManagedEndpoint, detectLanIps } from "@/lib/hubEndpoints";
import { startupUrls } from "@/lib/startupUrls";

beforeEach(() => resetDb());

describe("startup URLs", () => {
  test("prints direct addresses with the serving scheme and configured vanity URLs", () => {
    addManagedEndpoint("Home", "https://home.example.com");
    const urls = startupUrls(8787, true);
    expect(urls).toContain("https://localhost:8787");
    expect(urls).toContain("https://home.example.com");
    for (const ip of detectLanIps()) expect(urls).toContain(`https://${ip}:8787`);
    expect(startupUrls(9090, false)).toContain("http://localhost:9090");
  });
});
