"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OperatorSource } from "@/lib/event-operator-state";
import { eventDjTarget } from "@/lib/event-dj-target";
import { createEventPlaybackAdapter } from "@/lib/event-playback-adapters";
import { LocalPreviewPlayer } from "@/lib/local-preview-player";
import type { PlaybackRequest } from "@/lib/event-playback-owner";
export type PreviewSource = Pick<
  OperatorSource,
  "input" | "publicUrl" | "label"
>;
export function EventOperatorPreview({
  source,
  onClose,
}: {
  source: PreviewSource;
  onClose: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    player = useRef<LocalPreviewPlayer | undefined>(undefined);
  const [monitoring, setMonitoring] = useState(false),
    [available, setAvailable] = useState(false),
    [failed, setFailed] = useState(false);
  const input = source.input,
    url = source.publicUrl,
    label = source.label;
  const kind = input?.kind,
    name = input?.kind === "twitch" ? input.channel : input?.streamId;
  useEffect(() => {
    const element = mount.current;
    if (!element || !kind || !name || !url) return;
    let disposed = false,
      handle: LocalPreviewPlayer | undefined;
    const twitch = kind === "twitch";
    const identity = {
      eventId: "local-preview",
      eventSlug: "local-preview",
      href: url,
      title: label,
      startAt: 0,
      sourceId: `${kind}:${name}`,
    };
    const target = eventDjTarget(url);
    const request: PlaybackRequest | undefined =
      kind === "twitch"
        ? { ...identity, kind: "twitch", channel: name }
        : target?.questUrl
          ? {
              ...identity,
              kind: "vrcdn",
              src: target.questUrl,
              transport: "mpegts",
            }
          : undefined;
    function measure() {
      if (disposed) return;
      const rect = element!.getBoundingClientRect();
      const fits =
        !twitch ||
        (rect.width >= 400 &&
          rect.height >= 300 &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.left >= 0 &&
          rect.right <= window.innerWidth);
      setAvailable(fits && Boolean(request));
      if (!fits || !request) {
        handle?.close();
        handle = undefined;
        player.current = undefined;
        setMonitoring(false);
        return;
      }
      if (handle) return;
      handle = new LocalPreviewPlayer(
        () =>
          createEventPlaybackAdapter(request, element!, (patch) => {
            if (!disposed && patch.status === "unavailable") setFailed(true);
          }),
        () => {
          if (!disposed) setMonitoring(false);
        },
      );
      player.current = handle;
      if (!handle.start()) setFailed(true);
    }
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      disposed = true;
      resize.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      handle?.close();
      player.current = undefined;
    };
  }, [kind, name, url, label]);
  return (
    <section
      aria-label={`Preview ${source.label}`}
      className="min-w-0 space-y-3 border border-border rounded-panel p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{source.label}</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!available}
            onClick={() => {
              const started = player.current?.monitor() ?? false;
              setMonitoring(started);
              setFailed(!started);
            }}
          >
            {monitoring ? "Monitoring" : "Monitor"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close preview
          </Button>
        </div>
      </div>
      <div
        ref={mount}
        inert={!monitoring}
        aria-label="Local preview player"
        className={
          input?.kind === "twitch"
            ? "min-h-[300px] w-full"
            : "aspect-video w-full"
        }
        style={{ pointerEvents: monitoring ? "auto" : "none" }}
      />
      {!available || failed ? (
        <div className="flex gap-3 text-sm">
          <span>Unavailable</span>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
