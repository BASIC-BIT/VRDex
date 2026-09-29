import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Card } from "./ui/card";
import { Notice } from "./ui/notice";
import { MediaReviewComparison } from "./media-review-comparison";

const current = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Crect width='640' height='640' fill='%2325384d'/%3E%3Ccircle cx='320' cy='320' r='180' fill='%2389a9c8'/%3E%3C/svg%3E";
const candidate = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Crect width='640' height='640' fill='%231b4538'/%3E%3Cpath d='M120 420L320 120l200 300z' fill='%237dd3a8'/%3E%3C/svg%3E";

const meta = {
  title: "Account/Media review comparison",
  component: MediaReviewComparison,
  decorators: [(Story) => <div className="mx-auto max-w-5xl p-6"><Card><Story /><Notice className="mt-5" variant="warning">Review changed. Inspect the current images before deciding again.</Notice></Card></div>],
  args: {
    candidateAlt: "Candidate for Fixture profile",
    candidateSrc: candidate,
    currentAlt: "Current image for Fixture profile",
    currentSrc: current,
  },
} satisfies Meta<typeof MediaReviewComparison>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Comparison: Story = {};
