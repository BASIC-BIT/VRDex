import type { EventMediaPublicLinkInput } from "./_eventMediaControl";

type VrcdnOutputAccount = {
  key: string;
  label: string;
  credentialRef: string;
  playbackLinks: EventMediaPublicLinkInput[];
};

export type PublicVrcdnOutputAccount = Omit<VrcdnOutputAccount, "credentialRef">;

const vrcdnOutputAccounts: VrcdnOutputAccount[] = [
  {
    key: "basicbit",
    label: "basicbit",
    credentialRef: "event-media/vrcdn/basicbit-output",
    playbackLinks: [
      { platform: "browser", label: "Event stream", url: "https://panel.vrcdn.live/preview/basicbit" },
      { platform: "standalone", label: "Quest stream", url: "https://stream.vrcdn.live/live/basicbit.live.ts" },
      { platform: "pc", label: "PC stream", url: "rtspt://stream.vrcdn.live/live/basicbit" },
    ],
  },
];

export function getVrcdnOutputAccount(key: string): VrcdnOutputAccount | undefined {
  return vrcdnOutputAccounts.find((account) => account.key === key);
}

export function listPublicVrcdnOutputAccounts(): PublicVrcdnOutputAccount[] {
  return vrcdnOutputAccounts.map((account) => ({
    key: account.key,
    label: account.label,
    playbackLinks: account.playbackLinks,
  }));
}
