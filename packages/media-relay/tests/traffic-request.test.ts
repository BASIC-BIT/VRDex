import assert from "node:assert/strict";
import { test } from "node:test";
import { isMeterableSegmentRequest } from "../src/traffic-ceiling/request";

const base = {
  method: "GET",
  uri: "/vrcdn/Alpha/1/epochs/2/attempt-3-abc/video-17.ts",
  querystring: "Expires=1800000000&Signature=Abc-_~&Key-Pair-Id=K123",
  headers: {} as Record<string, string[]>,
  keyPairId: "K123",
};

test("accepts only the exact signed full-object segment GET shape", () => {
  assert.equal(isMeterableSegmentRequest(base), true);
  for (const method of ["HEAD", "POST", "OPTIONS", "PUT"]) {
    assert.equal(isMeterableSegmentRequest({ ...base, method }), false);
  }
  for (const uri of [
    "/vrcdn/Alpha/1/epochs/2/attempt-3-abc/video-17.ts/other",
    "/vrcdn/Alpha/1/epochs/2/attempt-3-abc/video-17.ts%2f",
    "/vrcdn/Alpha/1/epochs/2/snapshots/video-17.json",
    "/vrcdn/Alpha/1/epochs/2/attempt-3-abc/../video-17.ts",
  ])
    assert.equal(isMeterableSegmentRequest({ ...base, uri }), false);
});

test("range, validators and query variation are denied before reservation", () => {
  for (const name of ["Range", "rAnGe", "If-None-Match", "If-Modified-Since", "If-Range"]) {
    assert.equal(
      isMeterableSegmentRequest({ ...base, headers: { [name]: ["bytes=0-1"] } }),
      false,
    );
  }
  for (const querystring of [
    base.querystring + "&Expires=1800000001",
    base.querystring + "&viewer=other",
    "Expires=1800000000&Signature=Abc-_~",
    "Expires=1800000000&Signature=Abc-_~&Key-Pair-Id=OTHER",
    "E%78pires=1800000000&Signature=Abc-_~&Key-Pair-Id=K123",
    "Expires=1800000000&Sign%61ture=Abc-_~&Key-Pair-Id=K123",
    "Expires=1800000000&Signature=Abc%2D_~&Key-Pair-Id=K123",
    "expires=1800000000&Signature=Abc-_~&Key-Pair-Id=K123",
    "Signature=Abc-_~&Expires=1800000000&Key-Pair-Id=K123",
  ])
    assert.equal(isMeterableSegmentRequest({ ...base, querystring }), false);
});
