import type { ConnectorInstance } from "@/lib/connectors/instances";
export const plexInstance = (instance: string, label: string, address = "http://192.168.1.20:32400"): ConnectorInstance => ({ type: "plex", instance, label, address, credentialRef: `plex.${instance}.token`, options: {}, virtual: false });
