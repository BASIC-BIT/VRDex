import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";

import { VrcdnPlayerControls } from "./vrcdn-player-controls";

/**
 * The control strip only exists once a VRCDN stream is actually connected, and
 * neither CI nor the Playwright fixtures can reach that state -- the fixture
 * stream id resolves to nothing, and probing a real one spends a viewer slot
 * against an operator's capped plan.
 *
 * So the evidence comes from here instead. The component is presentational, so
 * every state it can render is reachable from props.
 */
const meta = {
  title: "Media/VRCDN player controls",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const noop = () => {};

function ControlsFrame({ children }: { children: ReactNode }) {
  // The strip is absolutely positioned against the player, and it sits over
  // video rather than a flat colour -- so the frame is what makes the gradient
  // and the contrast of the icons over it reviewable.
  return (
    <div className="bg-surface p-6">
      <div className="relative mx-auto aspect-video w-full max-w-2xl overflow-hidden rounded-control bg-[linear-gradient(135deg,#2b3a55,#8a93a5)]">
        {children}
      </div>
    </div>
  );
}

export const Playing: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        fullscreen={false}
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={0.8}
      />
    </ControlsFrame>
  ),
};

/** What a refused autoplay leaves behind: the strip offering play. */
export const Paused: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        fullscreen={false}
        muted
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused
        volume={0}
      />
    </ControlsFrame>
  ),
};

/** While fullscreen, the button has to announce the exit, not the entry. */
export const Fullscreen: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        fullscreen
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={0.4}
      />
    </ControlsFrame>
  ),
};
