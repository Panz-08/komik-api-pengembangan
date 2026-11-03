'use strict';
/**
 * BasePlugin - kelas dasar semua situs.
 *
 * Plugin cukup mengisi 3 method:
 *   search(query, page) -> { comics: [{id,title,cover,url}], page }
 *   comic(slug)         -> { id,title,cover,summary,genres,status,author,chapters:[...] }
 *   pages(chapterUrl)   -> { title, pages: [url,...] }
 *
 * Method lain (chapters, load, helper ekstraksi) sudah disediakan di sini.
 * Plugin melempar AppError bila gagal; registry yang mengubahnya jadi response.
 */
const cheerio = require('cheerio');
const { fetchHtml, fetchJson } = require('../lib/http');
const { AppError } = require('../lib/errors');
const {
  cleanText, toAbs, imgSrc, isComicImage, encodeId, chapterNumber, unique,
} = require('../lib/util');

class BasePlugin {
  /**
   * @param {object} c
   * @param {string} c.id           kunci singkat, mis. "komikindo"
   * @param {string[]} c.hosts      host utama + mirror (dicoba berurutan)
   * @param {boolean} [c.experimental]
   * @param {string} [c.note]
   */
  constructor(c) {
    this.id = c.id;
    this.name = c.name || new URL(c.hosts[0]).hostname;
    this.hosts = c.hosts;
    this.description = c.description || '';
    this.experimental = !!c.experimental;
    this.note = c.note || '';
    this.enabled =
      c.enabled !== false && (!this.experimental || process.env.ENABLE_EXPERIMENTAL === '1');
  }

  get host() { return this.hosts[0]; }

  info() {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      description: this.description,
      status: this.enabled ? 'ready' : 'disabled',
      experimental: this.experimental,
      note: this.note || undefined,
    };
  }

  /** Apakah URL milik situs ini? (cegah plugin dipakai mengambil URL sembarang) */
  ownsUrl(url) {
    try {
      const h = new URL(url).hostname;
      return this.hosts.some((x) => {
        const base = new URL(x).hostname.replace(/^www\./, '');
        return h === base || h.endsWith('.' + base) || h === 'www.' + base;
      });
    } catch {
      return false;
    }
  }

  /** Muat halaman (path relatif atau URL penuh). Mirror dicoba bila host utama gagal. */
  async load(pathOrUrl) {
    let urls;
    if (/^https?:\/\//i.test(pathOrUrl)) {
      urls = [pathOrUrl];
      // URL milik situs ini -> tambahkan mirror dengan path yang sama
      if (this.ownsUrl(pathOrUrl)) {
        let u;
        try { u = new URL(pathOrUrl); } catch { u = null; }
        if (u) {
          for (const h of this.hosts) {
            const base = new URL(h);
            if (base.hostname === u.hostname) continue;
            urls.push(base.origin + u.pathname + u.search);
          }
        }
      }
    } else {
      urls = this.hosts.map((h) => h + pathOrUrl);
    }

    let err;
    for (const url of urls) {
      try {
        const html = await fetchHtml(url, { referer: this.host + '/' });
        return { $: cheerio.load(html), url, html };
      } catch (e) {
        err = e;
        // coba mirror berikutnya; error terakhir yang dilempar
      }
    }
    throw err;
  }

  /** Muat endpoint JSON (untuk situs yang menyediakan API). */
  async loadJson(pathOrUrl, opts = {}) {
    const { headers = {}, ...rest } = opts;
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : this.host + pathOrUrl;
    const data = await fetchJson(url, {
      referer: this.host + '/',
      headers: { Origin: this.host, ...headers },
      ...rest,
    });
    return data;
  }

  // ---------- default implementasi ----------
  async search() { throw new AppError(`[${this.id}] search belum diimplementasikan`, 501, 'NOT_IMPLEMENTED'); }
  async comic() { throw new AppError(`[${this.id}] comic belum diimplementasikan`, 501, 'NOT_IMPLEMENTED'); }
  async pages() { throw new AppError(`[${this.id}] pages belum diimplementasikan`, 501, 'NOT_IMPLEMENTED'); }

  async chapters(slug) {
    const c = await this.comic(slug);
    return { chapters: c.chapters, total: c.chapters.length };
  }

  // ---------- helper ekstraksi ----------

  /** Ambil teks dari selector pertama yang menghasilkan sesuatu. */
  firstText($, selectors) {
    for (const s of selectors) {
      const t = cleanText($(s).first().text());
      if (t) return t;
    }
    return '';
  }

  meta($, prop) {
    return cleanText($(`meta[property="${prop}"], meta[name="${prop}"]`).attr('content'));
  }

  /**
   * Kumpulkan daftar komik dari kumpulan <a>. Judul diambil dari title/alt/heading
   * (paling dipercaya), sisanya teks link. Hasil di-dedup berdasarkan slug.
   */
  collectComics($, base, linkSel, slugRe) {
    const map = new Map();
    $(linkSel).each((_, el) => {
      const a = $(el);
      const href = toAbs(a.attr('href'), base);
      const m = href.match(slugRe);
      if (!m) return;
      const slug = decodeURIComponent(m[1]);
      const img = a.find('img').first();
      const strong = cleanText(
        a.attr('title') || img.attr('alt') || a.find('h2,h3,h4,.tt,.title').first().text(),
      ).replace(/^(sampul|cover|komik|baca komik)\s+/i, '');
      const weak = cleanText(a.text());

      const cur = map.get(slug) || { id: slug, site: this.id, title: '', cover: '', url: href, _s: false };
      if (strong && !cur._s) { cur.title = strong; cur._s = true; }
      else if (!cur.title && weak && weak.length < 150) cur.title = weak;
      const cover = toAbs(imgSrc(img), base);
      if (!cur.cover && cover) cur.cover = cover;
      map.set(slug, cur);
    });
    return [...map.values()]
      .filter((c) => c.title)
      .map(({ _s, ...c }) => c);
  }

  /**
   * Kumpulkan chapter dari <a>. id chapter = URL ter-encode (base64url),
   * sehingga pages() tidak perlu menebak pola URL per situs.
   */
  collectChapters($, base, linkSel, { filter } = {}) {
    const seen = new Set();
    const out = [];
    $(linkSel).each((_, el) => {
      const a = $(el);
      const url = toAbs(a.attr('href'), base);
      if (!url || seen.has(url) || !this.ownsUrl(url)) return;
      if (filter && !filter(url, a)) return;
      seen.add(url);
      const num = cleanText(
        a.find('.chapternum, .chapter-number, .chapter-num, .num').first().text(),
      );
      let title = num || cleanText(a.text()) || cleanText(a.attr('title'));
      if (title.length > 80) title = cleanText(a.attr('title')) || title;
      title = title.replace(/\s+\d+\s+(detik|menit|jam|hari|minggu|bulan|tahun|seconds?|minutes?|hours?|days?|weeks?|months?|years?|ago).*$/i, '').trim();
      const date =
        cleanText(a.find('.chapter-date, .chapterdate, time').first().text()) ||
        cleanText(a.closest('li, tr').find('.chapterdate, .dt, time, .date').first().text()) ||
        undefined;
      out.push({
        id: encodeId(url),
        title,
        number: chapterNumber(title),
        url,
        date,
      });
    });
    return out;
  }

  /**
   * Ambil gambar halaman chapter. Urutan: container reader -> JSON di <script> -> semua <img>.
   */
  extractImages($, base, containers) {
    let urls = [];
    for (const sel of containers) {
      const found = $(sel).map((_, el) => imgSrc($(el))).get();
      if (found.length) { urls = found; break; }
    }
    if (!urls.length) urls = this._imagesFromScripts($);
    if (!urls.length) urls = $('img').map((_, el) => imgSrc($(el))).get();
    return unique(
      urls.map((u) => toAbs(u, base)).filter((u) => u && isComicImage(u)),
    );
  }

  _imagesFromScripts($) {
    let urls = [];
    $('script').each((_, el) => {
      const code = $(el).html() || '';
      const m = code.match(/"images"\s*:\s*(\[[^\]]+\])/);
      if (!m) return;
      try {
        const arr = JSON.parse(m[1]);
        if (Array.isArray(arr) && arr.length) { urls = arr.filter((u) => typeof u === 'string'); return false; }
      } catch { /* abaikan */ }
    });
    return urls;
  }
}

module.exports = BasePlugin;
