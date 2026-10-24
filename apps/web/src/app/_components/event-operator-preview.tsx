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
type PreviewState = {
  handle: LocalPreviewPlayer;
  sourceKey: string;
  monitoring: boolean;
  failed: boolean;
};
export function EventOperatorPreview({
  source,
  onClose,
}: {
  source: PreviewSource;
  onClose: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    player = useRef<LocalPreviewPlayer | undefined>(undefined),
    currentRequest = useRef<PlaybackRequest | undefined>(undefined);
  const [view, setView] = useState<PreviewState | undefined>(undefined);
  const input = source.input,
    url = source.publicUrl,
    label = source.label;
  const kind = input?.kind,
    name = input?.kind === "twitch" ? input.channel : input?.streamId;
  const sourceKey = `${kind}:${name}:${url}`;
  const available = view?.sourceKey === sourceKey;
  const monitoring = available && view.monitoring;
  const failed = available && view.failed;
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
      title: name,
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
    currentRequest.current = request;
    function blockInteraction() {
      // React may batch state updates. Fence the existing iframe synchronously
      // before releasing ownership or constructing a replacement adapter.
      element!.inert = true;
      element!.style.pointerEvents = "none";
    }
    function closeHandle() {
      blockInteraction();
      const previous = handle;
      handle = undefined;
      player.current = undefined;
      setView(undefined);
      previous?.close();
    }
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
      if (!fits || !request) {
        closeHandle();
        return;
      }
      if (handle) return;
      blockInteraction();
      let adapterGeneration = 0;
      const candidate = new LocalPreviewPlayer(
        () => {
          const generation = ++adapterGeneration;
          return createEventPlaybackAdapter(currentRequest.current!, element!, (patch) => {
            if (disposed || player.current !== candidate || generation !== adapterGeneration) return;
            if (patch.status === "unavailable" || patch.status === "playing") {
              setView(current => current?.handle === candidate
                ? { ...current, failed: patch.status === "unavailable" }
                : current);
            }
          });
        },
        () => {
          adapterGeneration++;
          if (disposed || player.current !== candidate) return;
          blockInteraction();
          setView(current => current?.handle === candidate
            ? { ...current, monitoring: false }
            : current);
        },
      );
      handle = candidate;
      player.current = candidate;
      setView({ handle: candidate, sourceKey, monitoring: false, failed: false });
      if (!candidate.start()) {
        setView(current => current?.handle === candidate ? { ...current, failed: true } : current);
      }
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
      closeHandle();
      currentRequest.current = undefined;
    };
  }, [kind, name, url, sourceKey]);
  useEffect(() => {
    if (!currentRequest.current) return;
    currentRequest.current = { ...currentRequest.current, title: label };
    player.current?.update(currentRequest.current);
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
              const candidate = player.current;
              if (!candidate || view?.handle !== candidate || !available) return;
              const started = candidate.monitor();
              setView(current => current?.handle === candidate
                ? { ...current, monitoring: started, failed: !started }
                : current);
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
