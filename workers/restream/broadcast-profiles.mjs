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
