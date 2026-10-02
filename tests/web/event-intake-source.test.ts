import assert from "node:assert/strict";
import { it } from "node:test";
import { candidatePatch, posterDeclaration } from "../../apps/web/src/lib/event-intake-source";
import { EventIntakePatchSchema } from "../../packages/api-contracts/src/event-intake";
it("keeps extracted facts tentative and never guesses TBA, date offsets, or identity", () => {
  const patch = candidatePatch({event:{title:"Night",communitySlug:null,eventDate:null,start:"25:00",end:null,startDate:null,endDate:null,timezone:null,venueLabel:null,summary:null,sourceUrl:null},lineup:[{performerLabel:"DJ",personSlug:null,roleLabel:null,start:null,end:null,startDate:null,endDate:null}],evidence:[],questions:[{fieldPath:"timezone",reason:"Choose a zone".repeat(38),alternatives:["Europe/London","America/New_York"]}]});
  assert.equal(patch.title,undefined); assert.equal(patch.tentative?.title,"Night");
  assert.equal(patch.tentative?.start,undefined); assert.equal(patch.tentative?.timeTba,undefined);
  assert.equal(patch.tentative?.lineup?.[0]?.personSlug,undefined);
  assert.match(patch.questions![0]!,/Europe\/London/);
  assert.match(patch.questions![0]!,/America\/New_York/);
  assert.ok(EventIntakePatchSchema.safeParse(patch).success);
});
it("keeps dated lineup times and private source evidence tentative",()=>{
 const candidate={event:{title:"Night",communitySlug:null,eventDate:"2026-10-10",start:"22:00",end:null,startDate:"2026-10-10",endDate:null,timezone:"America/New_York",venueLabel:null,summary:null,sourceUrl:null},
  lineup:[{performerLabel:"DJ",personSlug:null,roleLabel:null,start:"00:30",end:null,startDate:"2026-10-11",endDate:null}],
  evidence:[{fieldPath:"lineup.0.start",origin:"poster" as const,excerpt:"12:30 AM",assessment:"explicit" as const}],questions:[]};
 const patch=candidatePatch(candidate);
 assert.deepEqual(patch.tentative?.lineup?.[0]?.start,{time:"00:30",dayOffset:1});
 assert.deepEqual(patch.evidence,candidate.evidence);
 assert.equal(patch.start,undefined);
 assert.ok(EventIntakePatchSchema.safeParse({...patch,title:"Accepted title"}).success);
});
it("leaves undated and ambiguous times unresolved",()=>{
 const event={title:null,communitySlug:null,eventDate:"2026-11-01",start:null,end:null,startDate:null,endDate:null,timezone:"America/New_York",venueLabel:null,summary:null,sourceUrl:null};
 const row={performerLabel:"DJ",personSlug:null,roleLabel:null,start:"01:30",end:null,startDate:"2026-11-01",endDate:null};
 const ambiguous=candidatePatch({event,lineup:[row],evidence:[],questions:[]});
 assert.equal(ambiguous.tentative?.lineup?.[0]?.start,undefined);
 assert.ok(ambiguous.questions?.some(question=>question.includes("ambiguous_local_time")));
 const undated=candidatePatch({event:{...event,eventDate:null},lineup:[{...row,startDate:null}],evidence:[],questions:[]});
 assert.deepEqual(undated.tentative?.lineup?.[0]?.start,{time:"01:30"});
 assert.equal(undated.tentative?.lineup?.[0]?.start?.dayOffset,undefined);
});
it("keeps an undated midnight lineup clock tentative but requests its date",()=>{
 const event={title:null,communitySlug:null,eventDate:"2026-10-10",start:"22:00",end:null,startDate:null,endDate:null,timezone:"America/New_York",venueLabel:null,summary:null,sourceUrl:null};
 const lineup=[{performerLabel:"DJ",personSlug:null,roleLabel:null,start:"00:30",end:null,startDate:null,endDate:null}];
 const patch=candidatePatch({event,lineup,evidence:[],questions:[]});
 assert.deepEqual(patch.tentative?.lineup?.[0]?.start,{time:"00:30"});
 assert.ok(patch.questions?.some(question=>question==="lineup.0.start: start_date_required"));
});
it("allows bounded poster-only draft input without placeholder event facts", () => {
  const declaration={contentType:"image/png",byteLength:100,sha256:"a".repeat(64)};
  assert.ok(EventIntakePatchSchema.safeParse({posterDeclaration:declaration}).success);
  assert.equal(EventIntakePatchSchema.safeParse({posterDeclaration:{...declaration,byteLength:13*1024*1024}}).success,false);
});


it("rejects oversized and non-image files before reading their bytes", async () => {
  await assert.rejects(posterDeclaration(new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {type:"image/png"})), /INVALID_POSTER/);
  await assert.rejects(posterDeclaration(new File(["text"], "poster.txt", {type:"text/plain"})), /INVALID_POSTER/);
});
