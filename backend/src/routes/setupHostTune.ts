// HOST-TUNE-01: the setup wizard's Mac tuning step. Mounted by routes/setup.ts
// before its `/{step}` catch-all, so it has the same access rule as the folder
// picker (loopback before an owner exists, the owner after, closed once setup
// is done). The work is scripts/studio/host-tune.sh; see lib/hostTune.ts.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter } from "@/lib/openapi";
import { accessRefusal } from "@/routes/setupFolders";
import { HOST_TUNE_IDS, HostTuneItemSchema, changeHostTune, detectHostTune } from "@/lib/hostTune";

export const setupHostTuneRoutes = apiRouter();

const ErrorBody = z.object({ error: z.string() });
const errs = {
  400: { content: { "application/json": { schema: ErrorBody } }, description: "The item is not one Home tunes." },
  401: { content: { "application/json": { schema: ErrorBody } }, description: "Owner sign-in required." },
  403: { content: { "application/json": { schema: ErrorBody } }, description: "Not allowed here." },
  409: { content: { "application/json": { schema: ErrorBody } }, description: "Setup is finished, this is not a Mac, or the change needs an administrator or failed. The text says what to do." },
  500: { content: { "application/json": { schema: ErrorBody } }, description: "The tuning script did not run." },
} as const;

const getRoute = createRoute({
  method: "get", path: "/host-tune", tags: ["Setup"], summary: "What can be tuned on this Mac and where each setting stands",
  responses: { 200: { content: { "application/json": { schema: z.object({ supported: z.boolean(), items: z.array(HostTuneItemSchema) }) } }, description: "supported is false off macOS." }, ...errs },
});
setupHostTuneRoutes.openapi(getRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const result = await detectHostTune();
  return result.ok ? c.json(result.value, 200) : (c.json({ error: result.error }, result.status) as never);
});

const IdBody = z.object({ id: z.enum(HOST_TUNE_IDS) }).strict();
function changeRoute(verb: "apply" | "revert", summary: string) {
  return createRoute({
    method: "post", path: `/host-tune/${verb}`, tags: ["Setup"], summary,
    request: { body: { content: { "application/json": { schema: IdBody } } } },
    responses: { 200: { content: { "application/json": { schema: z.object({ item: HostTuneItemSchema }) } }, description: "The item as it reads now." }, ...errs },
  });
}
for (const [verb, summary] of [["apply", "Make one tuning item the proposed way"], ["revert", "Put one tuning item back"]] as const) {
  setupHostTuneRoutes.openapi(changeRoute(verb, summary), async (c) => {
    const refusal = accessRefusal(c);
    if (refusal) return refusal as never;
    const result = await changeHostTune(verb, c.req.valid("json").id);
    return result.ok ? c.json({ item: result.value }, 200) : (c.json({ error: result.error }, result.status) as never);
  });
}
