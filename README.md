# komik-api-pengembangan
API baca komik manhwa, manhua, manga (tahap pengembangan)

# Komik Scraper API

API scraper komik Indonesia (Node.js, Express 5).

## Menjalankan

```bash
npm install
npm start
npm test
```

Konfigurasi opsional lewat environment variable (lihat `.env.example`):
`PORT`, `CACHE_TTL_SECONDS`, `RATE_LIMIT`, `ENABLE_EXPERIMENTAL`.

## Situs

| id            | situs              | status        |
|---------------|--------------------|---------------|
| `komikindo`   | komikindo.ch       | siap          |
| `komiku`      | komiku.org         | belum siap    |
| `komiku-asia` | 01.komiku.asia     | siap          |
| `mgkomik`     | id.mgkomik.cc      | belum siap    |
| `shinigami`   | 11.shinigami.asia  | siap (70%)    |

\* Selector disusun berdasarkan struktur situs yang diketahui, dengan fallback berlapis. Bila situs mengubah
HTML-nya, cukup sesuaikan selector di `src/plugins/<situs>.js`.
Situs eksperimental aktif dengan `ENABLE_EXPERIMENTAL=1`.

## Endpoint

Semua response: `{ "success": true, "data": ... }` atau `{ "success": false, "error": "pesan", "code": "KODE" }`.

| Endpoint | Keterangan |
|----------|------------|
| `GET /api/sites` | daftar situs + status |
| `GET /api/search?q=solo&site=komikindo&page=1` | cari komik. `site` kosong = cari di semua situs secara paralel (hasil per situs ada di `data.sites`) |
| `GET /api/comics/:slug?site=komikindo` | detail komik + daftar chapter |
| `GET /api/comics/:slug/chapters?site=komikindo` | daftar chapter saja |
| `GET /api/chapters/:chapterId/pages?site=komikindo` | gambar chapter (`pages` = URL asli, `proxy` = lewat proxy) |
| `GET /api/image?url=...&site=komikindo` | proxy gambar (mengirim Referer yang benar, anti hotlink) |

`chapterId` didapat dari field `id` pada daftar chapter (berisi URL chapter ter-encode), jadi tak perlu menebak pola URL.

## Struktur

```
server.js              entry point
src/app.js             Express app (CORS, rate limit, error handler)
src/routes/api.js      endpoint
src/lib/               http client (retry/cache/Cloudflare), util, error
src/plugins/           satu file per situs + registry
public/index.html      web reader
test/                  tes
```

IDK
