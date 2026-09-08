import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProfileFields } from "@/app/_components/profile-fields";
import { Button } from "@/components/ui/button";
import { ProfilePublicPage } from "@/app/_components/profile-public-page";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ProfileHistory } from "@/app/_components/profile-private-record";
import { ProfileVrcdnStreams } from "@/app/_components/profile-vrcdn-streams";
import { parseProfileLinkDestination } from "../../../../convex/_profileLinkDestination";
import type { ProfileLinkInput } from "@/app/_components/profile-fields-model";

const destinationLinks: ProfileLinkInput[] = [
  { type: "vrchat_profile", url: "https://vrchat.com/home/user/usr_00000000-0000-0000-0000-000000000001", label: "VRChat" },
  { type: "other", url: "https://vrchat.com/home/group/grp_00000000-0000-0000-0000-000000000001", label: "VRChat group" },
  { type: "other", url: "https://vrchat.com/home/group/grp_00000000-0000-0000-0000-000000000002", label: "VRChat group" },
  { type: "other", url: "https://vrchat.com/home/group/grp_00000000-0000-0000-0000-000000000003", label: "VRChat group" },
  { type: "discord", url: "https://discord.gg/example", label: "Discord" },
].map((link, index) => {
  const target = parseProfileLinkDestination(link)!;
  return {
    ...link, type: link.type as ProfileLinkInput["type"], labelMode: "automatic",
    destination: {
      targetKey: target.key, kind: target.kind, status: "resolved",
      name: ["Sloth", "Velvet Circuit", "Solaris", "A very long community name that wraps comfortably on a small screen", "The Green Room"][index],
      artworkUrl: ["/test-media/profile-image.png", "/seed/fixture-avatar-velvet-circuit.svg", "/seed/fixture-avatar-solaris.svg", undefined, "/missing-destination-artwork.png"][index],
    },
  };
});

const previewClient = new ConvexReactClient("http://127.0.0.1:1", { skipConvexDeploymentUrlCheck: true });
const usePreviewAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken: async () => null });
const meta = {title:"Profiles/Profile editor",parameters:{layout:"padded"}} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Links: Story = {render:()=> (
  <form className="mx-auto grid max-w-2xl gap-6" onSubmit={(event)=>event.preventDefault()}>
    <h1 className="text-2xl font-semibold">Edit profile</h1>
    <ProfileFields showNarrativeFields profileType="person" editableFields={["aliases", "timezone", "person", "outboundLinks"]} defaults={{displayName:"Example DJ", timezone:"UTC", roleTags:["DJ"], aliases:["Foo, Jr."], links:[
      {type:"soundcloud",url:"https://soundcloud.com/example",label:"SoundCloud"},
      {type:"website",url:"https://example.com",label:"My sets"},
    ]}} />
    <Button type="submit">Save changes</Button>
  </form>
)};

export const TwitchProfile: Story = {
  render: () => <ConvexProviderWithAuth client={previewClient} useAuth={usePreviewAuth}><ProfilePublicPage mediaKitGalleryEnabled={true} profile={{
    profileType: "person",
    slug: "example-dj",
    displayName: "Example DJ",
    aliases: [],
    tags: [],
    genres: [],
    trustLabel: "claimed_unverified",
    person: { roleTags: ["DJ"] },
    outboundLinks: [{ type: "twitch", url: "https://twitch.tv/example", label: "Twitch", source: "owner_authored" }],
    worldCredits: [],
    upcomingEvents: [],
    hostedEvents: [],
  }} /></ConvexProviderWithAuth>,
};

export const History: Story = {
  render: () => <div className="mx-auto max-w-2xl">
    <ProfileHistory history={[{ id: "example", action: "profile_updated", actor: "Example DJ", createdAt: 1788739200000 }]} />
  </div>,
};

export const EmbeddedPreview: Story = {
  render: () => <ConvexProviderWithAuth client={previewClient} useAuth={usePreviewAuth}>
    <main className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-semibold">Edit profile</h1>
      <section aria-label="Preview" className="border border-border">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg font-semibold">Preview</h2>
          <Button type="button">Close preview</Button>
        </div>
        <ProfilePublicPage embedded mediaKitGalleryEnabled={true} profile={{
          profileType: "person", slug: "example-dj", displayName: "Example DJ",
          aliases: [], tags: [], genres: [], trustLabel: "claimed_unverified",
          person: { roleTags: ["DJ"] },
          outboundLinks: [{ type: "twitch", url: "https://twitch.tv/example", label: "Twitch", source: "owner_authored" }],
          worldCredits: [], upcomingEvents: [], hostedEvents: [],
        }} />
      </section>
    </main>
  </ConvexProviderWithAuth>,
};

export const Playback: Story = {
  render: () => <ProfileVrcdnStreams profileSlug="example" discordHandles={[]} links={[]}
    streams={[{ claimable: false, key: "example", label: "VRCDN", streamId: "example",
      previewUrl: "https://panel.vrcdn.live/preview/example", pcUrl: "rtspt://stream.vrcdn.live/live/example",
      questUrl: "https://stream.vrcdn.live/live/example.live.ts" }]} />,
};

export const DestinationNames: Story = {
  render: () => <ConvexProviderWithAuth client={previewClient} useAuth={usePreviewAuth}>
    <ProfilePublicPage embedded mediaKitGalleryEnabled={true} profile={{
      profileType: "person", slug: "sloth", displayName: "Sloth", aliases: [], tags: [], genres: [],
      trustLabel: "claimed_unverified", person: { roleTags: ["DJ"] },
      outboundLinks: destinationLinks.map((link) => ({ ...link, label: link.label ?? "", presentation: undefined, source: "owner_authored" })),
      worldCredits: [], upcomingEvents: [], hostedEvents: [],
    }} />
  </ConvexProviderWithAuth>,
};

export const DestinationEditor: Story = {
  render: () => <form className="mx-auto grid max-w-2xl gap-6" onSubmit={(event) => event.preventDefault()}>
    <h1 className="text-2xl font-semibold">Edit profile</h1>
    <ProfileFields profileType="person" editableFields={["outboundLinks"]} defaults={{
      links: destinationLinks.map((link, index) => index === 4
        ? { ...link, label: "Join our server", labelMode: "custom", destination: { ...link.destination!, status: "invalid", name: undefined, artworkUrl: undefined } }
        : link),
    }} />
    <Button type="submit">Save changes</Button>
  </form>,
};

