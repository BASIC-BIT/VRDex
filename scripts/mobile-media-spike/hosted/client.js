// Throwaway static experiment. No analytics or evidence upload.
const video = document.querySelector("#video");
const audio = document.querySelector("#audio");
const mode = document.querySelector("#mode");
const status = document.querySelector("#status");
const pip = document.querySelector("#pip");
const stop = document.querySelector("#stop");
let active = video;
let run;
const runs = [];
function record(event, detail = null) {
  const entry = { event, detail, at: new Date().toISOString(), mode: run?.mode ?? mode.value, time: active.currentTime, paused: active.paused, ended: active.ended, readyState: active.readyState, networkState: active.networkState, visibility: document.visibilityState, errorCode: active.error?.code ?? null, error: active.error?.message ?? null };
  run?.events.push(entry);
  document.querySelector("#events").textContent = JSON.stringify(run?.events.slice(-20) ?? [], null, 2);
}
function message(text) { status.textContent = text; }
function release() {
  for (const media of [video, audio]) { media.pause(); media.removeAttribute("src"); media.load(); }
  pip.disabled = true; stop.disabled = true;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
}
for (const media of [video, audio]) {
  for (const event of ["loadstart", "loadedmetadata", "canplay", "abort", "playing", "pause", "waiting", "stalled", "ended", "error", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) media.addEventListener(event, () => {
    if (media !== active) return;
    record(event);
    if (event === "playing") { message("Playing"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }
    if (event === "pause" && !media.error) { message("Paused"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; }
    if (event === "ended") message("Sample finished");
    if (event === "error") message(`Playback failed (media error ${media.error?.code ?? "unknown"}). Save the log.`);
  });
}
document.querySelector("#start").addEventListener("click", async () => {
  if (run) { run.notes = document.querySelector("#notes").value; record("replaced"); }
  release();
  active = ["audio", "relay-audio"].includes(mode.value) ? audio : video;
  audio.hidden = active !== audio; video.hidden = active !== video;
  run = { startedAt: new Date().toISOString(), mode: mode.value, sample: mode.value.startsWith("relay") ? `vrcdn-basicbit-live-hls-${mode.value}` : mode.value === "live" ? "vrcdn-basicbit-live-mp4" : "prerecorded-synthetic-hls", durationSeconds: ["live", "relay", "relay-audio"].includes(mode.value) ? null : 2100, notes: "", events: [] };
  runs.push(run); document.querySelector("#notes").value = ""; record("start");
  if (mode.value !== "live" && !active.canPlayType("application/vnd.apple.mpegurl")) { message("Native HLS is unavailable in this browser. Try Safari on iPhone or Chrome on Android."); record("native-hls-unavailable"); return; }
  active.src = mode.value === "relay-audio" ? "/relay/audio/index.m3u8" : mode.value === "relay" ? "/relay/index.m3u8" : mode.value === "live" ? "https://stream.vrcdn.live/live/basicbit.live.mp4" : `/media/${mode.value}.m3u8`;
  message("Connecting");
  const thisRun = run;
  setTimeout(() => {
    if (run === thisRun && active.currentTime === 0 && !active.error && !stop.disabled) {
      record("startup-timeout"); message("No playback after 15 seconds. Save the log.");
    }
  }, 15000);
  stop.disabled = false;
  pip.disabled = active !== video || !(document.pictureInPictureEnabled || typeof video.webkitSetPresentationMode === "function");
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: "Mobile playback test", artist: active === audio ? "Audio stream" : "Video stream" });
    for (const [action, handler] of [["play", () => active.play().catch(() => { record("play-rejected"); message("Tap Play to resume."); })], ["pause", () => active.pause()]]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { record(`unsupported-action:${action}`); }
    }
  }
  try { await active.play(); } catch (error) {
    if (run !== thisRun) return;
    record("play-rejected", { name: error.name, message: error.message });
    if (active.error) message(`Playback failed (media error ${active.error.code}). Save the log.`);
    else if (error.name === "NotAllowedError") message("Tap Play in the media controls to start.");
    else message(`Playback rejected (${error.name}). Save the log.`);
  }
});
pip.addEventListener("click", async () => {
  try {
    if (document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (typeof video.webkitSetPresentationMode === "function") video.webkitSetPresentationMode("picture-in-picture");
    else message("Try Picture in picture from fullscreen controls.");
  } catch { record("pip-rejected"); message("Try Picture in picture from fullscreen controls."); }
});
stop.addEventListener("click", () => { record("stop"); release(); message("Stopped"); });
document.addEventListener("visibilitychange", () => record("visibilitychange"));
window.addEventListener("pagehide", () => record("pagehide"));
window.addEventListener("pageshow", () => record("pageshow"));
setInterval(() => { if (run) record("sample"); }, 5000);
document.querySelector("#save").addEventListener("click", () => {
  if (run) { run.notes = document.querySelector("#notes").value; record("export"); }
  const evidence = { userAgent: navigator.userAgent, secure: isSecureContext, savedAt: new Date().toISOString(), limitation: "Video/audio samples are prerecorded; relay mode is live HLS and live mode is direct MP4. Timestamps do not prove audible output or phone background support.", runs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "mobile-playback-log.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
