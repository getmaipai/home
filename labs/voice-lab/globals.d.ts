declare const Bun: {
  env: Record<string, string | undefined>;
  file(path: string): Blob;
  serve(options: {
    hostname: string;
    port: number;
    fetch(request: Request, server: { upgrade(request: Request, options: { data: unknown }): boolean }): Response | Promise<Response | undefined> | undefined;
    websocket: {
      open(socket: ServerWebSocket): void;
      message(socket: ServerWebSocket, message: string | ArrayBuffer | Uint8Array): void;
      close(socket: ServerWebSocket): void;
    };
  }): { port: number };
};
interface ServerWebSocket<T = unknown> { data: T; readyState: number; send(data: string | Uint8Array): void; close(code?: number, reason?: string): void; }
declare module "node:crypto" { export function randomBytes(size: number): { toString(encoding: string): string }; }
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function appendFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare module "node:path" { export function join(...parts: string[]): string; export function extname(path: string): string; export function dirname(path: string): string; }
declare module "node:url" { export function fileURLToPath(url: string | URL): string; }
declare module "bun:test" { export const expect: any; export const test: any; export const describe: any; }
