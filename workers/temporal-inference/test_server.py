from __future__ import annotations

import os
import sys
import unittest
from http import HTTPStatus
from pathlib import Path
from types import MethodType
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import (
    ModelState,
    create_handler,
    model_revision_label,
    parse_json_object,
    required_env,
    validate_inference_payload,
)


class TemporalInferenceWorkerTests(unittest.TestCase):
    def test_parses_plain_fenced_and_embedded_json_objects(self) -> None:
        expected = {"outcome": "no_plan", "plans": []}
        self.assertEqual(parse_json_object('{"outcome":"no_plan","plans":[]}'), expected)
        self.assertEqual(
            parse_json_object('```json\n{"outcome":"no_plan","plans":[]}\n```'),
            expected,
        )
        self.assertEqual(
            parse_json_object('analysis omitted {"message":"brace } in string","plans":[]} trailing'),
            {"message": "brace } in string", "plans": []},
        )

    def test_rejects_non_object_and_unbalanced_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON object"):
            parse_json_object("[]")
        with self.assertRaisesRegex(ValueError, "balanced"):
            parse_json_object('prefix {"plans": []')

    def test_validates_the_narrow_inference_contract(self) -> None:
        self.assertEqual(
            validate_inference_payload({
                "text": "  tomorrow at noon  ",
                "referenceInstant": "2026-07-22T12:00:00Z",
                "timeZone": "America/Indianapolis",
            }),
            {
                "text": "tomorrow at noon",
                "referenceInstant": "2026-07-22T12:00:00Z",
                "timeZone": "America/Indianapolis",
            },
        )
        with self.assertRaisesRegex(ValueError, "only text"):
            validate_inference_payload({
                "text": "tomorrow",
                "referenceInstant": "2026-07-22T12:00:00Z",
                "timeZone": "UTC",
                "prompt": "override",
            })
        with self.assertRaisesRegex(ValueError, "include an offset"):
            validate_inference_payload({
                "text": "tomorrow",
                "referenceInstant": "2026-07-22T12:00:00",
                "timeZone": "UTC",
            })
        with self.assertRaisesRegex(ValueError, "valid IANA timezone"):
            validate_inference_payload({
                "text": "tomorrow",
                "referenceInstant": "2026-07-22T12:00:00Z",
                "timeZone": "Eastern",
            })
    def test_requires_immutable_worker_configuration_values(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "TEMPORAL_BASE_MODEL is required"):
                required_env("TEMPORAL_BASE_MODEL")
            self.assertEqual(
                model_revision_label(),
                "qwen-temporal-ir@base:unconfigured/adapter:unconfigured",
            )
        with patch.dict(os.environ, {"TEMPORAL_BASE_MODEL": "  model/repo  "}, clear=True):
            self.assertEqual(required_env("TEMPORAL_BASE_MODEL"), "model/repo")

    def test_infer_reports_permanent_model_startup_failure(self) -> None:
        state = ModelState()
        state.error = "RuntimeError"
        responses: list[tuple[dict[str, object], HTTPStatus, dict[str, str] | None]] = []
        with patch.dict(
            os.environ,
            {"TEMPORAL_INFERENCE_AUTH_TOKEN": "test-auth-token"},
            clear=True,
        ):
            handler_type = create_handler(state)
        handler = object.__new__(handler_type)
        handler.path = "/infer"
        handler.headers = {"authorization": "Bearer test-auth-token"}

        def capture_response(
            _self: object,
            body: dict[str, object],
            status: HTTPStatus = HTTPStatus.OK,
            headers: dict[str, str] | None = None,
        ) -> None:
            responses.append((body, status, headers))

        handler.write_json = MethodType(capture_response, handler)
        handler.do_POST()

        self.assertEqual(
            responses,
            [({"error": "model_startup_failed"}, HTTPStatus.INTERNAL_SERVER_ERROR, None)],
        )


if __name__ == "__main__":
    unittest.main()
