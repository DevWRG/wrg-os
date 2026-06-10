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


def rekap_models() -> List[str]:
    """Model OpenRouter untuk monitor rekap (env-configurable, default sama)."""
    primary = os.environ.get("REKAP_MODEL_PRIMARY", "anthropic/claude-haiku-4.5")
    fallback = os.environ.get("REKAP_MODEL_FALLBACK", "deepseek/deepseek-r1")
    return [primary, fallback]


def resume_models() -> List[str]:
    """Model OpenRouter untuk resume eksekutif (env-configurable, default sama)."""
    primary = os.environ.get("RESUME_MODEL_PRIMARY", "anthropic/claude-haiku-4.5")
    fallback = os.environ.get("RESUME_MODEL_FALLBACK", "deepseek/deepseek-r1")
    return [primary, fallback]


def collection_models() -> List[str]:
    """Model OpenRouter untuk A3 collection drafter (env-configurable, default sama)."""
    primary = os.environ.get("COLLECTION_MODEL_PRIMARY", "anthropic/claude-haiku-4.5")
    fallback = os.environ.get("COLLECTION_MODEL_FALLBACK", "deepseek/deepseek-r1")
    return [primary, fallback]


def salesdoc_models() -> List[str]:
    """Model OpenRouter untuk A6 sales-doc drafter (token tier HIGH).

    Default primary Claude Sonnet 4.6 (dokumen lebih panjang/terstruktur),
    fallback Haiku. Override lewat env.
    """
    primary = os.environ.get("SALESDOC_MODEL_PRIMARY", "anthropic/claude-sonnet-4.6")
    fallback = os.environ.get("SALESDOC_MODEL_FALLBACK", "anthropic/claude-haiku-4.5")
    return [primary, fallback]


def extract_models() -> List[str]:
    """Model OpenRouter untuk A8 sentiment/entity (token tier LOW → Haiku)."""
    primary = os.environ.get("EXTRACT_MODEL_PRIMARY", "anthropic/claude-haiku-4.5")
    fallback = os.environ.get("EXTRACT_MODEL_FALLBACK", "deepseek/deepseek-r1")
    return [primary, fallback]


def exec_models() -> List[str]:
    """Model OpenRouter untuk A10 executive synthesis (token tier HIGH → Sonnet)."""
    primary = os.environ.get("EXEC_MODEL_PRIMARY", "anthropic/claude-sonnet-4.6")
    fallback = os.environ.get("EXEC_MODEL_FALLBACK", "anthropic/claude-haiku-4.5")
    return [primary, fallback]


def chat_or_fallback(
    system: str,
    user: str,
    fallback_text: str,
    max_tokens: int = 1500,
    models: Optional[List[str]] = None,
) -> Tuple[str, str, Optional[int], Optional[int]]:
    """chat() yang tahan gagal: degradasi anggun bila LLM error.

    Sukses → (text, model, tin, tout). Gagal (key invalid, rate-limit, semua
    model gagal) → (fallback_text, "dry-run-fallback", None, None) — endpoint
    tetap balas 200 dengan template, tidak 500. Live integration tetap jalan
    meski OpenRouter sesekali hiccup.
    """
    try:
        return chat(system, user, max_tokens=max_tokens, models=models)
    except Exception:  # noqa: BLE001 — degradasi ke template
        return fallback_text, "dry-run-fallback", None, None


def chat(
    system: str,
    user: str,
    max_tokens: int = 1500,
    models: Optional[List[str]] = None,
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
        for model in models or daily_models():
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
