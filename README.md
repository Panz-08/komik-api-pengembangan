# Komik & Novel API

[![CI](https://github.com/Panz-08/komik-api-pengembangan/actions/workflows/ci.yml/badge.svg)](https://github.com/Panz-08/komik-api-pengembangan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node: >= 20](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

API buat ambil data komik dari beberapa situs Indonesia, plus novel dari
[Sakuranovel](https://sakuranovel.id) lengkap dengan teks chapter-nya. Dibuat dengan Express 5
dan siap jalan di Vercel maupun Wokku.

Repo ini masih dalam tahap pengembangan. Bagian komik bergantung pada struktur HTML situs
sumber, jadi kalau ada perubahan markup tinggal sesuaikan plugin-nya. Bagian novel memakai
REST API WordPress publik Sakuranovel, jadi tidak perlu browser headless.

## Fitur

- Multi-sumber komik: Komikindo, Komiku, Komiku Asia, MGKomik, dan Shinigami.
- Pencarian komik lintas situs.
- Detail komik, daftar chapter, dan URL gambar chapter.
- Proxy gambar untuk mengakali hotlink protection.
- Novel Sakuranovel: daftar novel, detail, daftar chapter, chapter terbaru, pencarian,
  genre, dan statistik.
- Novel acak dan chapter acak dengan `seed` opsional, jadi hasilnya bisa diulang
  untuk pengujian atau fitur "buka yang mana saja".
- Teks chapter novel lengkap dalam bentuk paragraf biasa (plus excerpt singkat).
- Cache, rate limit sederhana, CORS, dan error handling.
- API key, allowlist origin, dan URL gambar bertanda tangan (opsional, aktif lewat env).
- Siap deploy ke Vercel atau Wokku tanpa konfigurasi tambahan.

## Jalankan lokal

```bash
npm install
npm start
```

Buka `http://localhost:3000` untuk melihat daftar endpoint.

Tes:

```bash
npm test
```

Konfigurasi opsional ada di `.env.example`. Untuk lokal, salin dulu:

```bash
cp .env.example .env
```

## Sumber data

### Komik

| id | Situs | Catatan |
|----|-------|---------|
| `komikindo` | komikindo.ch | HTML statis |
| `komiku` | komiku.org | Chapter tertentu bisa kena Cloudflare |
| `komiku-asia` | 01.komiku.asia | Data Next.js flight |
| `mgkomik` | web1.mgkomik.cc | Butuh fallback curl |
| `shinigami` | 11.shinigami.asia | Memakai API publik `api.shngm.io` |

Plugin ada di `src/plugins/`. Kalau situs sumber berubah, cukup sesuaikan selector di file
plugin yang bersangkutan.

### Novel

| id | Situs | Metode |
|----|-------|--------|
| `sakuranovel` | sakuranovel.id | REST API WordPress `/wp-json/wp/v2` |

Bagian novel **tidak** memakai FlareSolverr, browser headless, atau proxy rotasi. Yang dipakai
adalah endpoint JSON publik milik Sakuranovel. Kalau endpoint itu sampai diblokir, API akan
mengembalikan error `UPSTREAM_BLOCKED`, bukan mencoba menembus challenge.

## Endpoint

Response sukses memakai bentuk:

```json
{
  "success": true,
  "data": {}
}
```

Response error:

```json
{
  "success": false,
  "error": "Pesan error",
  "code": "KODE_ERROR"
}
```

Endpoint novel menambahkan `meta` berisi sumber, pembuat, waktu generate, dan status cache.

### Umum

| Endpoint | Keterangan |
|----------|------------|
| `GET /` | Dokumentasi singkat dalam JSON |
| `GET /health` | Status API, daftar situs, dan capability runtime |
| `GET /api/sources` | Daftar sumber komik dan novel |

### Komik

| Endpoint | Keterangan |
|----------|------------|
| `GET /api/sites` | Daftar situs komik |
| `GET /api/search?q=solo&site=komikindo&page=1` | Cari komik. `site` kosong = cari di semua situs |
| `GET /api/comics/:slug?site=komikindo` | Detail komik + daftar chapter |
| `GET /api/comics/:slug/chapters?site=komikindo` | Daftar chapter saja |
| `GET /api/chapters/:chapterId/pages?site=komikindo` | URL gambar chapter |
| `GET /api/image?url=...&site=komikindo` | Proxy gambar + Referer yang benar (maks 10 MB) |

`chapterId` diambil dari field `id` pada daftar chapter. Isinya URL chapter ter-encode, jadi
tidak perlu menebak pola URL.

### Novel

| Endpoint | Keterangan |
|----------|------------|
| `GET /api/novels?page=1&limit=20&sort=popular` | Daftar novel. `sort`: `popular`, `newest`, `title` |
| `GET /api/novels?q=academy` | Cari novel lewat query `q` |
| `GET /api/novels/search?q=academy` | Pencarian novel |
| `GET /api/novels/latest` | Chapter terbaru dari semua novel |
| `GET /api/novels/random?seed=123` | Satu novel acak. `seed` opsional agar hasil bisa diulang |
| `GET /api/novels/:idOrSlug` | Detail novel + chapter pertama/terbaru |
| `GET /api/novels/:idOrSlug/chapters?page=1&limit=50&order=desc` | Daftar chapter |
| `GET /api/novels/:idOrSlug/random-chapter?seed=123` | Satu chapter acak dari novel tertentu |
| `GET /api/novels/chapters/:id` | Satu chapter + excerpt + teks lengkap (`paragraphs`) |
| `GET /api/novels/chapters/:id?content=0` | Metadata + excerpt saja, tanpa teks lengkap |
| `GET /api/novels/genres` | Tag/genre populer |
| `GET /api/novels/stats` | Jumlah novel dan chapter |
| `GET /api/novels/source` | Info sumber novel |

Pencarian chapter global belum tersedia karena pencarian publik Sakuranovel hanya mengindeks
seri/novel. Kalau butuh mencari chapter, ambil daftar chapter dari satu novel lalu filter di
sisi client.

## Contoh

```bash
# komik
curl "http://localhost:3000/api/sites"
curl "http://localhost:3000/api/search?q=solo&site=komikindo"
curl "http://localhost:3000/api/comics/solo-leveling?site=komikindo"

# novel
curl "http://localhost:3000/api/novels?limit=5&sort=popular"
curl "http://localhost:3000/api/novels/search?q=academy"
curl "http://localhost:3000/api/novels/the-victim-of-the-academy"
curl "http://localhost:3000/api/novels/the-victim-of-the-academy/chapters?limit=10&order=desc"
curl "http://localhost:3000/api/novels/chapters/421269"
curl "http://localhost:3000/api/novels/chapters/421269?content=0"
curl "http://localhost:3000/api/novels/latest?limit=10"
curl "http://localhost:3000/api/novels/random?seed=42"
curl "http://localhost:3000/api/novels/the-victim-of-the-academy/random-chapter?seed=42"
```

`seed` membuat pilihan acak deterministik: request dengan seed yang sama akan
mengembalikan halaman dan item yang sama selama data sumber belum berubah.

Contoh response chapter novel:

```json
{
  "success": true,
  "data": {
    "id": 421269,
    "title": "The Villain Who Invests in a Witch to Survive Chapter 301 Bahasa Indonesia",
    "chapterNumber": 301,
    "url": "https://sakuranovel.id/.../",
    "series": {
      "id": 1906,
      "slug": "the-villain-who-invests-in-a-witch-to-survive",
      "title": "The Villain Who Invests in a Witch to Survive"
    },
    "contentAvailable": true,
    "paragraphs": [
      "Paragraf pertama chapter ini.",
      "Paragraf kedua chapter ini."
    ],
    "content": "Paragraf pertama chapter ini.\n\nParagraf kedua chapter ini.",
    "wordCount": 1234,
    "readingMinutes": 6,
    "readAt": "https://sakuranovel.id/.../"
  },
  "meta": {
    "source": "Sakuranovel",
    "sourceUrl": "https://sakuranovel.id",
    "creator": "Panz-08",
    "cached": false
  }
}
```

## Deploy ke Vercel

1. Push repo ini ke GitHub.
2. Buka [vercel.com/new](https://vercel.com/new), import repo.
3. Framework preset: **Other / Express**.
4. Build command dan output directory: biarkan kosong.
5. Deploy.

`server.js` mengekspor Express app, jadi Vercel bisa mendeteksinya langsung. `vercel.json`
menaikkan `maxDuration` function menjadi 300 detik.

Environment variable yang biasanya perlu diatur di Vercel:

| Nama | Default | Keterangan |
|------|---------|------------|
| `API_KEYS` | kosong | **Wajib untuk deployment publik.** Satu atau beberapa kunci, pisahkan dengan koma |
| `REQUIRE_API_KEY` | `0` | Set `1` untuk menolak semua request bila `API_KEYS` kosong |
| `ALLOWED_ORIGINS` | kosong | Daftar origin frontend yang boleh memakai API dari browser |
| `IMAGE_SIGNING_SECRET` | `API_KEYS` pertama | Secret tanda tangan URL gambar |
| `IMAGE_URL_TTL_SECONDS` | `86400` | Umur URL gambar bertanda tangan |
| `RATE_LIMIT` | `120` | Request per menit per IP |
| `CACHE_TTL_SECONDS` | `300` | Cache plugin komik |
| `FLARESOLVERR_URL` | kosong | Opsional, hanya untuk komik yang kena Cloudflare |
| `CURL_FALLBACK` | `1` | Fallback curl untuk komik |
| `MAX_IMAGE_BYTES` | `10485760` | Batas ukuran gambar `/api/image` (10 MB) |
| `IMAGE_TIMEOUT_MS` | `30000` | Batas waktu total satu request gambar |
| `SAKURANOVEL_CACHE_TTL_SECONDS` | `300` | Cache novel |
| `SAKURANOVEL_TIMEOUT_MS` | `12000` | Timeout request novel |

Vercel menjalankan app sebagai satu function. Cache in-memory dan rate limit berlaku per
instance, bukan global. Kalau butuh pembatasan yang lebih serius, pakai Vercel Firewall atau
Redis (misalnya Upstash).

## Mengunci API agar hanya bisa dipakai sendiri

Tanpa konfigurasi tambahan, API tetap terbuka seperti sebelumnya (cocok untuk lokal).
Untuk deployment publik, set environment variable berikut di Vercel:

```bash
# buat kunci acak
openssl rand -hex 32

# contoh isi environment di Vercel
API_KEYS=hasil_openssl_tadi
ALLOWED_ORIGINS=https://proyekku.vercel.app
IMAGE_SIGNING_SECRET=hasil_openssl_lain
```

Setelah `API_KEYS` diisi:

- Semua endpoint data (`/api/*`) menolak request tanpa kunci.
- Kirim kunci lewat header `x-api-key` atau `Authorization: Bearer <kunci>`.
- `/api/image` tetap bisa dipakai `<img>` karena URL-nya ditandatangani otomatis dan
  kedaluwarsa sesuai `IMAGE_URL_TTL_SECONDS`.
- `/` dan `/health` tetap terbuka supaya mudah dicek, tetapi tidak mengembalikan data komik/novel.

Contoh:

```bash
curl -H "x-api-key: $API_KEY" \
  "https://komik-api-pengembangan.vercel.app/api/novels?limit=5"

curl -H "Authorization: Bearer $API_KEY" \
  "https://komik-api-pengembangan.vercel.app/api/search?q=solo&site=komikindo"
```

`ALLOWED_ORIGINS` menolak browser dari situs lain. Ini **bukan** pengganti API key karena
request non-browser (curl/Postman) tidak mengirim `Origin`. Pakai keduanya.

### Memakai dari frontend di Vercel

- **Disarankan (server-side):** simpan kunci sebagai environment biasa (bukan
  `NEXT_PUBLIC_*`), lalu panggil API dari Server Component, Route Handler, atau Vercel
  Function milikmu. Kunci tidak pernah sampai ke browser.
- **Frontend statis (client-side):** kunci akan terlihat di browser/network tab. Kalau tetap
  dilakukan, isi `ALLOWED_ORIGINS` dan siapkan rotasi kunci bila disalahgunakan. Untuk data
  yang benar-benar privat, gunakan proxy server-side.

Orang lain yang ingin memakai API ini sebaiknya fork/deploy sendiri dan mengisi `API_KEYS`
milik mereka. Kunci di deployment kamu tidak perlu dibagikan.

## Deploy ke Wokku

Wokku cocok kalau mau API jalan di server sendiri tanpa cold start function. App-nya memakai
Nixpacks dan otomatis menjalankan `npm start`.

1. Buat app Node.js di dashboard Wokku, pilih server yang sudah terhubung.
2. Tambahkan remote Wokku di repo:

   ```bash
   git remote add wokku git@git.wokku.cloud:komik-api-pengembangan
   git push wokku main
   ```

3. Wokku otomatis build dan menjalankan `server.js`. API mendengarkan `process.env.PORT`,
   jadi tidak perlu konfigurasi tambahan.

Environment variable yang sama seperti di Vercel bisa diatur lewat menu **Config** app.
Contoh hasil deploy: `https://komik-api-pengembangan.wokku.app`.

## Struktur

```text
server.js                  entry point lokal + Vercel
src/configureApp.js        CORS, rate limit, health, error handler
src/routes/api.js          endpoint komik
src/routes/novels.js       endpoint novel
src/plugins/               plugin komik per situs
src/novel/                 client, cache, util, dan config Sakuranovel
src/lib/auth.js            API key, allowlist origin, dan helper keamanan
src/lib/signedUrl.js       tanda tangan URL /api/image
src/lib/                   http client komik, error, util
test/                      tes parsing, validasi route, dan kontrol akses
```

## Catatan

- Bagian komik masih bergantung pada HTML situs sumber. Kalau ada yang error, cek selector
  atau API sumbernya dulu.
- Teks chapter novel diambil dari field `content` pada REST API publik Sakuranovel lalu
  diubah jadi paragraf biasa. API ini tidak mengklaim kepemilikan atas teks tersebut.
- Repo ini tidak berafiliasi dengan situs sumber. Semua data dan hak cipta tetap milik
  pemiliknya masing-masing.
- Gunakan dengan wajar. Jangan jadikan API ini alat untuk membanjiri situs sumber.

## Lisensi

MIT. Silakan dipakai dan dimodifikasi, tapi tetap cantumkan sumber datanya.
