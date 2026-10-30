"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DIRECTION_LABELS } from "./club-integrations-model";

const DIRECTIONS = ["export", "import", "bidirectional"] as const;
type Direction = (typeof DIRECTIONS)[number];

export function VrchatCalendarConnectView({
  availability,
  onConnect,
}: {
  availability: { enabled: boolean; ready: boolean } | undefined;
  onConnect: (direction: Direction) => Promise<unknown>;
}) {
  const [direction, setDirection] = useState<Direction>("export");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!availability?.enabled) return null;
  const connect = () => {
    setPending(true);
    setFailed(false);
    onConnect(direction)
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };
  return (
    <div className="grid gap-3">
      {failed ? (
        <Notice variant="error" role="alert">
          Try again.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Direction"
          className="w-auto"
          value={direction}
          onChange={(event) => setDirection(event.target.value as Direction)}
        >
          {DIRECTIONS.map((value) => (
            <option key={value} value={value}>
              {DIRECTION_LABELS[value]}
            </option>
          ))}
        </Select>
        <Button disabled={!availability.ready || pending} onClick={connect}>
          Connect VRChat calendar
        </Button>
      </div>
    </div>
  );
}

export function VrchatCalendarConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }) {
  const availability = useQuery(api.vrchatCalendarConnector.availability, { communityProfileId });
  const create = useMutation(api.eventConnectors.create);
  return (
    <VrchatCalendarConnectView
      availability={availability}
      onConnect={(direction) =>
        create({
          communityProfileId,
          kind: "vrchat_calendar",
          direction,
          mode: "hold",
          target: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        })
      }
    />
  );
}
