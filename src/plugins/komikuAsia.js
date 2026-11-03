'use strict';
/**
 * 01.komiku.asia - komik: /manga/<slug> , chapter: /read/<lang>/<slug>/ch<n>-<id>
 * Halaman memakai Next.js flight data (bukan HTML statis), jadi data diambil dari
 * payload JSON yang ditanam di <script>.
 */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, cleanText, encodeId, chapterNumber } = require('../lib/util');

const SLUG_RE = /\/manga\/([^/?#]+)\/?$/;

/** Ambil payload flight data Next.js dan decode menjadi teks JSON. */
function flightText($) {
  let out = '';
  $('script').each((_, el) => {
    const code = $(el).html() || '';
    const push = code.match(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/s);
    if (push) {
      try { out += JSON.parse(push[1]) + '\n'; } catch { out += push[1] + '\n'; }
      return;
    }
    if (/"(items|comic|chapters|pages)"\s*:/.test(code)) out += code + '\n';
  });
  return out;
}

/** Ambil potongan JSON (object/array) mulai dari posisi tertentu. */
function jsonSlice(text, start) {
  const open = text[start];
  if (open !== '[' && open !== '{') return null;
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Cari semua nilai JSON untuk sebuah key (mis. "items", "comic", "chapters"). */
function jsonValues(text, key) {
  const out = [];
  const re = new RegExp(`"${key}"\\s*:\\s*`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const raw = jsonSlice(text, start);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* lewati potongan rusak */ }
  }
  return out;
}

function firstValue(text, key) {
  const values = jsonValues(text, key);
  return values.length ? values[0] : null;
}

class KomikuAsia extends BasePlugin {
  constructor() {
    super({
      id: 'komiku-asia',
      hosts: ['https://01.komiku.asia'],
      description: 'Komiku Asia - mirror Komiku dengan data Next.js',
    });
  }

  async search(query, page = 1) {
    const q = encodeURIComponent(query);
    const { $, url } = await this.load(`/browse?q=${q}&page=${page}`);
    const text = flightText($);

    // Cari array "items" yang benar-benar berisi komik.
    let items = [];
    for (const v of jsonValues(text, 'items')) {
      if (Array.isArray(v) && v.some((x) => x && x.slug && x.title)) { items = v; break; }
    }

    if (!items.length) {
      // fallback bila payload berubah: ambil dari link HTML yang ter-render
      const comics = this.collectComics($, this.host + '/', 'a[href*="/manga/"]', SLUG_RE);
      return { comics, page };
    }

    const comics = items
      .filter((x) => x && x.slug && x.title)
      .map((x) => ({
        id: x.slug,
        site: this.id,
        title: cleanText(x.title),
        cover: toAbs(x.coverUrl, this.host + '/'),
        url: `${this.host}/manga/${x.slug}`,
        type: x.type || undefined,
        status: x.status || undefined,
      }));

    return { comics, page };
  }

  async comic(slug) {
    const { $, url, html } = await this.load(`/manga/${encodeURIComponent(slug)}`);
    const text = flightText($);
    const comic = firstValue(text, 'comic') || {};
    const rawChapters = firstValue(text, 'chapters');

    const title = cleanText(comic.title) || this.firstText($, ['h1', '.m-title']);
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    const genres = Array.isArray(comic.genres) ? comic.genres.filter(Boolean) : [];
    const lang = (String(html || '').match(/\/read\/([^/]+)\//) || [])[1] || 'id';

    let chapters = [];
    if (Array.isArray(rawChapters)) {
      chapters = rawChapters
        .filter((c) => c && c.id != null)
        .map((c) => {
          const n = c.n != null ? Number(c.n) : chapterNumber(c.title);
          const chapterUrl = `${this.host}/read/${lang}/${slug}/ch${n}-${c.id}`;
          return {
            id: encodeId(chapterUrl),
            title: cleanText(c.title) || `Chapter ${n}`,
            number: Number.isFinite(n) ? n : null,
            url: chapterUrl,
            date: c.releasedLabel || undefined,
          };
        });
    }
    if (!chapters.length) {
      chapters = this.collectChapters($, url, 'a[href*="/read/"]', {
        filter: (u) => /\/read\/[^/]+\/[^/]+\/ch\d+/.test(u),
      });
    }

    return {
      id: slug,
      site: this.id,
      url,
      title,
      cover: toAbs(comic.coverUrl || this.meta($, 'og:image'), url),
      summary: cleanText(comic.synopsis) || this.meta($, 'description'),
      genres,
      status: comic.status || undefined,
      type: comic.type || undefined,
      author: comic.author && comic.author !== '-' ? comic.author : undefined,
      artist: comic.artist && comic.artist !== '-' ? comic.artist : undefined,
      chapters,
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    let pages = this.extractImages($, url, [
      '.rd-page-image', '#reader img', '.reader img', '.chapter-images img',
      'img[src*="cdnkomiku"]', 'img[data-src*="cdnkomiku"]',
    ]);

    if (!pages.length) {
      const text = flightText($);
      const raw = firstValue(text, 'pages');
      if (Array.isArray(raw)) {
        pages = raw.map((p) => toAbs(p && p.url, url)).filter(Boolean);
      }
    }

    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return { title: this.firstText($, ['h1', '.m-title']), pages };
  }
}

module.exports = KomikuAsia;
