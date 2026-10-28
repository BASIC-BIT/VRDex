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
function record(event) {
  const entry = { event, at: new Date().toISOString(), mode: run?.mode ?? mode.value, time: active.currentTime, paused: active.paused, ended: active.ended, readyState: active.readyState, visibility: document.visibilityState, error: active.error?.message ?? null };
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
  for (const event of ["playing", "pause", "waiting", "stalled", "ended", "error", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) media.addEventListener(event, () => {
    if (media !== active) return;
    record(event);
    if (event === "playing") { message("Playing"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }
    if (event === "pause") { message("Paused"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; }
    if (event === "ended") message("Sample finished");
    if (event === "error") message("Playback failed. Save the log.");
  });
}
document.querySelector("#start").addEventListener("click", async () => {
  if (run) { run.notes = document.querySelector("#notes").value; record("replaced"); }
  release();
  active = mode.value === "audio" ? audio : video;
  audio.hidden = active !== audio; video.hidden = active !== video;
  run = { startedAt: new Date().toISOString(), mode: mode.value, sample: mode.value === "live" ? "vrcdn-basicbit-live-mp4" : "prerecorded-synthetic-hls", durationSeconds: mode.value === "live" ? null : 2100, notes: "", events: [] };
  runs.push(run); document.querySelector("#notes").value = ""; record("start");
  if (mode.value !== "live" && !active.canPlayType("application/vnd.apple.mpegurl")) { message("Native HLS is unavailable in this browser. Try Safari on iPhone or Chrome on Android."); record("native-hls-unavailable"); return; }
  active.src = mode.value === "live" ? "https://stream.vrcdn.live/live/basicbit.live.mp4" : `/media/${mode.value}.m3u8`;
  stop.disabled = false;
  pip.disabled = active !== video || !(document.pictureInPictureEnabled || typeof video.webkitSetPresentationMode === "function");
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: "Mobile playback test", artist: mode.value === "audio" ? "Audio sample" : "Video sample" });
    for (const [action, handler] of [["play", () => active.play().catch(() => { record("play-rejected"); message("Tap Play to resume."); })], ["pause", () => active.pause()]]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { record(`unsupported-action:${action}`); }
    }
  }
  try { await active.play(); } catch { record("play-rejected"); message("Tap Play in the media controls to start."); }
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
  const evidence = { userAgent: navigator.userAgent, secure: isSecureContext, savedAt: new Date().toISOString(), limitation: "HLS modes are prerecorded; live mode uses basicbit direct MP4. Timestamps do not prove audible output or phone background support.", runs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "mobile-playback-log.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
