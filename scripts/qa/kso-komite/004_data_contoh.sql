-- =====================================================================
-- Komite KSO — data contoh (struktur sama dengan simulator deck slide 6)
-- SELURUH angka FIKTIF — harga PO asli sengaja tidak dimasukkan karena repo ini PUBLIC.
-- Z3 52,8 jt / Z52 76 jt / EXZ8000 265 jt dipilih supaya hasil gerbang sama dengan paket rujukan.
-- Di produksi: kategori/alat/faskes/cabang diisi dari tabel OS yang sudah ada.
-- =====================================================================
set search_path = kso, public;


insert into kso.kategori (kode,label,harga_standar_per_test,kontribusi_asumsi,lini) values
  ('hematologi', 'Hematologi', 18500, 0.23, 'ivd'),
  ('kimia_klinik', 'Kimia klinik', 12000, 0.3, 'ivd'),
  ('imunoasai', 'Imunoasai', 95000, 0.15, 'ivd');

insert into kso.alat values
  ('Z3', 'Z3 — hematologi', 'hematologi', 52800000),
  ('Z52', 'Z52 — kimia klinik', 'kimia_klinik', 76000000),
  ('EXZ8000', 'EXZ8000 — imunoasai', 'imunoasai', 265000000);

insert into kso.cabang values
  ('Surabaya', 'Timur'),
  ('Sidoarjo', 'Timur'),
  ('Malang', 'Barat'),
  ('Jember', 'Timur'),
  ('Kediri', 'Barat');

insert into kso.cabang_teknisi (cabang,kategori) values
  ('Surabaya', 'hematologi'),
  ('Surabaya', 'kimia_klinik'),
  ('Surabaya', 'imunoasai'),
  ('Sidoarjo', 'hematologi'),
  ('Sidoarjo', 'kimia_klinik'),
  ('Malang', 'hematologi'),
  ('Malang', 'kimia_klinik'),
  ('Malang', 'imunoasai'),
  ('Jember', 'hematologi'),
  ('Kediri', 'hematologi'),
  ('Kediri', 'kimia_klinik');

insert into kso.faskes (id, nama, cabang, piutang_hari, piutang_nilai, tagihan_bulanan) values
  ('F01', 'Klinik Pratama — Surabaya', 'Surabaya', 12, 34000000, 20000000),
  ('F02', 'RSUD tipe C — Sidoarjo', 'Sidoarjo', 38, 210000000, 95000000),
  ('F03', 'RS Swasta B — Malang', 'Malang', 94, 480000000, 120000000),
  ('F04', 'RS Swasta A tipe B — Surabaya', 'Surabaya', 25, 150000000, 30000000),
  ('F05', 'Labkesmas — Jember', 'Jember', 20, 18000000, 15000000),
  ('F06', 'RSUD tipe B — Kediri', 'Kediri', 55, 300000000, 140000000),
  ('F07', 'RS Swasta C — Denpasar', null, 0, 0, 0),
  ('F08', 'RSIA — Gresik (faskes baru)', 'Surabaya', 0, 0, 0);

insert into kso.klausul_khusus values
  ('eksklusivitas', 'Eksklusivitas', 1),
  ('jaminan_volume', 'Jaminan volume', 2),
  ('alat_jatuh', 'Alat jatuh ke RS', 3),
  ('tanpa_eskalasi', 'Tanpa eskalasi harga', 4),
  ('tanpa_lapor', 'Tanpa lapor test', 5),
  ('tanpa_denda', 'Tanpa denda telat bayar', 6),
  ('draft_rs', 'Draft PKS dari RS', 7);

insert into kso.am values
  ('AM-01','AM Surabaya','Surabaya','628110000001'),
  ('AM-02','AM Sidoarjo','Sidoarjo','628110000002'),
  ('AM-03','AM Malang','Malang','628110000003'),
  ('AM-04','AM Jember','Jember','628110000004');

insert into kso.hod values
  ('HB-IVD','HOD Bisnis IVD','bisnis','ivd'),
  ('HB-NON','HOD Bisnis non-IVD','bisnis','non_ivd'),
  ('HA-TIM','HOD Area Timur','area','Timur'),
  ('HA-BAR','HOD Area Barat','area','Barat');
