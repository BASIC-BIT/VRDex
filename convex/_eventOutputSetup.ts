import { v } from 'convex/values';
import { sanitizeVrcdnOperatorOwnedOutputSetup, type VrcdnOperatorOwnedOutputSetupInput } from './_eventMediaControl';
export const twitchSetupValidator = v.object({ channel: v.string(), profile: v.literal('twitch-conservative-720p30') });
export const outputHealthValidator = v.object({ outputId: v.id('eventMediaOutputs'), destination: v.union(v.literal('vrcdn'), v.literal('twitch')), status: v.union(...(['idle', 'connecting', 'publishing', 'reconnecting', 'invalid_setup', 'stopped'] as const).map(s => v.literal(s))), publishing: v.boolean(), queueBytes: v.number(), outputMs: v.number(), restarts: v.number() });
export function sanitizeTwitchOutput(input: VrcdnOperatorOwnedOutputSetupInput & {
    channel: string;
    simulcastEnabled?: boolean;
}) {
    const base = sanitizeVrcdnOperatorOwnedOutputSetup(input);
    const channel = input.channel.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(channel))
        throw Error('Invalid Twitch channel.');
    const { vrcdnSetup: _, ...common } = base;
    return { ...common, type: 'external_rtmp' as const, twitchSetup: { channel, profile: 'twitch-conservative-720p30' as const }, simulcastEnabled: input.simulcastEnabled === true, playbackLinks: [{ platform: 'browser' as const, label: 'Twitch', url: `https://www.twitch.tv/${channel}` }] };
}
// Deployment-owned, reference-only registry. Empty by default; no provider pool.
export function getTwitchOutputAccount(key: string) {
    let entries: unknown;
    try {
        entries = JSON.parse(process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON ?? '[]');
    }
    catch {
        throw Error('Invalid Twitch account configuration.');
    }
    if (!Array.isArray(entries) || entries.length > 32)
        throw Error('Invalid Twitch account configuration.');
    const item = entries.find(item => item?.key === key);
    if (!item || typeof item.credentialRef !== 'string' || typeof item.channel !== 'string' || Object.keys(item).some(k => !['key', 'channel', 'credentialRef'].includes(k)))
        throw Error('Output account is not configured.');
    return { credentialRef: item.credentialRef as string, channel: item.channel as string };
}
