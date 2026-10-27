import assert from "node:assert/strict";
import { test } from "node:test";
import { VrchatClient, VrchatProviderError } from "./vrchat-client.mjs";
function fixture(status, policy = "request", privacy = "default") {
  const calls = []; let membership = status;
  const client = new VrchatClient({authCookie:"test-cookie",userAgent:"test/1",fetcher:async(url, options)=>{
    const method=options.method ?? "GET"; calls.push(method);
    if(method === "POST") membership = policy === "request" ? "requested" : "member";
    return new Response(JSON.stringify({id:"grp_test",memberCount:1,membershipStatus:membership,joinState:policy,privacy}),{status:200});
  }});
  const options={admissionMode:"explicit",joinPolicy:policy,admissionAt:1,authorizeRequest:async op=>{calls.push(op);return true;},recordInspection:async()=>({accepted:true})};
  return {client,calls,options};
}
for(const [status,policy,writes] of [["inactive","request",1],["requested","request",0],["inactive","invite",0],["invited","invite",1],["member","request",0]]) test(`explicit ${policy} ${status} writes ${writes}`,async()=>{
  const h=fixture(status,policy); await h.client.connectGroup("grp_test",h.options);
  assert.equal(h.calls.filter(x=>x==="POST").length,writes);
  if(writes) assert.equal(h.calls[h.calls.indexOf("POST")-1],policy==="request"?"request_join":"accept_invite");
});
for(const privacy of ["private","unknown"]) test(`explicit rejects ${privacy} metadata`,async()=>{
 const h=fixture("inactive","request",privacy); await h.client.connectGroup("grp_test",h.options); assert.equal(h.calls.includes("POST"),false);
});
test("explicit reservation refusal never writes",async()=>{
 const h=fixture("inactive"); h.options.authorizeRequest=async op=>op==="metadata";
 await h.client.connectGroup("grp_test",h.options); assert.equal(h.calls.includes("POST"),false);
});

test("explicit policy change to free never joins",async()=>{const h=fixture("inactive","open");await h.client.connectGroup("grp_test",{...h.options,joinPolicy:"request"});assert.equal(h.calls.includes("POST"),false);});
test("unreadable membership never becomes absent authority",async()=>{const h=fixture(undefined);await assert.rejects(h.client.connectGroup("grp_test",h.options),/unreadable/);assert.equal(h.calls.includes("POST"),false);});
test("foreign group invitation never authorizes acceptance",async()=>{const h=fixture("invited","invite");await assert.rejects(h.client.connectGroup("grp_other",h.options),/another group/);assert.equal(h.calls.includes("POST"),false);});
test("inspection rejection prevents writes and collection",async()=>{const h=fixture("invited","invite");assert.equal(await h.client.connectGroup("grp_test",{...h.options,recordInspection:async()=>({accepted:false})}),null);assert.equal(h.calls.includes("POST"),false);});
test("revoked grant only inspects",async()=>{const h=fixture("invited","invite");await h.client.connectGroup("grp_test",{...h.options,revoked:true});assert.equal(h.calls.includes("POST"),false);});
test("explicit uncached metadata ignores a previous invitation",async()=>{const h=fixture("invited","invite");h.client.groupCache.set("grp_test",{cachedAt:Date.now(),group:{membershipStatus:"member"}});await h.client.connectGroup("grp_test",h.options);assert.equal(h.calls.filter(x=>x==="POST").length,1);});

import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {RequestBudget,failureDisposition} from "./runtime.mjs";
const source=readFileSync(new URL("./worker.mjs",import.meta.url),"utf8").replaceAll("\r\n","\n");
const collectSource=source.slice(source.indexOf("async function collect(assignment)"),source.indexOf("/**\n * Hands back",source.indexOf("async function collect(assignment)")));
function workerHarness({revoked=false,membership="member",leaveAllowed=true,leaveLost=false}={}) {
 const calls=[];const sandbox={Date,RequestBudget,failureDisposition,stopping:false,integrationBudgets:new Map(),attempts:new Map(),accountBudget:new RequestBudget(100),COLLECTOR_PROTOCOL_VERSION:"test",randomPollDelayMs:()=>60000,pollId:()=>"poll",logEvent:()=>{},collectorAuthRequiredEvent:()=>({}),
 control:{send:async(op,args)=>{calls.push({op,args});if(op==="budget")return {granted:args.automaticRequest!=="leave"||leaveAllowed};return {accepted:true};}},
 provider:{connectGroup:async(_id,options)=>{assert.equal(options.admissionMode,"explicit");await options.authorizeRequest("metadata");await options.recordInspection({membership,visibility:"public",joinPolicy:"request"});return {membership,state:membership==="member"?"active":"awaiting_approval"};},leaveGroup:async()=>{calls.push({op:"leave"});if(leaveLost)throw new VrchatProviderError("lost",{category:"timeout"});},readAggregateSnapshot:async()=>{calls.push({op:"aggregate"});return {observedAt:Date.now(),group:{memberCount:1,groupVisibility:"public",joinPolicy:"request"},instances:[]};}}};
 runInNewContext(`${collectSource};globalThis.collect=collect;`,sandbox);
 return {calls,run:()=>sandbox.collect({integrationId:"integration",vrchatGroupId:"grp_test",fencingToken:2,requestsPerMinute:100,collectionMode:"automatic",state:revoked?"disconnecting":"connecting",statisticsAdmission:{admissionAt:1,joinPolicy:"request",revoked}})};
}
test("manual worker waits for provider membership before aggregates",async()=>{const h=workerHarness({membership:"requested"});await h.run();assert.equal(h.calls.some(c=>c.op==="aggregate"),false);assert.equal(h.calls.find(c=>c.op==="budget").args.statisticsAdmissionAt,1);});
test("manual worker collects confirmed member without management",async()=>{const h=workerHarness();await h.run();assert.ok(h.calls.some(c=>c.op==="ingest"));assert.equal(h.calls.some(c=>c.op.startsWith("club_")),false);});
test("manual cleanup reservation refusal preserves membership",async()=>{const h=workerHarness({revoked:true,leaveAllowed:false});await h.run();assert.equal(h.calls.some(c=>c.op==="leave"),false);});
test("manual cleanup acknowledges only a successful leave",async()=>{const h=workerHarness({revoked:true});await h.run();assert.ok(h.calls.findIndex(c=>c.op==="leave")<h.calls.findIndex(c=>c.op==="admission_cleanup"));});
test("manual cleanup lost leave never reports completion",async()=>{const h=workerHarness({revoked:true,leaveLost:true});await h.run();assert.equal(h.calls.some(c=>c.op==="admission_cleanup"),false);assert.ok(h.calls.some(c=>c.op==="failure"));});
