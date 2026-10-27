import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("profile statistics protocol parity preserves safe DTO, rejects ranges and never caches a group stop", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { spawn } from "node:child_process";
    import { createServer } from "node:http";
    import { createInterface } from "node:readline";
    import { ConvexError } from "convex/values";
    import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";
    import { GET as profiles } from "./apps/web/src/app/api/v0/profiles/[slug]/route.ts";
    import { GET as communities } from "./apps/web/src/app/api/v0/communities/[slug]/route.ts";
    import { GET as people } from "./apps/web/src/app/api/v0/people/[slug]/route.ts";
    const base = { id: "profile", slug: "range", displayName: "Range", profileType: "community", trustLabel: "unclaimed", updatedAt: 200 };
    const telemetry = { schemaVersion: 1, publicationPolicy: "automatic_aggregate", rollupVersion: "v1", freshness: "stale", definitions: {}, groupMemberGrowth: {value:-3,startAt:100,endAt:200}, populationHistory: [{startAt:100,endAt:200,durationMinutes:100/60000,activeInstanceCount:0,peakConcurrency:4,playerHours:0,coverageRatio:0}], populationSeries: {startAt:100,endAt:200,coverageRatio:0,peakConcurrency:0,playerHours:0,buckets:[{startAt:100,endAt:200,observedSpans:[]}]} };
    let stopped=false;
    const calls=[];
    async function query(ref,args){
      calls.push(args);
      if(args.slug === "person" && args.statisticsStartAt !== undefined) throw new ConvexError({code:"STATISTICS_RANGE_INVALID"});
      if(args.slug === "limit") throw new ConvexError({code:"STATISTICS_RANGE_LIMIT"});
      if(args.slug === "missing") return null;
      return stopped ? base : {...base,telemetry};
    }
    globalThis.fetch=async(url,init)=>{
      assert.equal(String(url),"https://fixture.convex.cloud/api/query");
      const body=JSON.parse(init.body);
      try {return Response.json({status:"success",value:await query(body.path,body.args[0])});}
      catch(error){return Response.json({status:"error",errorMessage:"[Request ID: test] Server Error",errorData:error.data},{status:560});}
    };
    const hosted=createVrdexMcpHandler({convex:{query}});
    async function hostedCall(args){const r=await hosted.fetch(new Request("https://app.example.test/mcp",{method:"POST",headers:{accept:"application/json, text/event-stream","content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"vrdex_get_profile",arguments:args}})}));const body=await r.text();return JSON.parse(body.split(/\\r?\\n/).find(l=>l.startsWith("data: "))?.slice(6)??body);}
    const context=slug=>({params:Promise.resolve({slug})});
    const request=(path,suffix="?statisticsStartAt=100&statisticsEndAt=200")=>new Request("https://app.example.test/api/v0/"+path+suffix,{headers:{"x-vercel-forwarded-for":"198.51.100.80"}});
    const rest=await profiles(request("profiles/range"),context("range"));
    assert.equal(rest.status,200);assert.equal(rest.headers.get("cache-control"),"no-store");
    const restAutomatic=await rest.json();
    assert.deepEqual(restAutomatic,{...base,telemetry});
    assert.deepEqual(await (await communities(request("communities/range"),context("range"))).json(),restAutomatic);
    const hostedAutomatic=(await hostedCall({slug:"range",statisticsStartAt:100,statisticsEndAt:200})).result.structuredContent;
    assert.deepEqual(hostedAutomatic,restAutomatic);
    for(const suffix of ["?statisticsStartAt=100","?statisticsStartAt=200&statisticsEndAt=100","?statisticsStartAt=1.5&statisticsEndAt=200","?statisticsStartAt=0&statisticsEndAt=90000000","?statisticsStartAt=0&statisticsEndAt="+(Date.now()+60000),"?statisticsStartAt=100&statisticsStartAt=101&statisticsEndAt=200"]){const r=await profiles(request("profiles/range",suffix),context("range"));assert.equal(r.status,400);assert.equal(r.headers.get("cache-control"),"no-store");}
    for(const [get,slug] of [[people,"person"],[profiles,"person"],[profiles,"limit"]]){const r=await get(request("profiles/"+slug),context(slug));assert.equal(r.status,400);assert.equal(r.headers.get("cache-control"),"no-store");}
    assert.equal((await profiles(request("profiles/missing"),context("missing"))).headers.get("cache-control"),"no-store");
    assert.equal((await profiles(request("profiles/range","?access_token=forbidden"),context("range"))).headers.get("cache-control"),"no-store");
    const server=createServer(async(req,res)=>{try{const r=await profiles(request("profiles/range",new URL(req.url,"http://localhost").search),context("range"));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch(error){res.writeHead(500);res.end(String(error));}});
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address();
    const child=spawn(process.execPath,["--import","tsx","packages/vrdex-mcp/src/stdio.ts"],{env:{...process.env,VRDEX_API_BASE_URL:"http://127.0.0.1:"+address.port,VRDEX_API_TOKEN:"",VRDEX_API_TOKEN_FILE:""},stdio:["pipe","pipe","pipe"]});
    const lines=createInterface({input:child.stdout});
    const pending=new Map();let sequence=0;let stderr="";
    child.stderr.on("data",chunk=>stderr+=chunk);
    lines.on("line",line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);});
    async function send(method,params){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("stdio timeout "+stderr)),10000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\\n");});}
    try {
      await send("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"parity",version:"1"}});
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\\n");
      const args={name:"vrdex_get_profile",arguments:{slug:"range",statisticsStartAt:100,statisticsEndAt:200}};
      const stdio=(await send("tools/call",args)).result;
      assert.deepEqual(stdio.structuredContent,hostedAutomatic);
      for(const bad of [{slug:"range",statisticsStartAt:100},{slug:"range",profileType:"person",statisticsStartAt:100,statisticsEndAt:200}]) {const r=await send("tools/call",{name:args.name,arguments:bad});assert.ok(r.error||r.result.isError);}
      stopped=true;
      assert.equal((await (await profiles(request("profiles/range"),context("range"))).json()).telemetry,undefined);
      assert.equal((await hostedCall(args.arguments)).result.structuredContent.telemetry,undefined);
      assert.equal((await send("tools/call",args)).result.structuredContent.telemetry,undefined);
      assert.ok(calls.filter(c=>c.slug==="range").every(c=>c.statisticsStartAt===100&&c.statisticsEndAt===200));
      assert.doesNotMatch(JSON.stringify(stdio),/worldDistribution|instanceHistory|eventRecaps|providerLocation|targetUser/);
      console.log("protocol parity passed");
    } finally { child.stdin.end();child.kill();lines.close();await new Promise(resolve=>server.close(resolve)); }
  `], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", VRDEX_RATE_LIMIT_STORE: "memory", CONVEX_URL: "https://fixture.convex.cloud" } });
  assert.match(output, /protocol parity passed/);
});
