"use client";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex-generated-api";
import { Field, Select } from "@/components/ui/field";
export type BroadcastChoices = FunctionReturnType<
  typeof api.events.getPersonBroadcastInputChoices
>;
type Input = BroadcastChoices[number]["input"];
function key(input: Input) {
  return input.kind === "vrcdn"
    ? `vrcdn:${input.streamId}`
    : `twitch:${input.channel}`;
}
export function SlotBroadcastInputSelect({
  value,
  choices,
  onChange,
}: {
  value: Input | null | undefined;
  choices: BroadcastChoices;
  onChange: (input: Input | null) => void;
}) {
  const selected = value ? key(value) : "";
  const unavailable =
    value && !choices.some((choice) => key(choice.input) === selected);
  return (
    <Field>
      Broadcast input
      <Select
        aria-label="Broadcast input"
        value={selected}
        onChange={(event) => {
          const choice = choices.find(
            (choice) => key(choice.input) === event.target.value,
          );
          if (choice) onChange(choice.input);
          else if (event.target.value === "") onChange(null);
        }}
      >
        <option value="">Automatic</option>
        {unavailable ? (
          <option value={selected}>{selected} (Unavailable)</option>
        ) : null}
        {choices.map((choice) => (
          <option key={choice.key} value={key(choice.input)}>
            {choice.input.kind === "twitch" ? "Twitch" : "VRCDN"} ·{" "}
            {choice.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
