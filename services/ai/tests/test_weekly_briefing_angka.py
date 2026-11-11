"""F63 — blok angka WatchPoint masuk ke prompt briefing mode senin (dry-run, tanpa LLM).

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import weekend_briefing  # noqa: E402
from app.schemas import WeekendBriefingRequest  # noqa: E402


def _req(**kw):
    base = dict(tanggal="2026-08-24", minggu_label="Briefing Minggu Depan: 24–30 Agustus 2026",
                resumes=[{"label": "REKAP 2026-08-17", "text": "isi rekap sintetis"}], dry_run=True)
    base.update(kw)
    return WeekendBriefingRequest(**base)


class TestAngkaBriefing(unittest.TestCase):
    def test_senin_dengan_angka_masuk_prompt(self):
        r = weekend_briefing(_req(mode="senin", angka="Papan WatchPoint W34: 1 hijau, 2 merah."))
        self.assertTrue(r.dry_run)
        self.assertIn("ANGKA SISTEM", r.briefing)
        self.assertIn("DATA ANGKA SISTEM", r.briefing)
        self.assertIn("1 hijau, 2 merah", r.briefing)

    def test_weekend_mengabaikan_angka(self):
        r = weekend_briefing(_req(mode="weekend", angka="Papan WatchPoint W34"))
        self.assertNotIn("DATA ANGKA SISTEM", r.briefing)

    def test_senin_tanpa_angka_seperti_dulu(self):
        r = weekend_briefing(_req(mode="senin"))
        self.assertNotIn("ANGKA SISTEM", r.briefing)

    def test_aturan_panjang_hanya_senin(self):
        self.assertIn("PANJANG", weekend_briefing(_req(mode="senin")).briefing)
        self.assertNotIn("PANJANG", weekend_briefing(_req(mode="weekend")).briefing)


if __name__ == "__main__":
    unittest.main()
