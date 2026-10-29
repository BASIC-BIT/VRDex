import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { FavoriteButton } from "./ui/favorite-button";
import { InterestButton } from "./ui/interest-button";
import { planSaveState, togglePlanAction } from "@/lib/timeline/plan-actions";
import { reducePreferences, type TimelinePreferences } from "@/lib/timeline/preferences";

const event = { kind: "event", eventId: "orbit" } satisfies TimelinePreferences["plan"][number];
const set = { kind: "set", eventId: "orbit", slotId: "aurora" } satisfies TimelinePreferences["plan"][number];

function Controls({ initial = "empty" }: { initial?: "empty" | "saved" | "included" | "capacity" }) {
  const [preferences, setPreferences] = useState<TimelinePreferences>(() => ({
    version: 1,
    plan: initial === "included" ? [event] : initial === "saved" ? [set] : initial === "capacity"
      ? Array.from({ length: 200 }, (_, index) => ({ kind: "event", eventId: `full-${index}` })) : [],
    favoriteProfileIds: initial === "saved" ? ["aurora"] : initial === "capacity"
      ? Array.from({ length: 500 }, (_, index) => `full-${index}`) : [],
  }));
  const [attempts, setAttempts] = useState(0);
  const [outcome, setOutcome] = useState("");
  const [compact, setCompact] = useState(false);
  function favorite() {
    setAttempts((value) => value + 1);
    const result = reducePreferences(preferences, {
      type: preferences.favoriteProfileIds.includes("aurora") ? "remove-favorite" : "add-favorite",
      profileId: "aurora",
    });
    setPreferences(result.state);
    setOutcome(result.outcome);
  }
  function interest() {
    setAttempts((value) => value + 1);
    const action = togglePlanAction(preferences.plan, set);
    if (!action) return;
    const result = reducePreferences(preferences, action);
    setPreferences(result.state);
    setOutcome(result.outcome);
  }
  const pressed = preferences.favoriteProfileIds.includes("aurora");
  const state = planSaveState(preferences.plan, set);
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Aurora · ORBIT</h1>
      <a href="#controls">Open set</a>
      <div id="controls" className="flex items-center gap-3" aria-label="Set controls">
        <FavoriteButton label="Aurora" pressed={pressed} onToggle={favorite} size={compact ? "compact" : "default"} />
        <InterestButton label="Aurora at ORBIT" state={state} onToggle={interest} size={compact ? "compact" : "default"} />
      </div>
      <div className="flex items-center gap-3" aria-label="Synchronized controls">
        <FavoriteButton label="Aurora copy" pressed={pressed} onToggle={favorite} />
        <InterestButton label="Aurora at ORBIT copy" state={state} onToggle={interest} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setPreferences({ version: 1, plan: [set], favoriteProfileIds: ["aurora"] })}>Simulate other tab</button>
        <button onClick={() => setCompact((value) => !value)}>Change size</button>
        <button onClick={() => setPreferences({ version: 1, plan: [], favoriteProfileIds: [] })}>Reset</button>
      </div>
      <output aria-label="Toggle attempts">{attempts}</output>{" "}
      <output aria-label="Preference outcome">{outcome}</output>
    </main>
  );
}

const meta = { title: "Home/Preference controls", component: Controls } satisfies Meta<typeof Controls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Independent: Story = {};
export const Included: Story = { args: { initial: "included" } };
export const Selected: Story = { args: { initial: "saved" } };
export const Capacity: Story = { args: { initial: "capacity" } };
