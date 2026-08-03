# Daftar Fitur — Magang-Safe (auto-generated)

> ⚙️ **JANGAN edit manual.** Di-generate dari blueprint (board **WRG-OS Roadmap**) oleh `gen-magang-features.py` (folder Drive ini).
> Jalankan ulang tiap board berubah agar daftar tetap sinkron.

> **Filter:** hanya domain yang boleh dikerjakan magang — `AFTERSALES, OPS, PURCHASING, SHIPPING` (di luar Management/Infrastruktur/CRM/HR). Beberapa item infra/admin dikecualikan.

Total fitur magang-safe: **26** · di-generate 2026-07-28

**Role min** = auth role minimum yang boleh melihat fitur (hierarki: Management ⊇ HOD ⊇ Karyawan). Tanpa tanda = **Karyawan** (semua role).


## 🔧 Aftersales / Teknis

| F | Fitur | Role min | Status |
|---|---|---|---|
| F8 | Teknisi Readiness Board (install scheduling + capacity + post-install reports) | Karyawan | Todo |
| F22 | Instalasi Alat Lifecycle | Karyawan | Todo |
| F24 | Preventive Maintenance & Kalibrasi Schedule | Karyawan | Todo |
| F25 | Uji Profisiensi Document Registry | Karyawan | Todo |
| F26 | Service Ticket Triage (LLM-assisted) | Karyawan | Todo |

## 🛒 Purchasing / Supply Chain

| F | Fitur | Role min | Status |
|---|---|---|---|
| F13 | PO Tracker + Sistem Barang Masuk | Karyawan | Todo |
| F35 | PO Approval Workflow (#APPROVE) | HOD | Todo |
| F36 | Inbound Receiving Checklist | Karyawan | Todo |
| F37 | Cross-Branch Stock Visibility | Karyawan | Todo |
| F38 | ED Watch & Near-Expiry Alert | Karyawan | Todo |
| F39 | Supplier ETA Tracker | Karyawan | Todo |
| F40 | Inventory Relocation Request | HOD | Todo |
| F41 | Forecast vs Actual PO Gap Report | Management | Todo |

## 🚚 Shipping / Pengiriman

| F | Fitur | Role min | Status |
|---|---|---|---|
| F12 | Tracking Pengiriman Digital (BAST/TTF state machine + ETA) | Karyawan | Todo |
| F42 | SJ → BAST → TTF Closed-Loop Tracker | Karyawan | Todo |
| F44 | Document Print Spec Standardizer | Karyawan | Done |
| F45 | Pickup Pre-Visit Verification | Karyawan | Todo |

## 🏢 General Affairs / Operasional

| F | Fitur | Role min | Status |
|---|---|---|---|
| F14 | Kalender Libur + Backup PIC | Karyawan | Todo |
| F49 | ATK Stock In/Out Digital Register | Karyawan | Todo |
| F50 | Kendaraan Operasional Log | Karyawan | Todo |
| F51 | Dana Ops / Petty Cash Realization | HOD | Todo |
| F52 | IT Asset & Issue Tracker | Karyawan | Todo |
| F53 | Stiker Aset & Asset Tagging Audit | Karyawan | Todo |
| F54 | Materai/Stempel Inventory | Karyawan | Todo |
| F75 | Vendor/Partner Contract Tracker (ACE retainer style) | HOD | Todo |
| F93 | Delivery Proof Capture (photo + e-signature) | Karyawan | Todo |

---

Fitur di luar daftar ini (CRM, HR, Management, Infrastruktur, Finance, ERP) **bukan** untuk magang. Direktur menugaskan F-number spesifik dari daftar ini.
