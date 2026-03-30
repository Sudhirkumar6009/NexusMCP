"""Minimal Gemini REST client for JSON responses."""

from __future__ import annotations

import json
from typing import Any, Dict

import httpx  # pyright: ignore[reportMissingImports]


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: float = 30.0):
        self.api_key = api_key.strip()
        self.model = model.strip() or "gemini-3-flash-preview"
        self.timeout_seconds = timeout_seconds

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def generate_json(
        self,
        system_instruction: str,
        payload: Dict[str, Any],
        *,
        strict_json: bool = False,
    ) -> Dict[str, Any]:
        if not self.enabled:
            raise RuntimeError("GEMINI_API_KEY is not configured")

        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:"
            f"generateContent?key={self.api_key}"
        )

        request_body = {
            "systemInstruction": {
                "parts": [{"text": system_instruction}],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": (
                                "Return valid JSON only with no markdown.\\n"
                                f"Input payload:\\n{json.dumps(payload, ensure_ascii=True)}"
                            )
                        }
                    ],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(endpoint, json=request_body)

        if response.status_code >= 400:
            detail = response.text.strip() or f"Gemini request failed: {response.status_code}"
            raise RuntimeError(detail)

        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")

        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise RuntimeError("Gemini returned an empty response")

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            if strict_json:
                raise RuntimeError("Gemini did not return strict valid JSON")

            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise RuntimeError("Gemini did not return valid JSON")
            return json.loads(text[start : end + 1])
