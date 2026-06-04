import type { Preview } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";

import "../src/app/globals.css";
import "./preview.css";

const preview: Preview = {
  decorators: [
    (Story): ReactNode => (
      <div className="story-stage">
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: {
      test: "todo",
    },
    controls: {
      expanded: true,
    },
    layout: "fullscreen",
  },
};

export default preview;
