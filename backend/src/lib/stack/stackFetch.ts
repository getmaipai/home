// ISOLATION-04: Home's fetch for the Stack. The Stack refuses every POST, PUT, PATCH and DELETE that does not carry its token
// (`x-maipai-home-token`, the same key the adult full view uses; see homeViewToken.ts for where it comes from and how it is cached).
// This is the one place the header is added, so each Stack caller (the spec client, `createStackHttp`) uses it as its default fetch and no
// route has to remember it. Reads carry nothing. A write refused with `home_token_required` or `home_token_refused` was not run, so it is
// sent once more after Home reads the key again; if the Stack still refuses, the Repairs row says what to do and the Stack's own
// sentence goes back to the caller. The key is never logged, never put in an error and never leaves for any host but the Stack.
// These three reach "@/db" (and so the hub database); the spec client is also imported by the bench setup, which must stay clear of the
// database until its own empty-directory check has run. They load on the first write, never on import.
const tokenLib = () => import("@/lib/stack/homeViewToken");
const issuesLib = () => import("@/lib/issues");
const engineLib = () => import("@/lib/stackEngine");

const ISSUE_SOURCE = "stack";
const ISSUE_KEY = "stack.home_token";
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Fixed words: no host, path or key can enter the row. */
export async function homeTokenProblemCopy(): Promise<{ title: string; detail: string }> {
  return (await engineLib()).isRemoteStackSelected()
    ? { title: "Home cannot start or change anything on the engine computer until it has the engine's key.", detail: "The engine computer refuses requests that do not carry its key. An admin copies the key from that computer into Home once, then tries again." }
    : { title: "Home cannot start or change anything on the engine until their keys match.", detail: "The engine did not accept Home's key. Restart the engine from Repairs, then try again; if this stays, restart Home." };
}
// Once per run after the last refusal: a row left open by an earlier run (Home was restarted, which is what the row advises) closes too.
let problemOpen = false;
let worksChecked = false;
async function reportProblem(): Promise<void> {
  worksChecked = false;
  if (problemOpen) return;
  problemOpen = true;
  await Promise.all([homeTokenProblemCopy(), issuesLib()]).then(([copy, { raiseIssue }]) => raiseIssue({ source: ISSUE_SOURCE, key: ISSUE_KEY, severity: "error", title: copy.title, detail: copy.detail, notifyOnEscalation: false, suppressNotification: true })).catch(() => undefined);
}
async function reportWorks(): Promise<void> {
  if (worksChecked) return;
  worksChecked = true;
  problemOpen = false;
  await issuesLib().then(({ resolveIssue }) => resolveIssue(ISSUE_SOURCE, ISSUE_KEY, { suppressNotification: true })).catch(() => undefined); // the row stays until the next success
}
export function __resetStackFetchForTests(): void { problemOpen = false; worksChecked = false; }

async function isTokenRefusal(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try { const code = (await res.clone().json() as { code?: unknown }).code; return code === "home_token_required" || code === "home_token_refused"; } catch { return false; }
}

const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const methodOf = (input: Parameters<typeof fetch>[0], init?: RequestInit): string => (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

/** `fetch` for a Stack call: a write carries Home's token. */
export const stackFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  if (READS.has(methodOf(input, init))) return globalThis.fetch(input, init);
  const origin = new URL(urlOf(input)).origin;
  // A Stack that has not made its key file yet is asked once (a refused full-view ask is how an older Stack makes it).
  const { HOME_TOKEN_HEADER, PRIMING_TOKEN, VIEW_HEADER, forgetHomeViewToken, homeViewToken } = await tokenLib();
  const prime = async () => { await globalThis.fetch(`${origin}/stack/v1/health`, { method: "GET", headers: { [VIEW_HEADER]: "full", [HOME_TOKEN_HEADER]: PRIMING_TOKEN }, signal: AbortSignal.timeout(5_000) }).then((r) => r.arrayBuffer()).catch(() => undefined); };
  const send = async (): Promise<Response> => {
    const token = await homeViewToken(prime);
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    if (token) headers.set(HOME_TOKEN_HEADER, token);
    return globalThis.fetch(input, { ...init, headers });
  };
  // A request whose body is a one-shot stream cannot be sent twice; it gets one try and the Stack's sentence.
  const body = init?.body;
  const canRetry = !(body && typeof body === "object" && "getReader" in body);
  let res = await send();
  if (await isTokenRefusal(res)) {
    if (canRetry) {
      forgetHomeViewToken();
      await res.body?.cancel().catch(() => undefined);
      res = await send();
    }
    if (await isTokenRefusal(res)) await reportProblem();
    return res;
  }
  if (res.status < 500) await reportWorks();
  return res;
}) as typeof fetch;
