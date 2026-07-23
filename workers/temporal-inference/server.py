#!/usr/bin/env python3
"""Narrow VRDex Temporal Plan-IR inference service."""

from __future__ import annotations

import hmac
import json
import os
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from temporal_ir_prompts import format_chat_user_content


class ModelState:
    def __init__(self) -> None:
        self.ready = False
        self.error: str | None = None
        self.generator: TemporalGenerator | None = None
        self.lock = threading.Lock()
        self.model_revision = model_revision_label()


class TemporalGenerator:
    def __init__(self) -> None:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer

        base_model = required_env("TEMPORAL_BASE_MODEL")
        base_revision = required_env("TEMPORAL_BASE_MODEL_REVISION")
        adapter_model = required_env("TEMPORAL_ADAPTER_MODEL")
        adapter_revision = required_env("TEMPORAL_ADAPTER_REVISION")
        token = os.environ.get("HF_TOKEN")

        self.tokenizer = AutoTokenizer.from_pretrained(
            adapter_model,
            revision=adapter_revision,
            token=token,
            trust_remote_code=False,
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        base = AutoModelForCausalLM.from_pretrained(
            base_model,
            revision=base_revision,
            token=token,
            device_map="auto",
            attn_implementation="eager",
            dtype=torch.bfloat16,
            trust_remote_code=False,
        )
        self.model = PeftModel.from_pretrained(
            base,
            adapter_model,
            revision=adapter_revision,
            token=token,
        )
        self.model.eval()
        self._prewarm()

    def _prewarm(self) -> None:
        self.generate(
            text="tomorrow at noon",
            reference_instant="2026-01-01T00:00:00Z",
            time_zone="UTC",
        )

    def generate(self, *, text: str, reference_instant: str, time_zone: str) -> tuple[dict[str, Any], int]:
        import torch

        row = {
            "input": {
                "text": text,
                "referenceInstant": reference_instant,
                "timeZone": time_zone,
            }
        }
        user_content = format_chat_user_content(row, "minimal")
        prompt = self.tokenizer.apply_chat_template(
            [{"role": "user", "content": user_content}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = self.tokenizer([prompt], return_tensors="pt").to(self.model.device)
        started = time.perf_counter()
        with torch.inference_mode():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=False,
                eos_token_id=self.tokenizer.eos_token_id,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        duration_ms = round((time.perf_counter() - started) * 1000)
        prompt_tokens = inputs["input_ids"].shape[-1]
        completion = self.tokenizer.decode(
            generated[0][prompt_tokens:],
            skip_special_tokens=True,
        ).strip()
        return parse_json_object(completion), duration_ms


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def model_revision_label() -> str:
    model = os.environ.get("TEMPORAL_SERVED_MODEL_NAME", "qwen-temporal-ir")
    base = os.environ.get("TEMPORAL_BASE_MODEL_REVISION", "unconfigured")
    adapter = os.environ.get("TEMPORAL_ADAPTER_REVISION", "unconfigured")
    return f"{model}@base:{base}/adapter:{adapter}"


def parse_json_object(value: str) -> dict[str, Any]:
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```")
        stripped = stripped.removesuffix("```").strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        if start < 0:
            raise ValueError("Model output did not contain a JSON object.")
        depth = 0
        in_string = False
        escaped = False
        end = None
        for index, char in enumerate(stripped[start:], start=start):
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end is None:
            raise ValueError("Model output JSON was not balanced.")
        parsed = json.loads(stripped[start:end])
    if not isinstance(parsed, dict):
        raise ValueError("Model output must be a JSON object.")
    return parsed


def validate_inference_payload(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("Request body must be an object.")
    expected = {"text", "referenceInstant", "timeZone"}
    if set(payload) != expected:
        raise ValueError("Request must contain only text, referenceInstant, and timeZone.")
    text = payload["text"]
    reference_value = payload["referenceInstant"]
    time_zone_value = payload["timeZone"]
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
        raise ValueError("text must contain 1 to 500 characters.")
    if not isinstance(reference_value, str) or not reference_value.strip():
        raise ValueError("referenceInstant must be a non-empty string.")
    if not isinstance(time_zone_value, str) or not time_zone_value.strip():
        raise ValueError("timeZone must be a non-empty string.")
    reference_instant = reference_value.strip()
    time_zone = time_zone_value.strip()
    if len(reference_instant) > 64:
        raise ValueError("referenceInstant is too long.")
    try:
        parsed_reference = datetime.fromisoformat(reference_instant.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("referenceInstant must be an ISO 8601 timestamp.") from error
    if parsed_reference.tzinfo is None:
        raise ValueError("referenceInstant must include an offset.")
    if len(time_zone) > 100:
        raise ValueError("timeZone is too long.")
    try:
        ZoneInfo(time_zone)
    except ZoneInfoNotFoundError as error:
        raise ValueError("timeZone must be a valid IANA timezone.") from error
    return {
        "text": text.strip(),
        "referenceInstant": reference_instant,
        "timeZone": time_zone,
    }

def load_model(state: ModelState) -> None:
    try:
        state.generator = TemporalGenerator()
        state.ready = True
    except Exception as error:  # noqa: BLE001 - startup state must remain observable.
        state.error = type(error).__name__
        state.ready = False


def create_handler(state: ModelState) -> type[BaseHTTPRequestHandler]:
    auth_token = required_env("TEMPORAL_INFERENCE_AUTH_TOKEN")

    class Handler(BaseHTTPRequestHandler):
        server_version = "VRDexTemporal/0.1"

        def do_GET(self) -> None:
            if self.path not in {"/ping", "/ready"}:
                self.write_json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
                return
            if self.path == "/ready" and not self.authorized(auth_token):
                self.write_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            if state.ready:
                self.write_json({
                    "status": "ready",
                    "modelRevision": state.model_revision,
                })
                return
            if state.error is not None:
                self.write_json({"status": "failed"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("cache-control", "no-store")
            self.end_headers()

        def do_POST(self) -> None:
            if self.path != "/infer":
                self.write_json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
                return
            if not self.authorized(auth_token):
                self.write_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            if state.error is not None:
                self.write_json(
                    {"error": "model_startup_failed"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            if not state.ready or state.generator is None:
                self.write_json(
                    {"error": "model_warming", "retryAfterSeconds": 2},
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"retry-after": "2"},
                )
                return
            try:
                payload = self.read_request()
                with state.lock:
                    plan, duration_ms = state.generator.generate(
                        text=payload["text"],
                        reference_instant=payload["referenceInstant"],
                        time_zone=payload["timeZone"],
                    )
                self.write_json({
                    "plan": plan,
                    "modelRevision": state.model_revision,
                    "inferenceLatencyMs": duration_ms,
                })
            except ValueError as error:
                self.write_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            except Exception:  # noqa: BLE001 - never expose model or provider details.
                self.write_json(
                    {"error": "inference_failed"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )

        def authorized(self, token: str) -> bool:
            value = self.headers.get("authorization", "")
            return hmac.compare_digest(value, f"Bearer {token}")

        def read_request(self) -> dict[str, str]:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("Request body must be between 1 and 4096 bytes.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            return validate_inference_payload(payload)

        def write_json(
            self,
            body: dict[str, Any],
            status: HTTPStatus = HTTPStatus.OK,
            headers: dict[str, str] | None = None,
        ) -> None:
            encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.send_header("cache-control", "no-store")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args: object) -> None:
            # Intentionally exclude request bodies and authorization headers.
            print(f"{self.command} {self.path} {format % args}")

    return Handler


def main() -> None:
    state = ModelState()
    threading.Thread(target=load_model, args=(state,), daemon=True).start()
    host = os.environ.get("TEMPORAL_INFERENCE_HOST", "0.0.0.0")
    port = int(os.environ.get("TEMPORAL_INFERENCE_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), create_handler(state))
    print(f"VRDex Temporal listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
