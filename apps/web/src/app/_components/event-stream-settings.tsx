"use client";
import { useRef, useState } from "react";
import type { FunctionArgs } from "convex/server";
import type { api } from "@convex-generated-api";
import { VIDEO_PROFILES } from "../../../../../workers/restream/broadcast-profiles.mjs";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
export type StreamSettings = Omit<
  FunctionArgs<typeof api.eventMediaSettings.configure>,
  "currentSlug"
>;
export function EventStreamSettings({
  settings,
  activeSettings,
  canControl,
  onSave,
}: {
  settings: StreamSettings;
  activeSettings?: StreamSettings;
  canControl: boolean;
  onSave: (settings: StreamSettings) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<StreamSettings | undefined>();
  const value = draft ?? settings,
    profile = VIDEO_PROFILES[value.videoPreset];
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const lock = useRef(false);
  function choose(height: number, rate: number) {
    const preset = Object.keys(VIDEO_PROFILES).find(
      (key) => key === `${height}p${rate}`,
    );
    if (
      preset &&
      (preset === "480p30" ||
        preset === "480p60" ||
        preset === "720p30" ||
        preset === "720p60" ||
        preset === "1080p30" ||
        preset === "1080p60")
    )
      setDraft({ ...value, videoPreset: preset });
  }
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Stream settings</h2>
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-muted">Active</dt>
          <dd>
            {activeSettings
              ? `${activeSettings.videoPreset} · ${activeSettings.audioBitrateKbps} kbps`
              : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Next start</dt>
          <dd>
            {settings.videoPreset} · {settings.audioBitrateKbps} kbps
          </dd>
        </div>
      </dl>
      <fieldset
        disabled={!canControl || busy}
        className="flex flex-wrap items-end gap-4"
      >
        <Field>
          Resolution
          <Select
            value={profile.height}
            onChange={(event) =>
              choose(Number(event.target.value), profile.frameRate)
            }
          >
            {[480, 720, 1080].map((height) => (
              <option key={height} value={height}>
                {height}p
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          Frame rate
          <Select
            value={profile.frameRate}
            onChange={(event) =>
              choose(profile.height, Number(event.target.value))
            }
          >
            {[30, 60].map((rate) => (
              <option key={rate} value={rate}>
                {rate} fps
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          Audio bitrate
          <Select
            value={value.audioBitrateKbps}
            onChange={(event) =>
              setDraft({
                ...value,
                audioBitrateKbps: event.target.value === "320" ? 320 : 160,
              })
            }
          >
            <option value="160">160 kbps</option>
            <option value="320">320 kbps</option>
          </Select>
        </Field>
        <Button
          variant="secondary"
          onClick={async () => {
            if (lock.current || !canControl) return;
            lock.current = true;
            setBusy(true);
            setFailed(false);
            try {
              await onSave(value);
              setDraft(undefined);
            } catch {
              setFailed(true);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          Save settings
        </Button>
      </fieldset>
      <p className="text-sm text-muted">Stereo · 48 kHz · Twitch: 160 kbps</p>
      {failed ? <p role="status">Save failed</p> : null}
    </section>
  );
}
