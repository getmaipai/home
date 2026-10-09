// OFFLINE-TEST-01: a bun --preload that denies outbound network use for the
// whole process, loopback allowed. A child hub started with it behaves like
// a house whose internet is cut: every attempt to reach a non-loopback
// destination (fetch, WebSocket, node:net, node:tls, node:http(s), node:dns,
// Bun.connect, Bun.udpSocket) throws, and the destination is appended to the
// file named by MAIPAI_DENY_EGRESS_LOG so the test can compare it with the
// declared endpoint list. It does not touch the machine outside this process.
import { appendFileSync } from "node:fs";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

const LOG = process.env.MAIPAI_DENY_EGRESS_LOG;
const isLoopback = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "::" || /^127\./.test(h) || h.endsWith(".localhost");
};
const deny = (host: string, via: string): never => {
  if (LOG) appendFileSync(LOG, `${host}\t${via}\n`);
  throw new Error(`egress denied by offline test (${via} to ${host})`);
};
const hostOfUrl = (input: unknown): string => {
  const raw = input instanceof Request ? input.url : String(input);
  try { return new URL(raw).hostname; } catch { return raw; }
};

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const host = hostOfUrl(input);
  if (!isLoopback(host)) deny(host, "fetch");
  return realFetch(input, init);
}) as typeof fetch;

const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = new Proxy(RealWebSocket, {
  construct(target, args) {
    const host = hostOfUrl(args[0]);
    if (!isLoopback(host)) deny(host, "websocket");
    return Reflect.construct(target, args);
  },
}) as typeof WebSocket;

const realSocketConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
(net.Socket.prototype as unknown as { connect: (...a: unknown[]) => net.Socket }).connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const opts = first as { host?: string; path?: string };
    if (!opts.path && !isLoopback(opts.host ?? "localhost")) deny(opts.host ?? "", "net.connect");
  } else if (typeof first === "number") {
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    if (!isLoopback(host)) deny(host, "net.connect");
  }
  return realSocketConnect.apply(this, args);
};

const realTlsConnect = tls.connect as (...a: unknown[]) => tls.TLSSocket;
(tls as unknown as { connect: (...a: unknown[]) => tls.TLSSocket }).connect = (...args: unknown[]) => {
  const first = args[0];
  const host = typeof first === "object" && first !== null ? (first as { host?: string }).host ?? "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  if (!isLoopback(host)) deny(host, "tls.connect");
  return realTlsConnect(...args);
};

const realLookup = dns.lookup as (...a: unknown[]) => unknown;
(dns as unknown as { lookup: (...a: unknown[]) => unknown }).lookup = (...args: unknown[]) => {
  const host = String(args[0]);
  if (!isLoopback(host)) {
    const cb = args.at(-1);
    if (LOG) appendFileSync(LOG, `${host}\tdns.lookup\n`);
    if (typeof cb === "function") return void (cb as (e: Error) => void)(Object.assign(new Error(`egress denied by offline test (dns.lookup ${host})`), { code: "ENOTFOUND" }));
    deny(host, "dns.lookup");
  }
  return realLookup(...args);
};
const realResolve = dns.promises.resolve.bind(dns.promises);
(dns.promises as unknown as { resolve: (h: string, ...a: unknown[]) => unknown }).resolve = (host: string, ...rest: unknown[]) => {
  if (!isLoopback(host)) deny(host, "dns.resolve");
  return (realResolve as (...a: unknown[]) => unknown)(host, ...rest);
};
const realPromisesLookup = dns.promises.lookup.bind(dns.promises);
(dns.promises as unknown as { lookup: (h: string, ...a: unknown[]) => unknown }).lookup = (host: string, ...rest: unknown[]) => {
  if (!isLoopback(host)) deny(host, "dns.lookup");
  return (realPromisesLookup as (...a: unknown[]) => unknown)(host, ...rest);
};

const bunAny = Bun as unknown as Record<string, unknown>;
const realBunConnect = (Bun.connect as (...a: unknown[]) => unknown).bind(Bun);
bunAny.connect = (opts: { hostname?: string; unix?: string }, ...rest: unknown[]) => {
  if (!opts.unix && !isLoopback(opts.hostname ?? "localhost")) deny(opts.hostname ?? "", "Bun.connect");
  return realBunConnect(opts, ...rest);
};
const realUdp = (Bun.udpSocket as (...a: unknown[]) => unknown).bind(Bun);
bunAny.udpSocket = (opts: { connect?: { hostname?: string } } = {}) => {
  const host = opts.connect?.hostname;
  if (host && !isLoopback(host)) deny(host, "Bun.udpSocket");
  return realUdp(opts);
};
