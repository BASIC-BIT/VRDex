import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";
import assert from "node:assert/strict";
import { it } from "node:test";
import { extractEventIntake, type EventIntakeAgentDependencies } from "../../packages/event-intake-agent/src/index";
import type { EventIntakeCandidate } from "../../packages/api-contracts/src/event-intake";

const candidate = (labels: string[]): EventIntakeCandidate => ({
  event: { title: "Rehearsal", communitySlug: null, eventDate: "2026-11-06", start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null },
  lineup: labels.map(performerLabel => ({ performerLabel, personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null })),
  evidence: [], questions: [], decision: { kind: "new" },
});
const extract = (labels: string[], search_people: EventIntakeAgentDependencies["search_people"]) => extractEventIntake({ draftId: "draft", sourceText: labels.join("\n") }, {
  authorize: async () => ({ actorUserId: "actor", version: 1 }), search_people, search_communities: async () => [], enabled: true, apiKey: "test", model: "fixture",
  fetchImplementation: async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(candidate(labels)) }] }] })),
});

it("looks up an exact lineup identity even when the model finalizes without tool calls", async () => {
  const result = await extract(["G-Catz"], async () => [{ slug: "g-catz", displayName: "G-Catz" }]);
  assert.equal(result.lineup[0]?.personSlug, "g-catz");
  assert.ok(result.evidence.some(row => row.fieldPath === "lineup.0.personSlug" && row.origin === "lookup" && row.assessment === "inferred"));
});
it("offers a one-edit alias candidate for Nyakumma without silently linking it", async () => {
  const result = await extract(["Nyakumma"], async query => query === "nyak" ? [{ slug: "nyakuma", displayName: "Akuma" }] : []);
  assert.equal(result.lineup[0]?.performerLabel, "Nyakumma");
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.ok(result.questions.some(q => q.fieldPath === "lineup.0.personSlug" && q.alternatives.includes("nyakuma")));
  assert.ok(candidatePatch(result).questions?.some(question => question.includes("nyakuma")));
});
it("leaves a fake name unlinked with an unresolved identity question", async () => {
  const result = await extract(["ZZZ Intake Phantom 9F31"], async () => []);
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.ok(result.questions.some(q => q.fieldPath === "lineup.0.personSlug" && q.reason === "unresolved_identity" && q.alternatives.length === 0));
});
it("requires review when multiple public identities share an exact display name", async () => {
  const result = await extract(["Twin"], async () => [{ slug: "twin-a", displayName: "Twin" }, { slug: "twin-b", displayName: "Twin" }]);
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.deepEqual(result.questions.find(q => q.fieldPath === "lineup.0.personSlug")?.alternatives, ["twin-a", "twin-b"]);
});
it("preserves ambiguity between equally close typo candidates", async () => {
  const result = await extract(["Nyakumma"], async query => query === "nyak" ? [{ slug: "nyakuma", displayName: "Akuma" }, { slug: "nyakummo", displayName: "Other" }] : []);
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.deepEqual(result.questions.find(q => q.fieldPath === "lineup.0.personSlug")?.alternatives, ["nyakuma", "nyakummo"]);
});
it("does not turn a broad prefix hit into an identity suggestion", async () => {
  const result = await extract(["Nyakumma"], async () => [{ slug: "nyak-records", displayName: "Nyak Records" }]);
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.deepEqual(result.questions.find(q => q.fieldPath === "lineup.0.personSlug")?.alternatives, []);
});
it("preserves the event and unresolved label if public lookup fails", async () => {
  const result = await extract(["G-Catz"], async () => { throw new Error("provider unavailable"); });
  assert.equal(result.event.title, "Rehearsal");
  assert.equal(result.lineup[0]?.performerLabel, "G-Catz");
  assert.ok(result.questions.some(q => q.fieldPath === "lineup.0.personSlug" && q.reason === "identity_lookup_unavailable"));
});
it("bounds mandatory lookup work and marks remaining labels for review", async () => {
  let calls = 0;
  const result = await extract(Array.from({ length: 20 }, (_, i) => `Missing DJ ${i}`), async () => { calls++; return []; });
  assert.ok(calls <= 16);
  assert.equal(result.lineup.length, 20);
  assert.ok(result.questions.some(q => q.fieldPath === "lineup.19.personSlug" && q.reason === "identity_lookup_limit"));
});

it("deduplicates repeated normalized performer labels", async () => {
  let calls = 0;
  const result = await extract(["G-Catz", "g catz"], async () => { calls++; return [{ slug: "g-catz", displayName: "G-Catz" }]; });
  assert.deepEqual(result.lineup.map(row => row.personSlug), ["g-catz", "g-catz"]);
  assert.equal(calls, 1);
});
it("does not let a stalled public lookup stall extraction", { timeout: 8000 }, async () => {
  const result = await extract(["G-Catz"], async () => new Promise(() => {}));
  assert.equal(result.event.title, "Rehearsal");
  assert.ok(result.questions.some(q => q.reason === "identity_lookup_unavailable"));
});

it("preserves an alias link already grounded by the model's public lookup", async () => {
  const value = candidate(["Nyakuma"]);
  value.lineup[0]!.personSlug = "akuma-person";
  let turn = 0;
  const result = await extractEventIntake({ draftId: "draft", sourceText: "Nyakuma" }, {
    authorize: async () => ({ actorUserId: "actor", version: 1 }),
    search_people: async () => [{ slug: "akuma-person", displayName: "Akuma" }], search_communities: async () => [], enabled: true, apiKey: "test", model: "fixture",
    fetchImplementation: async () => new Response(JSON.stringify({ status: "completed", output: ++turn === 1
      ? [{ type: "function_call", name: "search_people", call_id: "alias", arguments: JSON.stringify({ query: "Nyakuma", limit: 5 }) }]
      : [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })),
  });
  assert.equal(result.lineup[0]?.personSlug, "akuma-person");
});
it("does not claim to correct typos within the retrieval prefix", async () => {
  const result = await extract(["Nxakuma"], async query => query === "nyak" ? [{ slug: "nyakuma", displayName: "Akuma" }] : []);
  assert.equal(result.lineup[0]?.personSlug, null);
  assert.deepEqual(result.questions.find(q => q.fieldPath === "lineup.0.personSlug")?.alternatives, []);
});
