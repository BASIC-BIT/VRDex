import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSlot, nextSlot } from "../../apps/web/src/lib/event-lineup-session";
const stream = { streamId: "one", pcUrl: "https://example.com/one", questUrl: "https://example.com/one" };
const a = { key: "a", performerId: "person", startAt: 0, endAt: 1000, stream };
test("replacement requires unique performer, authored start and source", () => {
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement" }])?.key, "replacement");
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement" }, { ...a, key: "duplicate" }]), undefined);
  assert.equal(reconcileSlot(a, [{ ...a, key: "replacement", performerId: "other" }]), undefined);
  assert.equal(reconcileSlot(a, [{ ...a, stream: undefined }]), undefined);
});
test("next slot preserves missing-source barriers and rejects overlap", () => {
  const b = { key: "b", startAt: 1000, endAt: 2000 };
  assert.equal(nextSlot(a, [a,b,{ ...a,key: "c",startAt: 2000 }])?.key, "b");
  assert.equal(nextSlot(a, [a,{ ...b,startAt: 999 }]), undefined);
  assert.equal(nextSlot(b, [a,b]), undefined);
});
