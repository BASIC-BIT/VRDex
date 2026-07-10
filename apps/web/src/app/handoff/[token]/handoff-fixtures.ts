export type HandoffFixture = {
  preview?: unknown;
  viewerState?: "ready" | "signed_out" | "unverified_email";
  acceptResult?: unknown;
  loading?: boolean;
};

const readyPreview = {
  state: "ready",
  invitation: {
    expiresAt: Date.UTC(2027, 0, 15, 12, 0, 0),
  },
  preparedIdentity: {
    profileType: "person",
    displayName: "DJ Aurora",
    fields: [
      {
        id: "display-name",
        label: "Display name",
        value: "DJ Aurora",
      },
      {
        id: "bio",
        label: "About",
        value: "Melodic house sets for late-night VRChat floors.",
      },
    ],
    safeLinks: [
      {
        id: "soundcloud",
        label: "SoundCloud",
        value: "https://soundcloud.com/dj-aurora-example",
        kind: "link",
      },
      {
        id: "vrchat",
        label: "VRChat",
        value: "https://vrchat.com/home/user/usr_00000000-0000-4000-8000-000000000001",
        kind: "link",
      },
    ],
  },
};

export function getHandoffPlaywrightFixture(token: string): HandoffFixture | null {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    return null;
  }

  switch (token) {
    case "playwright-loading":
      return { loading: true };
    case "playwright-invalid":
      return { preview: { state: "invalid" }, viewerState: "signed_out" };
    case "playwright-expired":
      return { preview: { state: "expired" }, viewerState: "signed_out" };
    case "playwright-revoked":
      return { preview: { state: "revoked" }, viewerState: "signed_out" };
    case "playwright-accepted":
      return {
        preview: { state: "accepted", ownerDestination: "/p/playwright-dj-aurora" },
        viewerState: "ready",
      };
    case "playwright-signed-out":
      return { preview: readyPreview, viewerState: "signed_out" };
    case "playwright-unverified":
      return { preview: readyPreview, viewerState: "unverified_email" };
    case "playwright-ready":
      return {
        preview: readyPreview,
        viewerState: "ready",
        acceptResult: { ownerDestination: "/p/playwright-dj-aurora" },
      };
    default:
      return null;
  }
}
