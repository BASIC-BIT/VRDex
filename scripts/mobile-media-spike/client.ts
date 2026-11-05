// Throwaway device experiment. Uses the production MPEG-TS transport unchanged.
import mpegts from "mpegts.js";
import { attachVrcdnTransport, releaseVrcdnTransport } from "../../apps/web/src/lib/vrcdn-transport";

const video = document.querySelector("video");
const log = document.querySelector("pre");
const mode = document.querySelector("select");
if (!video || !log || !mode) throw new Error("Missing spike controls");
let transport: ReturnType<typeof attachVrcdnTransport> | undefined;
const entries: unknown[] = [];
function record(event: string) {
  if (!video || !log) return;
  entries.push({ event, at: new Date().toISOString(), time: video.currentTime,
    paused: video.paused, ready: video.readyState, visibility: document.visibilityState,
    error: video.error?.message });
  log.textContent = JSON.stringify(entries.slice(-40), null, 2);
}
for (const event of ["playing", "pause", "waiting", "stalled", "error", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) video.addEventListener(event, () => record(event));
document.addEventListener("visibilitychange", () => record("visibilitychange"));
setInterval(() => record("sample"), 5000);
async function start() {
  if (!video || !mode) return;
  if (transport) releaseVrcdnTransport(transport);
  transport = undefined;
  video.pause(); video.removeAttribute("src"); video.load();
  if (mode.value === "ts") {
    transport = attachVrcdnTransport(mpegts, video, "/transport", { onError: () => record("transport-error") });
  } else {
    if (!video.canPlayType("application/vnd.apple.mpegurl")) {
      record("native-hls-unavailable"); return;
    }
    video.src = mode.value === "audio" ? "/media/audio.m3u8" : "/media/video.m3u8";
  }
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: "VRDex mobile experiment", artist: mode.value });
    navigator.mediaSession.setActionHandler("play", () => { void video.play().catch(() => record("play-rejected")); });
    navigator.mediaSession.setActionHandler("pause", () => video.pause());
  }
  await video.play();
}
document.querySelector("#play")?.addEventListener("click", () => { void start().catch(() => record("start-rejected")); });
document.querySelector("#pip")?.addEventListener("click", () => {
  if (!video) return;
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    void video.requestPictureInPicture().catch(() => record("pip-rejected"));
  } else if ("webkitSetPresentationMode" in video && typeof video.webkitSetPresentationMode === "function") {
    video.webkitSetPresentationMode("picture-in-picture");
  } else record("pip-api-unavailable-try-native-fullscreen");
});
document.querySelector("#download")?.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ userAgent: navigator.userAgent, secure: isSecureContext, entries }, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "mobile-media-evidence.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
record("ready");
