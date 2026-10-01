export function serviceId(host: string): string {
  const value = host.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return value || "unknown";
}

export function serviceComponent(host: string): string {
  return `service:${serviceId(host)}`;
}
