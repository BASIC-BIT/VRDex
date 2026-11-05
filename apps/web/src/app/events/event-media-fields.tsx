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
  return <>
    <label className="flex gap-3 rounded-control border border-border bg-surface-strong p-4 text-sm leading-6">
      <input
        className="mt-1 h-4 w-4 flex-none accent-accent"
        checked={enabled}
        onChange={event => onEnabledChange(event.currentTarget.checked)}
        name="watchSurfaceEnabled"
        type="checkbox"
      />
      <span>
        <span className="block font-medium text-foreground">Promote a watch surface during the event window</span>
        <span className="mt-1 block text-xs leading-5 text-muted">
          Keep this off unless stream capacity is ready for public viewers.
        </span>
      </span>
    </label>
    {enabled ? <Field>
      Watch mode
      <Select aria-label="Watch mode" onChange={event => onModeChange(event.currentTarget.value as WatchMode)} value={mode}>
        <option value="event_stream">Event stream</option>
        <option value="performer_sequence">Performer sequence</option>
      </Select>
    </Field> : null}
  </>;
}
