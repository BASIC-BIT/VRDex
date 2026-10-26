/** @typedef {keyof typeof VIDEO_PROFILES} VideoPreset */
/** @typedef {{videoPreset: VideoPreset, audioBitrateKbps: 160|320}} MediaSettings */
export const VIDEO_PROFILES = Object.freeze({
    '480p30': Object.freeze({ width: 854, height: 480, frameRate: 30, videoBitrateKbps: 1000 }),
    '480p60': Object.freeze({ width: 854, height: 480, frameRate: 60, videoBitrateKbps: 1500 }),
    '720p30': Object.freeze({ width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 1800 }),
    '720p60': Object.freeze({ width: 1280, height: 720, frameRate: 60, videoBitrateKbps: 2500 }),
    '1080p30': Object.freeze({ width: 1920, height: 1080, frameRate: 30, videoBitrateKbps: 3000 }),
    '1080p60': Object.freeze({ width: 1920, height: 1080, frameRate: 60, videoBitrateKbps: 3500 }),
});
/** @type {Readonly<MediaSettings>} */
export const NEW_PROGRAM_MEDIA_SETTINGS = Object.freeze({ videoPreset: '720p30', audioBitrateKbps: 320 });
/** @type {Readonly<MediaSettings>} */
export const LEGACY_PROGRAM_MEDIA_SETTINGS = Object.freeze({
  videoPreset: "720p30",
  audioBitrateKbps: 160,
});
export const DEFAULT_INPUT_QUALITY = Object.freeze({
  width: 1280,
  height: 720,
  frameRate: 30,
});
export const BROADCAST_ENCODING = Object.freeze({
  videoCodec: "libx264",
  videoThreads: "2",
  normalPreset: "veryfast",
  highRatePreset: "superfast",
  highRateVideoPreset: "1080p60",
  pixelFormat: "yuv420p",
  sceneThreshold: "0",
  bFrames: "0",
  vbvMultiplier: 2,
  x264Params: "nal-hrd=cbr:force-cfr=1",
  audioCodec: "aac",
  audioSampleRateText: "48000",
  audioChannelsText: "2",
  programTune: "zerolatency",
  programMuxFlags: "+resend_headers",
  programMuxDelay: "0",
  programMux: "mpegts",
  outputMux: "flv",
  twitchAudioBitrateText: "160k",
});
export const PROGRAM_HOLD_FRAME = Object.freeze({
  chromaFill: 128,
  backgroundLuma: 32,
  rectangleLuma: 80,
  rectangleStartDivisor: 3,
  rectangleEndMultiplier: 2,
  rectangleEndDivisor: 3,
});
/** Legacy rows have no settings. All other inputs must be complete and valid.
 * @param {unknown} value
 * @returns {MediaSettings}
 */
export function parseMediaSettings(value) {
    if (value === undefined) return { videoPreset: '720p30', audioBitrateKbps: 160 };
    if (!value || typeof value !== 'object' || !('videoPreset' in value) || !('audioBitrateKbps' in value)) throw Error('Invalid media settings');
    const { videoPreset, audioBitrateKbps } = value;
    if (!(videoPreset === '480p30' || videoPreset === '480p60' || videoPreset === '720p30' || videoPreset === '720p60' || videoPreset === '1080p30' || videoPreset === '1080p60')) throw Error('Unsupported video quality');
    if (audioBitrateKbps !== 160 && audioBitrateKbps !== 320) throw Error('Unsupported audio bitrate');
    return { videoPreset, audioBitrateKbps };
}
/** @param {{settings?: unknown, destination: 'vrcdn'|'twitch'}} input */
export function resolveDestinationProfile({ settings, destination }) {
    if (destination !== 'vrcdn' && destination !== 'twitch') throw Error('Unsupported destination');
    const parsed = parseMediaSettings(settings);
    return Object.freeze({ videoPreset: parsed.videoPreset, ...VIDEO_PROFILES[parsed.videoPreset], audioBitrateKbps: destination === 'twitch' ? 160 : parsed.audioBitrateKbps, audioChannels: 2, audioSampleRateHz: 48000, keyframeIntervalSeconds: destination === 'twitch' ? 2 : 1 });
}
