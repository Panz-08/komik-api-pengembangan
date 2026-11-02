'use strict';
/** 01.komiku.asia - komik: /manga/<slug> , chapter: /read/<lang>/<slug>/ch<id>-<num> , metadata JSON-LD */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, cleanText } = require('../lib/util');

const SLUG_RE = /\/manga\/([^/?#]+)\/?$/;
const READ_RE = /\/read\/[^/]+\/[^/]+\/ch\d+/;

class KomikuAsia extends BasePlugin {
  constructor() {
    super({
      id: 'komiku-asia',
      hosts: ['https://01.komiku.asia'],
      description: 'Komiku Asia - mirror Komiku',
    });
  }

  async search(query, page = 1) {
    const q = encodeURIComponent(query);
    const { $, url } = await this.load(page > 1 ? `/page/${page}/?s=${q}` : `/?s=${q}`);
    return { comics: this.collectComics($, url, 'a[href*="/manga/"]', SLUG_RE), page };
  }

  _jsonLd($) {
    const out = {};
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const d = JSON.parse($(el).html() || '');
        const list = Array.isArray(d) ? d : [d];
        for (const x of list) {
          if (x && ['CreativeWorkSeries', 'ItemList', 'Book', 'ComicSeries'].includes(x['@type'])) Object.assign(out, x);
        }
      } catch { /* abaikan */ }
    });
    return out;
  }

  async comic(slug) {
    const { $, url } = await this.load(`/manga/${encodeURIComponent(slug)}`);
    const ld = this._jsonLd($);
    const title = cleanText(ld.name) || this.firstText($, ['h1', '.m-title']);
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    const genre = ld.genre;
    const genres = Array.isArray(genre) ? genre : genre ? [genre] : [];
    const author = ld.author && (ld.author.name || (typeof ld.author === 'string' ? ld.author : ''));
    const chapters = this.collectChapters($, url, 'a[href*="/read/"]', {
      filter: (u) => READ_RE.test(u),
    });

    return {
      id: slug, site: this.id, url, title,
      cover: toAbs(ld.image || this.meta($, 'og:image'), url),
      summary: cleanText(ld.description) || this.meta($, 'description'),
      genres, author: author || undefined, chapters,
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    const pages = this.extractImages($, url, ['#reader img', '.reader img', '.chapter-images img', 'img[src*="cdnkomiku"]', 'img[data-src*="cdnkomiku"]']);
    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return { title: this.firstText($, ['h1', '.m-title']), pages };
  }
}

module.exports = KomikuAsia;
