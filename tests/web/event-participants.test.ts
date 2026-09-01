import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeOtherEventParticipants } from "../../apps/web/src/lib/calendar/event-participants";

describe("event editor participants", () => {
  it("does not duplicate scheduled performers as other participants", () => {
    assert.equal(serializeOtherEventParticipants({
      participants: [
        { slug: "scheduled-dj", roleLabel: "Performer" },
        { slug: "event-host", roleLabel: "Host" },
      ],
      slots: [{ performer: { slug: "scheduled-dj" } }],
    }), "event-host | Host");
  });
});
