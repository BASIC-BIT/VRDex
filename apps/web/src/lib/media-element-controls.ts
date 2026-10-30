/** Probe only an unattached element. iOS uses hardware volume, including desktop-UA iPads. */
export function mediaVolumeSettable(media: HTMLMediaElement): boolean {
  if (typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  const original = media.volume;
  try { media.volume = 0.5; const supported = media.volume === 0.5; media.volume = original; return supported; }
  catch { return false; }
}
export function pictureInPictureState(video: HTMLVideoElement | null) {
  const webkit = video && "webkitSupportsPresentationMode" in video && typeof video.webkitSupportsPresentationMode === "function" && video.webkitSupportsPresentationMode("picture-in-picture");
  return {
    supported: Boolean(video && ((document.pictureInPictureEnabled && video.requestPictureInPicture) || webkit)),
    active: Boolean(video && (document.pictureInPictureElement === video || ("webkitPresentationMode" in video && video.webkitPresentationMode === "picture-in-picture"))),
  };
}
export async function togglePictureInPicture(video: HTMLVideoElement) {
  if (document.pictureInPictureElement === video) return document.exitPictureInPicture();
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) return video.requestPictureInPicture();
  if ("webkitSetPresentationMode" in video && typeof video.webkitSetPresentationMode === "function") {
    video.webkitSetPresentationMode("webkitPresentationMode" in video && video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
  }
}
