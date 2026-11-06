"use client";
import { Field, FieldText, Select, Textarea } from "@/components/ui/field";
import { VrcdnMediaLinkAssistant } from "../_components/vrcdn-media-link-assistant";

type WatchMode = "event_stream" | "performer_sequence";

export function EventMediaLinksField({ value, onChange }: { value: string; onChange(next: string): void }) {
  return <>
    <Field>
      Media links
      <Textarea className="min-h-28" name="mediaLinks" onChange={(changeEvent) => onChange(changeEvent.currentTarget.value)} placeholder="watch | Twitch watch link | https://... | open&#10;vrcdn | VRCDN Quest link | https://stream.vrcdn.live/live/name.live.ts | copy&#10;vrcdn | VRCDN PC link | rtspt://stream.vrcdn.live/live/name | copy" value={value} />
      <FieldText>One per line: type | label | URL | open or copy. VRCDN variants derive Quest and PC player links automatically.</FieldText>
    </Field>
    <VrcdnMediaLinkAssistant mediaLinksText={value} />
  </>;
}

export function EventWatchFields({ enabled, mode, onEnabledChange, onModeChange }: {
  enabled: boolean;
  mode: WatchMode;
  onEnabledChange(next: boolean): void;
  onModeChange(next: WatchMode): void;
}) {
  return <Field>
    Watch mode
    <Select aria-label="Watch mode" value={enabled && mode === "event_stream" ? "event_stream" : "automatic"} onChange={event => {
      onEnabledChange(event.currentTarget.value === "event_stream");
      onModeChange("event_stream");
    }}>
      <option value="automatic">Automatic</option>
      <option value="event_stream">Event stream</option>
    </Select>
  </Field>;
}
