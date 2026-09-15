"use client";

import { useEffect, useRef, useState } from "react";
import { VrcdnStreamPlayer } from "@/app/_components/vrcdn-stream-player";

type Player = ReturnType<(typeof import("mpegts.js"))["default"]["createPlayer"]>;
type Connection = { video: HTMLVideoElement; player: Player; source: MediaElementAudioSourceNode; analyser: AnalyserNode; gain: GainNode; kind: string; lastTime: number; progress: number; failed: boolean };
type Sample = { at: number; kind: string; db: number; outputDb: number; time: number; progressing: boolean; valid: boolean; silenceMs: number; gap: number };
const EMPTY = { current: "", nextReady: false, connections: 0, rejected: false, samples: [] as Sample[], context: "", volume: 1, muted: false };

/** Isolated transport experiment. No product state or schedule policy lives here. */
export function PlaybackProof() {
  const mount = useRef<HTMLDivElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const current = useRef<Connection | null>(null);
  const next = useRef<Connection | null>(null);
  const master = useRef<GainNode | null>(null);
  const output = useRef<AnalyserNode | null>(null);
  const silenceSince = useRef<number | null>(null);
  const lastSample = useRef(0);
  const generation = useRef(0);
  const rejected = useRef(false);
  const rejectOnce = useRef(false);
  const viewer = useRef({ volume: 1, muted: false });
  const history = useRef<Sample[]>([]);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [baseline, setBaseline] = useState(false);
  const [base, setBase] = useState("http://127.0.0.1:4319");

  const release = (connection: Connection | null) => {
    if (!connection) return;
    connection.player.pause(); connection.player.unload(); connection.player.detachMediaElement(); connection.player.destroy();
    connection.source.disconnect(); connection.analyser.disconnect(); connection.gain.disconnect();
    connection.video.removeAttribute("src"); connection.video.load(); connection.video.remove();
  };
  const clear = () => { silenceSince.current = null; lastSample.current = 0; };
  const stop = () => {
    generation.current++; release(current.current); release(next.current); current.current = null; next.current = null; clear();
  };
  const setGain = () => { if (master.current) master.current.gain.value = viewer.current.muted ? 0 : viewer.current.volume; };
  const ensureAudio = async () => {
    if (!audio.current) {
      const context = new AudioContext(); audio.current = context;
      master.current = context.createGain(); output.current = context.createAnalyser(); output.current.fftSize = 2048;
      master.current.connect(output.current); output.current.connect(context.destination);
    }
    await audio.current.resume();
  };
  const play = async (video: HTMLVideoElement) => {
    try {
      if (rejectOnce.current) { rejectOnce.current = false; throw new DOMException("Proof rejection", "NotAllowedError"); }
      await video.play(); rejected.current = false;
    } catch { rejected.current = true; clear(); }
  };
  const connect = async (kind: string, prepared: boolean) => {
    if (prepared && !current.current) return;
    const request = ++generation.current;
    if (prepared) { release(next.current); next.current = null; }
    else { stop(); }
    const token = prepared ? request : generation.current;
    clear();
    await ensureAudio();
    const { default: mpegts } = await import("mpegts.js");
    if (generation.current !== token || !mount.current || !audio.current || !master.current) return;
    if (!mpegts.isSupported()) { rejected.current = true; return; }
    const video = document.createElement("video"); video.playsInline = true; video.width = 320; video.height = 180;
    video.dataset.source = prepared ? "next" : "current"; mount.current.append(video);
    const source = audio.current.createMediaElementSource(video);
    const analyser = audio.current.createAnalyser(); analyser.fftSize = 2048;
    const gain = audio.current.createGain(); gain.gain.value = prepared ? 0 : 1;
    source.connect(analyser); analyser.connect(gain); gain.connect(master.current);
    const player = mpegts.createPlayer({ isLive: true, type: "mpegts", url: `${base}/${kind}.live.ts?id=${prepared ? "next" : "current"}` });
    const connection: Connection = { video, source, analyser, gain, player, kind, lastTime: 0, progress: 0, failed: false };
    player.on(mpegts.Events.ERROR, () => { connection.failed = true; });
    player.attachMediaElement(video); player.load();
    if (prepared) next.current = connection; else current.current = connection;
    await play(video);
  };
  const switchSource = () => {
    const ready = next.current;
    if (!ready || ready.failed || ready.progress < 3 || ready.video.paused || ready.video.readyState < 2) return;
    if (current.current) current.current.gain.gain.value = 0;
    release(current.current); current.current = ready; next.current = null;
    ready.gain.gain.value = 1; ready.video.dataset.source = "current"; clear();
  };

  useEffect(() => {
    const configured = new URLSearchParams(location.search).get("transport");
    if (configured && /^http:\/\/127\.0\.0\.1:\d+$/.test(configured)) setBase(configured);
    const db = (analyser: AnalyserNode) => {
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      return 20 * Math.log10(Math.max(Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length), 1e-12));
    };
    const reset = () => clear();
    document.addEventListener("visibilitychange", reset);
    const timer = window.setInterval(() => {
      const at = performance.now(); const active = current.current;
      for (const connection of [active, next.current]) {
        if (!connection) continue;
        if (connection.video.currentTime > connection.lastTime) connection.progress++;
        connection.lastTime = connection.video.currentTime;
      }
      if (active) {
        const previous = history.current.at(-1);
        const progressing = !!previous && active.video.currentTime > previous.time && previous.kind === active.kind;
        const gap = lastSample.current ? at - lastSample.current : 0;
        const valid = document.visibilityState === "visible" && audio.current?.state === "running" && !active.video.paused && !active.failed && progressing && gap > 0 && gap <= 500;
        const level = db(active.analyser);
        if (!valid || level >= -90) silenceSince.current = null;
        else silenceSince.current ??= at;
        history.current.push({ at, kind: active.kind, db: level, outputDb: output.current ? db(output.current) : -240, time: active.video.currentTime, progressing, valid, silenceMs: silenceSince.current === null ? 0 : at - silenceSince.current, gap });
        history.current = history.current.slice(-1200); lastSample.current = at;
      }
      const candidate = next.current;
      setSnapshot({ current: active?.kind ?? "", nextReady: !!candidate && !candidate.failed && candidate.progress >= 3 && !candidate.video.paused && candidate.video.readyState >= 2, connections: Number(!!active) + Number(!!candidate), rejected: rejected.current, samples: [...history.current], context: audio.current?.state ?? "", ...viewer.current });
    }, 100);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", reset); stop(); void audio.current?.close(); };
    // All mutable connection/audio ownership is kept in refs for this development fixture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <main className="mx-auto max-w-4xl space-y-4 p-6">
    <h1>Event playback proof</h1>
    <div className="flex flex-wrap gap-3">
      {["audible", "quiet", "silent", "break"].map(kind => <button key={kind} onClick={() => { setBaseline(false); void connect(kind, false); }}>Start {kind}</button>)}
      <button onClick={() => void connect("audible", true)}>Prepare next</button>
      <button onClick={switchSource}>Switch</button>
      <button onClick={() => { current.current?.video.pause(); clear(); }}>Pause</button>
      <button onClick={() => { clear(); void ensureAudio().then(() => { if (current.current) return play(current.current.video); }); }}>Resume</button>
      <button onClick={() => { viewer.current.muted = !viewer.current.muted; setGain(); }}>Mute</button>
      <button onClick={() => { viewer.current.volume = 0.25; setGain(); }}>Volume 25%</button>
      <button onClick={() => { clear(); void audio.current?.suspend(); }}>Suspend context</button>
      <button onClick={() => { rejectOnce.current = true; }}>Reject next play</button>
      <button onClick={stop}>Stop</button>
      <button onClick={() => { stop(); setBaseline(true); }}>Baseline</button>
    </div>
    <div ref={mount} className="flex gap-3" />
    {baseline && <VrcdnStreamPlayer title="Unmodified player" src={`${base}/audible.live.ts?id=baseline`} />}
    <output data-testid="connection-count">{snapshot.connections}</output>
    <pre data-testid="snapshot" className="max-h-96 overflow-auto text-xs">{JSON.stringify(snapshot)}</pre>
  </main>;
}
