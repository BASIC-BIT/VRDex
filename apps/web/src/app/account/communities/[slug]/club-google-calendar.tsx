"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useClubWorkspace } from "./club-workspace";
import {
  directionOptions,
  KIND_LABELS,
  pickableCalendars,
  primaryFirst,
  type Connector,
  type GoogleCalendar,
} from "./club-integrations-model";

type Direction = Connector["direction"];
export type GoogleCalendarTarget = { calendarId: string; calendarName: string };

function CalendarPicker({
  calendars,
  onSave,
}: {
  calendars: readonly GoogleCalendar[];
  onSave: (target: GoogleCalendarTarget, direction: Direction) => Promise<unknown>;
}) {
  const ordered = primaryFirst(calendars);
  const [calendarId, setCalendarId] = useState(ordered[0].id);
  const [direction, setDirection] = useState<Direction>("import");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Another staffer can connect the chosen calendar while this is open, which drops it from the list.
  const calendar = ordered.find((item) => item.id === calendarId) ?? ordered[0];
  const save = () => {
    setPending(true);
    setFailed(false);
    // Success unmounts the picker, so pending stays set until then and Save cannot fire twice.
    onSave({ calendarId: calendar.id, calendarName: calendar.summary.slice(0, 100) }, direction).catch(() => {
      setPending(false);
      setFailed(true);
    });
  };
  return (
    <>
      {failed ? (
        <Notice variant="error" role="alert">
          Try again.
        </Notice>
      ) : null}
      {/* Mirrors ConnectorRow's layout so the pending connection reads as the row it becomes. */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <p className="min-w-0 font-semibold">{KIND_LABELS.google_calendar}</p>
          <div className="order-last flex flex-wrap items-start gap-2 sm:order-none sm:col-start-2 sm:row-start-1">
            <Button size="sm" variant="primary" disabled={pending} onClick={save}>
              Save
            </Button>
          </div>
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <Select aria-label="Calendar" value={calendar.id} onChange={(event) => setCalendarId(event.target.value)}>
              {ordered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.summary}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Direction"
              className="self-start"
              value={direction}
              onChange={(event) => setDirection(event.target.value as Direction)}
            >
              {directionOptions("google_calendar").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>
    </>
  );
}

// calendars: undefined shows Connect, null is loading, an array is the picker. Connect and the picker
// need enabled; the failure notice does not, so a failed Reconnect is never silent.
export function GoogleCalendarConnectView({
  communitySlug,
  enabled,
  failed,
  calendars,
  onSave,
}: {
  communitySlug: string;
  enabled: boolean;
  failed: boolean;
  calendars: readonly GoogleCalendar[] | null | undefined;
  onSave: (target: GoogleCalendarTarget, direction: Direction) => Promise<unknown>;
}) {
  const empty = enabled && calendars?.length === 0;
  return (
    <>
      {failed || empty ? (
        <Notice variant="error" role="alert">
          Google Calendar did not connect. Try again.
        </Notice>
      ) : null}
      {!enabled ? null : calendars === undefined || empty ? (
        <div>
          <a
            href={`/api/connectors/google/start?community=${encodeURIComponent(communitySlug)}`}
            className={buttonVariants()}
          >
            Connect Google Calendar
          </a>
        </div>
      ) : calendars ? (
        <CalendarPicker calendars={calendars} onSave={onSave} />
      ) : null}
    </>
  );
}

export function GoogleCalendarConnect({ connectedCalendarIds }: { connectedCalendarIds: readonly string[] }) {
  const { community } = useClubWorkspace();
  const enabled = useQuery(api.googleCalendarConnector.enabled, {});
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const listCalendars = useAction(api.googleCalendarConnector.listCalendars);
  const create = useMutation(api.eventConnectors.create);
  const credentialId = search.get("googleCredential") as Id<"connectorCredentials"> | null;
  const [loaded, setLoaded] = useState<{ credentialId: string; calendars: GoogleCalendar[] | null } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled || !credentialId) return;
    let live = true;
    listCalendars({ credentialId }).then(
      (calendars) => live && setLoaded({ credentialId, calendars }),
      () => live && setLoaded({ credentialId, calendars: null }),
    );
    return () => {
      live = false;
    };
  }, [enabled, credentialId, listCalendars]);

  const current = credentialId && loaded?.credentialId === credentialId ? loaded : null;
  const listFailed = current !== null && current.calendars === null;
  // The saved row can arrive before the query param drops; filtering it then would flash the empty notice.
  const calendars = current?.calendars && !saving
    ? pickableCalendars(current.calendars, connectedCalendarIds)
    : current?.calendars;
  return (
    <GoogleCalendarConnectView
      communitySlug={community.slug}
      enabled={enabled === true}
      failed={search.get("googleCalendar") === "failed" || listFailed}
      calendars={!credentialId || listFailed ? undefined : (calendars ?? null)}
      onSave={async (target, direction) => {
        if (!credentialId) return;
        setSaving(true);
        try {
          await create({
            communityProfileId: community._id,
            kind: "google_calendar",
            direction,
            mode: "hold",
            target,
            credentialId,
          });
        } catch (error) {
          setSaving(false);
          throw error;
        }
        const next = new URLSearchParams(search.toString());
        next.delete("googleCredential");
        router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
      }}
    />
  );
}
