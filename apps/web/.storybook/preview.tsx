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
    // `PageNav` renders the nav search, which navigates with the App Router.
    // Without its mocks any story containing a nav throws before it paints.
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;
