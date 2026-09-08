import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProfileFields } from "@/app/_components/profile-fields";
import { Button } from "@/components/ui/button";
import { ProfilePublicPage } from "@/app/_components/profile-public-page";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ProfileHistory } from "@/app/_components/profile-private-record";
import { ProfileVrcdnStreams } from "@/app/_components/profile-vrcdn-streams";

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

export const Playback: Story = {
  render: () => <ProfileVrcdnStreams profileSlug="example" discordHandles={[]} links={[]}
    streams={[{ claimable: false, key: "example", label: "VRCDN", streamId: "example",
      previewUrl: "https://panel.vrcdn.live/preview/example", pcUrl: "rtspt://stream.vrcdn.live/live/example",
      questUrl: "https://stream.vrcdn.live/live/example.live.ts" }]} />,
};

