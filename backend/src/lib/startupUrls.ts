import { detectLanIps, listManagedEndpoints } from "@/lib/hubEndpoints";

export function startupUrls(port: number, tls: boolean): string[] {
  const scheme = tls ? "https" : "http";
  return [...new Set([
    `${scheme}://localhost:${port}`,
    ...detectLanIps().map((ip) => `${scheme}://${ip}:${port}`),
    ...listManagedEndpoints().filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.url),
  ])];
}
