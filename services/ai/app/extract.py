import json
import re
from typing import List

from .schemas import Annotation, Entity, ExtractMessage

# A8 — Sentiment & Entity Extraction. Jalur LLM (Haiku, LOW tier) memberi hasil
# terbaik; tanpa OPENROUTER_API_KEY dipakai fallback rule-based (leksikon ID +
# regex entity) supaya tetap berjalan offline & deterministik.

_POS = [
    "bagus", "mantap", "terima kasih", "makasih", "oke", "ok", "siap", "setuju",
    "deal", "lancar", "senang", "puas", "cepat", "sukses", "fix", "approve",
]
_NEG = [
    "kecewa", "lambat", "lama", "komplain", "marah", "batal", "rusak", "mahal",
    "telat", "masalah", "kendala", "gagal", "tolak", "belum", "pending", "maaf",
]

# Pola entity sederhana.
_RE_CUSTOMER = re.compile(r"\b(RS|RSUD|RSIA|Lab|Laboratorium|Klinik|Apotek|PT|CV)\s+[A-Z][\w-]*(?:\s+[A-Z][\w-]*)?")
_RE_PRODUCT = re.compile(r"\b[A-Z]{2,}-\d{2,}\b")
_RE_AMOUNT = re.compile(r"\bRp\s?\d[\d.,]*(?:\s?(?:jt|juta|rb|ribu|m|miliar))?\b", re.IGNORECASE)


def rule_based(msg: ExtractMessage) -> Annotation:
    text = msg.body or ""
    low = text.lower()
    pos = sum(1 for w in _POS if w in low)
    neg = sum(1 for w in _NEG if w in low)
    total = pos + neg
    if total == 0:
        sentiment, score = "neutral", 0.0
    else:
        score = round((pos - neg) / total, 3)
        sentiment = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"

    ents: List[Entity] = []
    seen = set()

    def add(t: str, v: str) -> None:
        key = (t, v.strip())
        if v.strip() and key not in seen:
            seen.add(key)
            ents.append(Entity(type=t, value=v.strip()))

    for m in _RE_CUSTOMER.finditer(text):
        add("customer", m.group(0))
    for m in _RE_PRODUCT.finditer(text):
        add("product", m.group(0))
    for m in _RE_AMOUNT.finditer(text):
        add("amount", m.group(0))

    return Annotation(id=msg.id, sentiment=sentiment, sentiment_score=score, entities=ents)


def build_extract_system() -> str:
    return (
        "Kamu adalah mesin ekstraksi NLP untuk pesan WhatsApp internal PT Wahana "
        "Rizky Gumilang (distributor alkes B2B). Untuk SATU pesan, keluarkan JSON "
        "valid: {\"sentiment\": \"positive|neutral|negative\", \"sentiment_score\": "
        "<float -1..1>, \"entities\": [{\"type\": \"customer|product|person|amount|org\", "
        "\"value\": \"...\"}]}. Bahasa Indonesia. Keluarkan HANYA JSON, tanpa teks lain."
    )


def parse_llm(msg_id: str, raw: str) -> Annotation:
    """Parse output LLM jadi Annotation; lempar ValueError kalau gagal."""
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no json object")
    data = json.loads(raw[start : end + 1])
    sentiment = str(data.get("sentiment", "neutral"))
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = "neutral"
    ents = [
        Entity(type=str(e.get("type", "org")), value=str(e.get("value", "")))
        for e in data.get("entities", [])
        if str(e.get("value", "")).strip()
    ]
    return Annotation(
        id=msg_id,
        sentiment=sentiment,
        sentiment_score=float(data.get("sentiment_score", 0.0) or 0.0),
        entities=ents,
    )
