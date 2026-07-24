"""Prompt formatting helpers for Temporal Plan-IR training and prediction."""

from __future__ import annotations

import json
from typing import Any


PROMPT_PRESETS = {
    "detailed": (
        "Translate the temporal user input into compact Temporal Plan-IR JSON. Return JSON only. "
        "For time ranges, set plan kind=time_range with startStep and endStep candidate steps; explicitly shift overnight end times. "
        "For explicit 24-hour clock text like 13:37, preserve that clock text exactly; do not append am or pm. "
        "For explicit timezone text, emit resolve_timezone and reference it with timeZoneStep. "
        "Use fixed offsets only for explicit UTC/GMT offsets. Return clarification for ambiguous timezone abbreviations. "
        "For Discord timestamps or bare 10/13/16/19 digit epoch-like numbers, pass the timestamp text to resolve_calendar_query. "
        "For negative or unsupported-length bare epoch-like numbers, return no_plan. "
        "For up to five repeated day-after modifiers before tomorrow, resolve tomorrow and emit one shift_datetime days delta equal to the repetition count; for longer chains return no_plan."
    ),
    "minimal": "Translate the temporal user input into compact Temporal Plan-IR JSON. Return JSON only.",
}

PROMPT_FORMATS = {"custom", "chat"}


def instruction_for_preset(preset: str) -> str:
    try:
        return PROMPT_PRESETS[preset]
    except KeyError as error:
        valid = ", ".join(sorted(PROMPT_PRESETS))
        raise ValueError(f"Unknown instruction preset {preset!r}. Expected one of: {valid}") from error


def format_prompt(row: dict[str, Any], instruction_preset: str) -> str:
    payload = input_payload(row)
    return (
        "### Instruction:\n"
        f"{instruction_for_preset(instruction_preset)}\n\n"
        "### Input:\n"
        f"{json.dumps(payload, sort_keys=True)}\n\n"
        "### Response:\n"
    )


def format_chat_user_content(row: dict[str, Any], instruction_preset: str) -> str:
    payload = input_payload(row)
    return (
        f"{instruction_for_preset(instruction_preset)}\n\n"
        "Input:\n"
        f"{json.dumps(payload, sort_keys=True)}"
    )


def format_inference_prompt(row: dict[str, Any], instruction_preset: str, prompt_format: str, tokenizer: Any, enable_thinking: bool) -> str:
    if prompt_format == "custom":
        return format_prompt(row, instruction_preset)
    if prompt_format != "chat":
        raise ValueError(f"Unknown prompt format {prompt_format!r}. Expected one of: {sorted(PROMPT_FORMATS)}")
    if not hasattr(tokenizer, "apply_chat_template"):
        raise ValueError("Chat prompt format requires a tokenizer/processor with apply_chat_template.")
    return tokenizer.apply_chat_template(
        [{"role": "user", "content": format_chat_user_content(row, instruction_preset)}],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=enable_thinking,
    )


def format_training_text(row: dict[str, Any], eos_token: str, instruction_preset: str) -> str:
    output = json.dumps(compact_output(row["output"]), sort_keys=True, separators=(",", ":"))
    return f"{format_prompt(row, instruction_preset)}{output}{eos_token}"


def format_training_chat_text(row: dict[str, Any], tokenizer: Any, instruction_preset: str) -> str:
    if not hasattr(tokenizer, "apply_chat_template"):
        raise ValueError("Chat prompt format requires a tokenizer/processor with apply_chat_template.")
    output = json.dumps(compact_output(row["output"]), sort_keys=True, separators=(",", ":"))
    return tokenizer.apply_chat_template(
        [
            {"role": "user", "content": format_chat_user_content(row, instruction_preset)},
            {"role": "assistant", "content": output},
        ],
        tokenize=False,
        add_generation_prompt=False,
        enable_thinking=False,
    )


def input_payload(row: dict[str, Any]) -> dict[str, Any]:
    input_row = row["input"]
    return {
        "text": input_row["text"],
        "referenceInstant": input_row["referenceInstant"],
        "timeZone": input_row["timeZone"],
    }


def compact_output(output: dict[str, Any]) -> dict[str, Any]:
    compact = {
        "outcome": output["outcome"],
        "reason": output.get("reason", ""),
        "plans": [compact_plan(plan) for plan in output.get("plans", [])],
    }
    if output.get("clarificationQuestion") is not None:
        compact["clarificationQuestion"] = output["clarificationQuestion"]
    return compact


def compact_plan(plan: dict[str, Any]) -> dict[str, Any]:
    compact = {
        "label": plan["label"],
        "steps": [compact_step(step) for step in plan.get("steps", [])],
    }
    if plan.get("kind") and plan.get("kind") != "instant":
        compact["kind"] = plan["kind"]
    if plan.get("rationale") and plan.get("rationale") != plan["label"]:
        compact["rationale"] = plan["rationale"]
    if plan.get("assumptions"):
        compact["assumptions"] = plan["assumptions"]
    if plan.get("confidence") is not None and plan.get("confidence") != 0.8:
        compact["confidence"] = plan["confidence"]
    if plan.get("finalStep") is not None:
        compact["finalStep"] = plan["finalStep"]
    if plan.get("startStep") is not None:
        compact["startStep"] = plan["startStep"]
    if plan.get("endStep") is not None:
        compact["endStep"] = plan["endStep"]
    return compact


def compact_step(step: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {"op": step["operation"]}
    for key in [
        "query",
        "text",
        "holidayName",
        "weekday",
        "weekdayAnchor",
        "year",
        "baseStep",
        "time",
        "timeStep",
        "timeZoneStep",
        "isoInstant",
        "epochSeconds",
        "timeZone",
        "precision",
    ]:
        if step.get(key) is not None:
            compact[key] = step[key]
    if step.get("assumptions"):
        compact["assumptions"] = step["assumptions"]
    delta = {key: value for key, value in step.get("delta", {}).items() if value is not None}
    if delta:
        compact["delta"] = delta
    return compact
