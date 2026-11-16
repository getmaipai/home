import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { aiChoicesRoutes } from "@/routes/aiChoices";
import { __setComponentsFetchForTests } from "@/lib/stackComponents";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/ai", aiChoicesRoutes);
const now = new Date().toISOString();
function addPerson(id: string, role: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return { token, person: db.select().from(people).where(eq(people.id, id)).get()! };
}
function stackResponse(path: string): Response {
  if (path === "/stack/v1/components") return Response.json({ tier: "test", free_disk_bytes: 1000, disk_margin_bytes: 0, installed_bytes: 0, components: [] });
  if (path.startsWith("/stack/v1/tiers/candidates")) return Response.json({ category: "chat", profile: "test", room_bytes: 0, levels: [] });
  return new Response("not found", { status: 404 });
}

beforeEach(() => { resetDb(); __setRoleHealthForTests({ chat: { availability: "ready", reason: null } }); __setComponentsFetchForTests((async (input) => stackResponse(new URL(String(input), "http://stack").pathname)) as typeof fetch); });
afterEach(() => { resetDb(); __setComponentsFetchForTests(null); __setRoleHealthForTests({}); });

describe("GET /api/ai/overview", () => {
  test("rejects a teen before reading AI state", async () => {
    const { token } = addPerson("person-ai-overview-teen", "teen");
    const response = await app.request("http://localhost/api/ai/overview", { headers: { cookie: `session=${token}` } });
    expect(response.status).toBe(403);
  });


  test("maps current candidates and slots to ready, missing, problem, off, waits and same without counting an unlisted pick", async () => {
    const { token, person } = addPerson("person-ai-overview-states", "owner");
    const models = [
      ["chat-model", "Chat Model", "chat", "installed", 4e9],
      ["minimax-h3-image", "MiniMax H3-Image", "pictures", "notInstalled", 49e9],
      ["video-model", "Video Model", "video", "installed", 8e9],
      ["music-model", "Music Model", "music", "notInstalled", 7e9],
      ["voice-model", "Voice Model", "voice", "installed", 1e9],
    ] as const;
    const componentList = { tier: "fixture", free_disk_bytes: 100e9, disk_margin_bytes: 0, installed_bytes: 13e9, components: models.map(([id,label,group,state,bytes]) => ({ id,label,summary:label,group,kind:"model",state,size_bytes:state==="installed"?bytes:null,download_bytes:state==="installed"?0:bytes,full_bytes:bytes,required_free_bytes:bytes,plan_need:"recommended",requirement:"optional",requirement_reason:null,last_used_at:null,used_by:[],depends_on:[],job:null,percent:null,failure:null,can_install:true,install_block:null,can_uninstall:false,uninstall_block:null })) };
    const makeCandidate = (id: string, label: string, fits=true, refusal: string|null=null) => ({ id,label,family:id,peak_bytes:2e9,verified:true,fits,refusal });
    const setCandidateFetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input), "http://stack");
      if (url.pathname === "/stack/v1/components") return Response.json(componentList);
      if (url.pathname === "/stack/v1/tiers/candidates") {
        const category = url.searchParams.get("category") ?? "chat";
        const model = ({ chat:"chat-model", pictures:"minimax-h3-image", video:"video-model", music:"music-model", voice:"voice-model" } as Record<string,string>)[category]!;
        const levels = ["standard","boost","max"].map((tier) => ({ tier, cap_bytes: 20e9, recommended:model, candidates:[makeCandidate(model, model === "minimax-h3-image" ? "MiniMax H3-Image" : `${category} model`), ...(category === "pictures" && tier === "boost" ? [makeCandidate("problem-model","Problem model",false,"This model needs more memory than this computer has.")] : [])] }));
        return Response.json({ category,profile:"fixture",room_bytes:20e9,levels });
      }
      return new Response("not found", { status:404 });
    }) as unknown as typeof fetch;
    __setComponentsFetchForTests(setCandidateFetch);
    setValue(person,"household","engines.image.tier.boost",{model:"problem-model",options:{}});
    setValue(person,"household","engines.image.tier.max",{model:"off",options:{}});
    setValue(person,"household","engines.music.tier.standard",{model:"music-model",options:{}});
    setValue(person,"household","engines.music.tier.boost",{model:"ernie-image-turbo",options:{}});
    const response = await app.request("http://localhost/api/ai/overview", { headers: { cookie: `session=${token}` } });
    expect(response.status).toBe(200);
    const body = await response.json() as { features:Array<{id:string;levels:Array<{tier:string;state:string;detail:string|null;size_bytes_missing:number|null;action:unknown}>}>; attention:{download_all:{bytes:number;count:number}|null} };
    const level = (feature:string,tier:string) => body.features.find((row)=>row.id===feature)!.levels.find((row)=>row.tier===tier)!;
    expect(level("chat","standard").state).toBe("ready");
    expect(level("chat","reduced").state).toBe("off");
    expect(level("pictures","reduced").state).toBe("waits");
    expect(level("pictures","standard").state).toBe("missing");
    expect(level("pictures","standard").size_bytes_missing).toBe(49e9);
    expect(level("pictures","boost")).toMatchObject({state:"problem",detail:"This model needs more memory than this computer has."});
    expect(level("pictures","max").state).toBe("off");
    expect(level("voice","boost")).toMatchObject({state:"same",word:"Same as Standard"});
    expect(level("music","boost").state).toBe("waits");
    expect(body.attention.download_all).toEqual({bytes:56e9,count:2});
  });

  test("a failed Stack source is skipped and the feature response still completes", async () => {
    const { token } = addPerson("person-ai-overview-owner", "owner");
    __setComponentsFetchForTests((async () => { throw new Error("Stack unavailable"); }) as unknown as typeof fetch);
    const response = await app.request("http://localhost/api/ai/overview", { headers: { cookie: `session=${token}` } });
    expect(response.status).toBe(200);
    const body = await response.json() as { features: Array<{ id: string; levels: Array<{ state: string }> }>; right_now: { engine: string } };
    expect(body.features.map((feature) => feature.id)).toEqual(["chat", "pictures", "videos", "music", "voice"]);
    expect(body.features.every((feature) => feature.levels.length === 4)).toBe(true);
    expect(body.right_now.engine).toBe("ready");
  });
});
