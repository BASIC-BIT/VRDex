import assert from "node:assert/strict";
import test from "node:test";
import { handoffEligibleAt } from "../../apps/web/src/lib/event-playback";
import { reconcileSlot, nextSlot } from "../../apps/web/src/lib/event-lineup-session";
const stream = { streamId: "one", pcUrl: "https://example.com/one", questUrl: "https://example.com/one" };
const a = { key: "a", performerId: "person", startAt: 0, endAt: 1000, stream };
test("replacement requires unique performer, authored start and source", () => {
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement" }])?.key, "replacement");
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement" }, { ...a, key: "duplicate" }]), undefined);
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement", performerId: "other" }]), undefined);
  assert.equal(reconcileSlot(a, [{ ...a, stream: undefined }]), undefined);
});
test("next slot preserves missing-source, simultaneous-start and ordering barriers", () => {
  const b = { key: "b", startAt: 1000, endAt: 2000 };
  assert.equal(nextSlot(a, [a,b,{ ...a,key: "c",startAt: 2000 }], 900)?.key, "b");
  assert.equal(nextSlot(a, [a,{ ...b,startAt: 0 }], 900), undefined);
  assert.equal(nextSlot(a, [a,{ ...b,startAt: -1 }], 900), undefined);
  assert.equal(nextSlot(b, [a,b], 900), undefined);
});
test("established current traverses ordered overlaps, including unrelated later overlaps", () => {
  const b = { key: "b", startAt: 999, endAt: 2000, stream };
  assert.equal(nextSlot(a, [a,b], 900)?.key, "b");
  const later = [{ key: "c", startAt: 2100, endAt: 3000 }, { key: "d", startAt: 2500, endAt: 4000 }];
  assert.equal(nextSlot(a, [a,{ ...b,startAt: 1000 },...later], 900)?.key, "b");
});

test("an ended immediate next slot blocks automatic handoff without skipping ahead", () => {
  const at = (hour: number, minute = 0) => (hour * 60 + minute) * 60_000;
  const current = { key: "a", startAt: at(20), endAt: at(22), stream };
  const contained = { key: "b", startAt: at(20, 30), endAt: at(21), stream };
  const later = { key: "c", startAt: at(22), endAt: at(23), stream };
  assert.equal(nextSlot(current, [current, contained, later], at(21, 58)), undefined);
  assert.equal(nextSlot(current, [current, contained, later], at(20, 58))?.key, "b");
  const ordinaryCurrent = { ...current, endAt: at(21) };
  const ordinaryNext = { ...contained, endAt: at(21, 30) };
  assert.equal(handoffEligibleAt(ordinaryCurrent, ordinaryNext), at(20, 58));
  assert.equal(nextSlot(ordinaryCurrent, [ordinaryCurrent, ordinaryNext], at(20, 58))?.key, "b");
  assert.equal(nextSlot(ordinaryCurrent, [ordinaryCurrent, ordinaryNext], at(21, 30)), undefined);
});

test("a missing next end uses the following start without limiting the current slot", () => {
  const current = { key: "a", startAt: 20 * 60, stream };
  const candidate = { key: "b", startAt: 20 * 60 + 30, stream };
  const later = { key: "c", startAt: 21 * 60, stream };
  assert.equal(nextSlot(current, [current, candidate, later], 20 * 60 + 59)?.key, "b");
  assert.equal(nextSlot(current, [current, candidate, later], 21 * 60), undefined);
  assert.equal(nextSlot(current, [current, candidate], 22 * 60)?.key, "b");
});

test("later ambiguity does not block an earlier unambiguous transition", () => {
  const b = { key: "b", startAt: 1000, endAt: 2000, stream };
  const c = { key: "c", startAt: 2000, endAt: 3000, stream };
  const d = { ...c, key: "d" };
  const slots = [a,b,c,d];
  assert.equal(nextSlot(a, slots, 900)?.key, "b");
  assert.equal(nextSlot(b, slots, 900), undefined);
  assert.equal(nextSlot(c, slots, 900), undefined);
  assert.equal(nextSlot(d, [...slots,{ key: "e", startAt: 3000, stream }], 900), undefined);
  assert.equal(nextSlot(a, [a,b,c,{ ...d,startAt: 1900 }], 900)?.key, "b");
  assert.equal(nextSlot(b, [a,b,c,{ ...d,startAt: 1900 }], 900), undefined);
});
