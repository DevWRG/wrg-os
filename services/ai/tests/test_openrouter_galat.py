"""Kegagalan OpenRouter harus TERCATAT, bukan ditelan — app/openrouter.py.

5 Nov 2026 seluruh LLM prod mati (limit mingguan key habis → 403, fallback
deepseek-r1 → 404) dan satu-satunya jejak di log adalah "200 OK", karena
chat_or_fallback menelan exception dan httpx.HTTPStatusError tak memuat body.

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import io
import json
import os
import sys
import unittest
from contextlib import redirect_stderr
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

from app import openrouter  # noqa: E402

BODY_403 = '{"error":{"message":"Key limit exceeded (weekly limit).","code":403}}'
BODY_404 = '{"error":{"message":"deepseek/deepseek-r1 is no longer available on OpenRouter","code":404}}'


def _transport(req: httpx.Request) -> httpx.Response:
    model = json.loads(req.content)["model"]
    if model.startswith("anthropic/"):
        return httpx.Response(403, text=BODY_403, request=req)
    return httpx.Response(404, text=BODY_404, request=req)


class _Client(httpx.Client):
    def __init__(self, *a, **kw):
        kw.pop("timeout", None)
        super().__init__(transport=httpx.MockTransport(_transport))


class TestGalatOpenRouter(unittest.TestCase):
    def setUp(self):
        self._env = mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "uji"})
        self._env.start()
        self._client = mock.patch.object(openrouter.httpx, "Client", _Client)
        self._client.start()

    def tearDown(self):
        self._client.stop()
        self._env.stop()

    def test_sebab_tiap_model_tercatat_di_stderr(self):
        err = io.StringIO()
        with redirect_stderr(err):
            text, model, _, _ = openrouter.chat_or_fallback(
                "s", "u", "TEMPLATE", models=["anthropic/claude-haiku-4.5", "deepseek/deepseek-v3.2"]
            )
        self.assertEqual((text, model), ("TEMPLATE", "dry-run-fallback"))
        log = err.getvalue()
        self.assertIn("anthropic/claude-haiku-4.5 gagal — HTTP 403", log)
        self.assertIn("Key limit exceeded", log, "isi body (sebab sebenarnya) harus ikut tercatat")
        self.assertIn("deepseek/deepseek-v3.2 gagal — HTTP 404", log)
        self.assertIn("DEGRADASI", log)

    def test_runtimeerror_membawa_body(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError) as cm:
                openrouter.chat("s", "u", models=["anthropic/claude-haiku-4.5"])
        self.assertIn("Key limit exceeded", str(cm.exception))


class TestModelCadangan(unittest.TestCase):
    def test_tak_ada_default_deepseek_r1(self):
        # Slug ini sudah 404 di OpenRouter; default kode tak boleh memakainya lagi.
        with mock.patch.dict(os.environ, {}, clear=True):
            for fn in (openrouter.daily_models, openrouter.rekap_models, openrouter.resume_models,
                       openrouter.exec_models, openrouter.raport_models):
                self.assertNotIn("deepseek/deepseek-r1", fn(), fn.__name__)


if __name__ == "__main__":
    unittest.main()
