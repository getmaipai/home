import { createLanFetch, type LanFetchDeps } from "@/lib/lanFetch";
import { getHouseholdSettingValue } from "@/lib/settings";

export type HouseLanFetchFailure = {
  ok: false;
  reason: "not_set" | "bad_address" | "no_token";
  message: string;
};

export type HouseLanFetchSuccess = {
  ok: true;
  lanFetch: ReturnType<typeof createLanFetch>;
  token: string;
  host: string;
  port: number;
};

export type HouseLanFetchResult = HouseLanFetchSuccess | HouseLanFetchFailure;

export type HouseLanFetchDeps = {
  read?: (key: string) => unknown;
  fetch?: LanFetchDeps["fetch"];
};

const ADDRESS_MESSAGE = "The Home Assistant address must be the numeric address of your Home Assistant on your home network, for example http://192.168.1.20:8123. Open Settings, House and fix it.";
const TOKEN_MESSAGE = "A Home Assistant access token is needed. Open Settings, House and add it.";

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

export function houseLanFetch(deps: HouseLanFetchDeps = {}): HouseLanFetchResult {
  const read = deps.read ?? getHouseholdSettingValue;
  const baseUrl = read("home.base_url");
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    return { ok: false, reason: "not_set", message: "Set the Home Assistant address in Settings, House before connecting." };
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, reason: "bad_address", message: ADDRESS_MESSAGE };
  }

  if (url.protocol !== "http:" || !isIpv4Literal(url.hostname) || url.username !== "" || url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    return { ok: false, reason: "bad_address", message: ADDRESS_MESSAGE };
  }

  const tokenValue = read("home.access_token");
  const token = typeof tokenValue === "string" ? tokenValue : "";
  if (token.trim() === "") {
    return { ok: false, reason: "no_token", message: TOKEN_MESSAGE };
  }

  // The URL parser drops an explicit :80 (the http default), so check the text before falling back to 8123.
  const explicit80 = url.port === "" && /^[a-z]+:\/\/[^/]+:80\/?$/i.test(baseUrl.trim());
  const port = url.port !== "" ? Number(url.port) : explicit80 ? 80 : 8123;
  try {
    const lanFetch = createLanFetch({ host: url.hostname, port }, deps.fetch === undefined ? {} : { fetch: deps.fetch });
    return { ok: true, lanFetch, token, host: url.hostname, port };
  } catch {
    return { ok: false, reason: "bad_address", message: ADDRESS_MESSAGE };
  }
}
