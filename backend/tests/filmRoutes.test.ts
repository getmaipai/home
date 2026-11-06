import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { createFilmRun } from "@/lib/films/store";
import { TestClient } from "./client";

beforeEach(()=>resetDb());
describe("film progress routes",()=>{
 test("owner reads progress and another person gets 404 for read and cancel",async()=>{
  const {client,row}=await owner(); const run=createFilmRun(row,{idea:"A crossing",goAhead:false});
  const own=await client.get(`/api/films/${run.id}`); expect(own.status).toBe(200); expect(await own.json()).toMatchObject({id:run.id,state:"planning",plan:null});
  const teenClient=await teen(client); expect((await teenClient.get(`/api/films/${run.id}`)).status).toBe(404); expect((await teenClient.post(`/api/films/${run.id}/cancel`,{})).status).toBe(404);
 });
 test("unknown film ids return 404",async()=>{const client=new TestClient();await client.post("/api/auth/setup",{displayName:"Sage",secret:"correcthorse"});expect((await client.get("/api/films/missing")).status).toBe(404);});
});
