import { detectLanIps, listManagedEndpoints } from "@/lib/hubEndpoints";
import { configuredLanExposure } from "@/lib/networkSettings";

export function startupUrls(port: number, tls: boolean): string[] {
  if (configuredLanExposure() === "loopback") return [`http://localhost:${port}`];
  const networkScheme = tls ? "https" : "http";
  return [...new Set([
    `http://localhost:${port}`,
    ...detectLanIps().map((ip) => `${networkScheme}://${ip}:${port}`),
    ...listManagedEndpoints().filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.url),
  ])];
}
