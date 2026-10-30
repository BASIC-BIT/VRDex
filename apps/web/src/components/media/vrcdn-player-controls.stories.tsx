import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, type ReactNode } from "react";

import { VrcdnPlayerControls } from "./vrcdn-player-controls";

/** Presentation states remain useful independently of the real synthetic MPEG-TS
 * continuity fixture in event-persistent-playback.flow.spec.ts. */
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
        connected
        fullscreen={false}
        label="VRCDN stream"
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={0.8}
        volumeSettable
      />
    </ControlsFrame>
  ),
};

/** What a refused autoplay leaves behind: the strip offering play. */
export const Paused: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        connected
        fullscreen={false}
        label="VRCDN stream"
        muted
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused
        volume={0}
        volumeSettable
      />
    </ControlsFrame>
  ),
};

/** While fullscreen, the button has to announce the exit, not the entry. */
export const Fullscreen: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        connected
        fullscreen
        label="VRCDN stream"
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={0.4}
        volumeSettable
      />
    </ControlsFrame>
  ),
};

/**
 * iOS Safari refuses programmatic volume, so the slider is withheld there
 * rather than shown dragging and changing nothing. Mute still works.
 */
export const WithoutVolumeSlider: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        connected
        fullscreen={false}
        label="VRCDN stream"
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={1}
        volumeSettable={false}
      />
    </ControlsFrame>
  ),
};

/**
 * Between the press and the first frame. `LIVE` is a claim about the stream,
 * and pressing play only records the click -- the event surface can offer a
 * player for a stream that is not publishing at all.
 */
export const Connecting: Story = {
  render: () => (
    <ControlsFrame>
      <VrcdnPlayerControls
        connected={false}
        fullscreen={false}
        label="VRCDN stream"
        muted={false}
        onToggleFullscreen={noop}
        onToggleMute={noop}
        onTogglePlay={noop}
        onVolumeChange={noop}
        paused={false}
        volume={0.8}
        volumeSettable
      />
    </ControlsFrame>
  ),
};

function NativeControls({ audio = false }: { audio?: boolean }) {
  const [mode, setMode] = useState<"video" | "audio">(audio ? "audio" : "video");
  const [pip, setPip] = useState(false);
  return <ControlsFrame>
    {mode === "audio" && <div className="flex h-full items-center justify-center bg-media text-white/70"><span className="text-5xl" aria-hidden="true">♫</span></div>}
    <VrcdnPlayerControls label="DJ Aurora" connected fullscreen={false} muted={false} paused={false} volume={0.8} volumeSettable mode={mode} onModeChange={setMode} pipSupported pipActive={pip} onTogglePip={() => setPip(!pip)} onToggleFullscreen={noop} onToggleMute={noop} onTogglePlay={noop} onVolumeChange={noop} />
  </ControlsFrame>;
}
export const NativeVideo: Story = { render: () => <NativeControls /> };
export const AudioOnly: Story = { render: () => <NativeControls audio /> };
