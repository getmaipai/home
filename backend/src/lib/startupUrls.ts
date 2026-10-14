import { detectLanIps, listManagedEndpoints } from "@/lib/hubEndpoints";

export function startupUrls(port: number, tls: boolean): string[] {
  const networkScheme = tls ? "https" : "http";
  return [...new Set([
    `http://localhost:${port}`,
    ...detectLanIps().map((ip) => `${networkScheme}://${ip}:${port}`),
    ...listManagedEndpoints().filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.url),
  ])];
}
