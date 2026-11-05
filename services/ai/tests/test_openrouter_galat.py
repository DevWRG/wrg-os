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


BODY_429 = '{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is temporarily rate-limited upstream."}}}'
BODY_OK = '{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}'


class TestCobaUlang429(unittest.TestCase):
    """6 Nov 2026: flash-lite kena 429 upstream 9× semalam dan tiap kali langsung lompat
    ke fallback. Sekarang 429 dicoba ulang SEKALI pada model yang sama dulu."""

    def _jalankan(self, urutan_status):
        panggilan = []

        def transport(req: httpx.Request) -> httpx.Response:
            model = json.loads(req.content)["model"]
            panggilan.append(model)
            st = urutan_status.pop(0) if urutan_status else 200
            return httpx.Response(st, text=BODY_429 if st == 429 else BODY_OK, request=req)

        class Client(httpx.Client):
            def __init__(self, *a, **kw):
                kw.pop("timeout", None)
                super().__init__(transport=httpx.MockTransport(transport))

        err = io.StringIO()
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "uji"}), \
                mock.patch.object(openrouter.httpx, "Client", Client), \
                mock.patch.object(openrouter.time, "sleep") as tidur, \
                redirect_stderr(err):
            hasil = openrouter.chat("s", "u", models=["google/gemini-2.5-flash-lite", "deepseek/deepseek-v3.2"])
        return hasil, panggilan, tidur, err.getvalue()

    def test_429_sekali_lalu_lolos_di_model_yang_sama(self):
        (text, model, _, _), panggilan, tidur, log = self._jalankan([429, 200])
        self.assertEqual((text, model), ("OK", "google/gemini-2.5-flash-lite"))
        self.assertEqual(panggilan, ["google/gemini-2.5-flash-lite"] * 2)
        tidur.assert_called_once()
        self.assertIn("429 — coba ulang", log)

    def test_429_dua_kali_pindah_ke_fallback(self):
        (text, model, _, _), panggilan, tidur, log = self._jalankan([429, 429, 200])
        self.assertEqual(model, "deepseek/deepseek-v3.2")
        self.assertEqual(panggilan, ["google/gemini-2.5-flash-lite"] * 2 + ["deepseek/deepseek-v3.2"])
        self.assertIn("gemini-2.5-flash-lite gagal — HTTP 429", log)

    def test_status_lain_tak_dicoba_ulang(self):
        _, panggilan, tidur, _ = self._jalankan([500, 200])
        self.assertEqual(panggilan, ["google/gemini-2.5-flash-lite", "deepseek/deepseek-v3.2"])
        tidur.assert_not_called()


class TestModelCadangan(unittest.TestCase):
    def test_tak_ada_default_deepseek_r1(self):
        # Slug ini sudah 404 di OpenRouter; default kode tak boleh memakainya lagi.
        with mock.patch.dict(os.environ, {}, clear=True):
            for fn in (openrouter.daily_models, openrouter.rekap_models, openrouter.resume_models,
                       openrouter.exec_models, openrouter.raport_models):
                self.assertNotIn("deepseek/deepseek-r1", fn(), fn.__name__)


if __name__ == "__main__":
    unittest.main()
