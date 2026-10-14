import { assertEquals } from "jsr:@std/assert@1";
import { handleBook } from "./handler.ts";
import manifest from "./manifest.json" with { type: "json" };
Deno.test("book lookup shapes recorded result and empty result without failure", async () => {
 const urls:string[]=[]; const extra={sendRequest:async(req:any)=>{urls.push(req.params.url);return {value:{results:[{title:"The Hobbit",contributors:["J. R. R. Tolkien"],date:"1937",description:"A fantasy novel",id:"https://www.loc.gov/item/123/"}]}}}};
 const result=JSON.parse((await handleBook({query:"The Hobbit",__attribution:manifest.data_sources[0].attribution},extra)).content[0].text).data;
 assertEquals(result.items[0].title,"The Hobbit"); assertEquals(result.items[0].year,"1937"); assertEquals(result.attribution,manifest.data_sources[0].attribution); assertEquals(urls.length,1); assertEquals(new URL(urls[0]).searchParams.get("q"),"The Hobbit");
});
Deno.test("book lookup failure is plain empty data",async()=>{const extra={sendRequest:async()=>{throw new Error("failed")}};const x=JSON.parse((await handleBook({query:"private title"},extra)).content[0].text).data;assertEquals(x.ok,true);assertEquals(x.items,[]);});
