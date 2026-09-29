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
it("allows bounded poster-only draft input without placeholder event facts", () => {
  const declaration={contentType:"image/png",byteLength:100,sha256:"a".repeat(64)};
  assert.ok(EventIntakePatchSchema.safeParse({posterDeclaration:declaration}).success);
  assert.equal(EventIntakePatchSchema.safeParse({posterDeclaration:{...declaration,byteLength:13*1024*1024}}).success,false);
});


it("rejects oversized and non-image files before reading their bytes", async () => {
  await assert.rejects(posterDeclaration(new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {type:"image/png"})), /INVALID_POSTER/);
  await assert.rejects(posterDeclaration(new File(["text"], "poster.txt", {type:"text/plain"})), /INVALID_POSTER/);
});
