import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryRouter } from "react-router-dom";
import { AiGlance } from "@/apps/settings/AiGlance";
import { makePerson, REGISTRY } from "@/shell/pages/settings/settingsTestKit";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });
const ready = { tier:"standard",state:"ready",word:"Ready",model_label:"Qwen",size_bytes_missing:null,detail:null,action:null };
const feature = { id:"chat",name:"Chat",used_by:["chat"],levels:[{tier:"reduced",state:"off",word:"Off",model_label:null,size_bytes_missing:null,detail:null,action:null},ready,{tier:"boost",state:"same",word:"Same as Standard",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"max",state:"same",word:"Same as Standard",model_label:null,size_bytes_missing:null,detail:null,action:null}],ready_count:1,level_count:4 };
type Fixture = { features: typeof feature[]; helpers: Array<{id:string;name:string;model_label:string|null;used_by:string[];state:"ready"|"missing"|"problem"|"off"|"waits"|"same";action:unknown}>; attention:{items:Array<{id:string;kind:"problem"|"missing";title:string;line:string;action:unknown}>;download_all:{bytes:number;count:number}|null};right_now:{engine:"ready"|"problem";waiting:number;memory_free_bytes:number;disk_free_bytes:number;models_bytes:number} };
const base: Fixture = { features:[feature],helpers:[],attention:{items:[],download_all:null},right_now:{engine:"ready",waiting:0,memory_free_bytes:100,disk_free_bytes:100,models_bytes:0} };
function render(data: Fixture) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path=(typeof input==="string"?input:input.toString()).split("?")[0]!;
    if(path==="/api/ai/overview") return Promise.resolve(Response.json(data));
    if(path==="/api/ai/choices") return Promise.resolve(Response.json({cards:[{id:"chat",choices:[{id:"chat.standard",action:"use",label:"Qwen",name:"Qwen"}]}]}));
    if((typeof input==="string"?input:input.toString()).startsWith("/api/settings?scope=")) return Promise.resolve(Response.json(REGISTRY.filter((key)=>key.scope==="household").map((key)=>({key:key.key,value:key.default??null,source:"default",label:key.label,help:key.help,level:key.level,secret:false}))));
    if(path==="/api/settings/registry") return Promise.resolve(Response.json(REGISTRY));
    if(path==="/api/settings") return Promise.resolve(Response.json([]));
    if(path==="/api/settings/registry") return Promise.resolve(Response.json(REGISTRY));
    if(path.startsWith("/api/ai/tiers/")) return Promise.resolve(Response.json({profile:"test",room_bytes:0,levels:[]}));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
  return renderWithQueryClient(<MemoryRouter><AiGlance person={makePerson("owner")} onPersonChange={()=>undefined}/></MemoryRouter>);
}

describe("AI Features overview",()=>{
  test("shows the empty attention state and the ready feature levels",async()=>{
    const view=render(base);
    expect(await view.findByText("Qwen")).toBeTruthy();
    expect(await view.findByText("Qwen")).toBeTruthy();
    expect(view.getByText("Ready")).toBeTruthy();
  });
  test("renders the five feature cards inline without attention or download-all",async()=>{
    const rows=["Chat","Pictures","Videos","Music","Voice","Coding"].map((name)=>({...feature,id:name.toLowerCase(),name,levels:[{...ready,tier:"reduced"},{...ready,tier:"standard"},{...ready,tier:"boost"},{...ready,tier:"max"}]}));
    const view=render({...base,features:rows as typeof feature[]});
    expect(await view.findAllByTestId("ai-feature-card")).toHaveLength(6);
    expect(view.getAllByTestId("ai-level-grid")).toHaveLength(6);
    expect(view.queryByText("Needs attention")).toBeNull();
    expect(view.queryByText("Download all that is missing")).toBeNull();
  });
  test("has the feature level picker and feature switch controls in the inline card",async()=>{
    const view=render({...base,features:[{...feature,levels:[{...ready,tier:"reduced",state:"unset"},{...ready,tier:"standard"},{...ready,tier:"boost"},{...ready,tier:"max"}]}]});
    expect(await view.findByRole("button",{name:"Details"})).toBeTruthy();
    expect(view.getByRole("switch",{name:"Chat"})).toBeTruthy();
    expect(view.queryByText("Needs attention")).toBeNull();
  });
  test("writes a level model through the existing slot setting",async()=>{
    const puts:string[]=[];
    globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{const url=typeof input==="string"?input:input.toString();if(url==="/api/settings"&&init?.method==="PUT"){puts.push(String(init.body));return Promise.resolve(Response.json({ok:true}));}if(url==="/api/ai/overview")return Promise.resolve(Response.json(base));if(url.startsWith("/api/settings?scope="))return Promise.resolve(Response.json(REGISTRY.filter(key=>key.scope==="household").map(key=>({key:key.key,value:key.default??null,source:"default",label:key.label,help:key.help,level:key.level,secret:false}))));return Promise.resolve(Response.json({}));}) as typeof fetch;
    const view=render(base);
    await view.findByRole("button",{name:"Details"});
    const select=view.getByRole("combobox",{name:"Standard model"});
    fireEvent.click(select);
    fireEvent.click(await view.findByRole("option",{name:"Muse Glimmer"}));
    await waitFor(()=>expect(puts.some(put=>put.includes("engines.chat.tier.standard"))).toBe(true));
  });
  test("shows an attention item and a missing chip",async()=>{
    const missing={...feature,id:"pictures",name:"Pictures",ready_count:0,levels:[{tier:"reduced",state:"waits",word:"Waits for Standard",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"standard",state:"missing",word:"Missing",model_label:"MiniMax H3-Image",size_bytes_missing:49e9,detail:null,action:{kind:"download",label:"Download",job:"pictures",level:"standard"}},{tier:"boost",state:"off",word:"Off",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"max",state:"waits",word:"Waits",model_label:null,size_bytes_missing:null,detail:null,action:null}]} as unknown as typeof feature;
    const view=render(({...base,features:[missing],attention:{items:[{id:"p",kind:"missing",title:"Pictures Standard",line:"This level needs a download.",action:null}],download_all:{bytes:49e9,count:1}}} as unknown as Fixture));
    expect(await view.findByText("This level needs a download.")).toBeTruthy();
    expect(view.getByText("Missing")).toBeTruthy();
    expect(view.getByText("MiniMax H3-Image")).toBeTruthy();
  });
  test("renders each feature in its own card with responsive level cells and helper words",async()=>{
    const view=render({...base,features:[feature,{...feature,id:"pictures",name:"Pictures"}],helpers:[{id:"listening",name:"Listening",model_label:"Whisper",used_by:["chat"],state:"ready",action:null}]} as Fixture);
    expect(await view.findByText("Chat")).toBeTruthy();
    expect(view.getAllByTestId("ai-feature-card")).toHaveLength(2);
    expect(view.getAllByTestId("ai-level-grid")[0]!.className).toContain("grid-cols-2");
    expect(view.getAllByTestId("ai-level-grid")[0]!.className).toContain("sm:grid-cols-4");
    expect(view.getByText("On")).toBeTruthy();
  });
  test("shows feature switches and omits old overview cards",async()=>{
    const view=render(base);
    expect(view.queryByText("Chat pause")).toBeNull();
    expect(view.queryByText("View engine settings")).toBeNull();
    expect(view.getByRole("switch",{name:"Chat"})).toBeTruthy();
  });
  test("renders a Details control for a feature",async()=>{
    const view=render(base);
    expect(await view.findByRole("button",{name:"Details"})).toBeTruthy();
  });
  test("keeps picture reduced and voice advanced tiers out of configuration",async()=>{
    const pictures={...feature,id:"pictures",name:"Pictures",used_by:["the Pictures app"],levels:[{tier:"reduced",state:"waits",word:"Waits for Standard",model_label:null,size_bytes_missing:null,detail:null,action:null},{...ready,tier:"standard"},{tier:"boost",state:"off",word:"Off",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"max",state:"waits",word:"Waits",model_label:null,size_bytes_missing:null,detail:null,action:null}],ready_count:1,level_count:4} as unknown as typeof feature;
    const view=render({...base,features:[pictures]} as Fixture);
    expect(await view.findByRole("button",{name:"Details"})).toBeTruthy();
    expect(view.getByText("Reduced")).toBeTruthy();
  });
  test("has no technical identifiers in the feature page",async()=>{
    const view=render(base);
    await view.findByRole("button",{name:"Details"});
    expect(view.container.textContent).not.toContain("engines.chat");
  });
});
