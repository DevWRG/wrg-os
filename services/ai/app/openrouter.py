import os
from typing import List, Optional, Tuple

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def daily_models() -> List[str]:
    """Model OpenRouter untuk daily-summary (env-configurable).

    Default: Claude Haiku 4.5 primary, DeepSeek R1 fallback (konvensi legacy WRG).
    Slug OpenRouter native: 'anthropic/claude-haiku-4.5' (bukan 'openrouter/...').
    """
    primary = os.environ.get("DAILY_MODEL_PRIMARY", "anthropic/claude-haiku-4.5")
    fallback = os.environ.get("DAILY_MODEL_FALLBACK", "deepseek/deepseek-r1")
    return [primary, fallback]


def chat(
    system: str, user: str, max_tokens: int = 1500
) -> Tuple[str, str, Optional[int], Optional[int]]:
    """Panggil OpenRouter chat-completions dgn primary→fallback.

    Returns: (text, model_dipakai, prompt_tokens, completion_tokens).
    Raises RuntimeError kalau OPENROUTER_API_KEY tidak ada atau semua model gagal.
    """
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY tidak di-set")

    headers = {"Authorization": f"Bearer {key}", "content-type": "application/json"}
    last_err: Optional[Exception] = None
    with httpx.Client(timeout=60) as client:
        for model in daily_models():
            try:
                resp = client.post(
                    OPENROUTER_URL,
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "max_tokens": max_tokens,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                usage = data.get("usage") or {}
                return (
                    text,
                    model,
                    usage.get("prompt_tokens"),
                    usage.get("completion_tokens"),
                )
            except Exception as e:  # noqa: BLE001 — coba model berikutnya
                last_err = e
                continue
    raise RuntimeError(f"semua model OpenRouter gagal: {last_err}")
