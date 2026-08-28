import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProfileMediaContributionEditorView } from "@/app/_components/profile-media-contribution-editor";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

const meta = {
  title: "Profiles/Media Contribution Editor",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  render: () => (
    <PageShell className="py-10">
      <PageContainer max="3xl">
        <h1 className="text-3xl font-semibold">Edit profile</h1>
        <div className="mt-8">
          <ProfileMediaContributionEditorView />
        </div>
      </PageContainer>
    </PageShell>
  ),
};
