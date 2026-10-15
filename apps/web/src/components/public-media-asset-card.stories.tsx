import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { PublicProfileMediaDetails } from "@vrdex/api-contracts";
import { PublicMediaAssetCard, PublicMediaAssetCardView } from "@/app/_components/public-media-asset-card";

const asset = {
  detailsUrl: "/aurora#media-synthetic-portrait",
  assetId: "synthetic-portrait", label: "Aurora press portrait", altText: "Synthetic portrait artwork",
  credit: "Shared by Karly", creditUrl: "https://example.invalid/source", mimeType: "image/png", byteSize: 184000,
  imageUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'%3E%3Crect width='640' height='480' fill='%2325384d'/%3E%3Ccircle cx='320' cy='240' r='150' fill='%2389a9c8'/%3E%3C/svg%3E", downloadUrl: "https://example.invalid/portrait.png",
};
const uploader = { displayName: "BASICBIT", profileSlug: "basicbit", profileUrl: "/basicbit" };
const publisher = { displayName: "Aurora", profileSlug: "aurora", profileUrl: "/aurora" };
const details: PublicProfileMediaDetails = {
  profileSlug: "aurora", asset, referenceUrl: asset.creditUrl, credit: asset.credit, uploadedBy: uploader,
  history: [{ kind: "uploaded", at: Date.UTC(2026, 9, 1, 12, 30), actor: uploader }, { kind: "approved", at: Date.UTC(2026, 9, 2, 14), actor: publisher }, { kind: "published", at: Date.UTC(2026, 9, 2, 14), actor: publisher }],
};
const meta = {
  title: "Public/Media asset card", component: PublicMediaAssetCardView,
  decorators: [(Story) => <div className="mx-auto max-w-md p-4"><Story /></div>],
  args: { asset, label: "Media", open: false, state: { kind: "closed" } },
} satisfies Meta<typeof PublicMediaAssetCardView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Collapsed: Story = {};
export const Expanded: Story = { args: { open: true, state: { kind: "ready", details } } };
export const Loading: Story = { args: { open: true, state: { kind: "loading" } } };
export const Unavailable: Story = { args: { open: true, state: { kind: "unavailable" } } };
export const MissingActor: Story = { args: { open: true, state: { kind: "ready", details: { ...details, uploadedBy: null, history: [{ kind: "uploaded", at: null, actor: null }] } } } };
export const UnsafeSource: Story = { args: { asset: { ...asset, creditUrl: "javascript:alert(1)" } } };


export const NoDestination: Story = {
  args: { asset: { ...asset, detailsUrl: undefined } },
  render: args => <PublicMediaAssetCard asset={args.asset} label={args.label} />,
};
export const InvalidDestination: Story = {
  args: { asset: { ...asset, detailsUrl: "/aurora#media-other-asset" } },
  render: args => <PublicMediaAssetCard asset={args.asset} label={args.label} />,
};
export const Connected: Story = {
  render: args => <PublicMediaAssetCard asset={args.asset} label={args.label} />,
};
