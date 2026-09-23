import { attachVrcdnTransport, releaseVrcdnTransport } from "./vrcdn-transport";
import type { AudioObservationSample } from "./event-audio-observation";

/** Optional observed transport for event playback. Standalone/profile callers keep their existing lifecycle. */
export async function createObservedVrcdnSource(context: AudioContext, destination: AudioNode, src: string, isCurrent: () => boolean = () => true) {
  const { default: mpegts } = await import("mpegts.js");
  if (!isCurrent()) throw new Error("Obsolete source request");
  if (!mpegts.isSupported()) throw new Error("Unsupported media transport");
  const video = document.createElement("video");
  video.playsInline = true;
  video.className = "aspect-video w-full object-contain";
  const source = context.createMediaElementSource(video);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(analyser); analyser.connect(gain); gain.connect(destination);
  const values = new Float32Array(analyser.fftSize);

  let failed = false;
  let released = false;
  let playGeneration = 0;
  let previousTime = 0;
  let progressCount = 0;

  // EOF is deliberately not a release or handoff signal. Buffered media remains playable.
  let player: ReturnType<typeof attachVrcdnTransport>;
  try { player = attachVrcdnTransport(mpegts, video, src, { onError: () => { failed = true; } }); }
  catch (error) { source.disconnect(); analyser.disconnect(); gain.disconnect(); video.removeAttribute("src"); video.load(); throw error; }
  return {
    video, gain,
    sample(observedAt: number, paused: boolean): AudioObservationSample {
      const progressing = video.currentTime > previousTime && video.readyState >= 2 && !video.paused;
      progressCount = progressing ? progressCount + 1 : 0;
      previousTime = video.currentTime;
      analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      return { observedAt, dbfs: 20 * Math.log10(Math.max(rms, 1e-12)), progressing,
        analysisActive: document.visibilityState === "visible" && context.state === "running",
        paused, disconnected: !progressing && (failed || video.ended) };
    },
    ready() { return progressCount >= 3 && !video.paused && video.readyState >= 2; },
    async play() {
      const generation = ++playGeneration;
      try {
        await context.resume();
        if (released || generation !== playGeneration) return false;
        await video.play();
        return !released && generation === playGeneration;
      }
      catch { return false; }
    },
    pause() { playGeneration++; video.pause(); },
    release() {
      if (released) return;
      released = true;
      playGeneration++;
      gain.gain.value = 0;
      releaseVrcdnTransport(player);
      source.disconnect(); analyser.disconnect(); gain.disconnect();
      video.removeAttribute("src"); video.load(); video.remove();
    },
  };
}
export type ObservedVrcdnSource = Awaited<ReturnType<typeof createObservedVrcdnSource>>;
