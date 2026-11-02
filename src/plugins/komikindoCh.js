'use strict';
/** komikindo.ch - struktur: /komik/<slug>/ , chapter: /<slug>-chapter-<n>/ */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, imgSrc, cleanText } = require('../lib/util');

const SLUG_RE = /\/komik\/([^/?#]+)\/?$/;
// halaman navigasi, bukan komik
const NOT_COMIC = new Set(['page', 'feed', 'genre', 'daftar-komik', 'komik-terbaru']);

class KomikindoCh extends BasePlugin {
  constructor() {
    super({
      id: 'komikindo',
      hosts: ['https://komikindo.ch'],
      description: 'KomikIndo - manga, manhwa, manhua bahasa Indonesia',
    });
  }

  async search(query, page = 1) {
    const path = page > 1 ? `/page/${page}/?s=${encodeURIComponent(query)}` : `/?s=${encodeURIComponent(query)}`;
    const { $, url } = await this.load(path);
    const comics = this.collectComics($, url, 'a[href*="/komik/"]', SLUG_RE)
      .filter((c) => !NOT_COMIC.has(c.id));
    return { comics, page };
  }

  async comic(slug) {
    const { $, url } = await this.load(`/komik/${encodeURIComponent(slug)}/`);
    const title = this.firstText($, ['h1.entry-title', '.entry-title', 'h1']).replace(/^komik\s+/i, '');
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    const cover = toAbs(
      imgSrc($('.thumb img, .infoanime img, .animeinfo img, .thumbook img').first()) || this.meta($, 'og:image'),
      url,
    );
    const summary =
      this.firstText($, [
        '.entry-content-single', '.entry-content[itemprop="description"]',
        '.shortcsc', '.desc', '.entry-content p',
      ]) || this.meta($, 'description');
    const genres = $('.genre-info a, .genxed a, .spe a[href*="/genre/"], a[rel="tag"], a[href*="/genre/"]')
      .map((_, el) => cleanText($(el).text())).get();

    let chapters = this.collectChapters(
      $, url,
      '#chapter_list a, .chapter-list a, #chapterlist a, .lchx a, .eplister a',
    );
    if (!chapters.length) {
      chapters = this.collectChapters($, url, 'a[href*="-chapter-"]');
    }
    return {
      id: slug, site: this.id, url, title, cover, summary,
      genres: [...new Set(genres)],
      status: this.firstText($, ['.spe span:contains("Status")', '.status']).replace(/^status\s*:?\s*/i, '') || undefined,
      chapters,
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    const pages = this.extractImages($, url, [
      '#chimg-auh img', '#readerarea img', '.reader-area img', '.chapter-content img',
    ]);
    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return { title: this.firstText($, ['h1.entry-title', '.entry-title', 'h1']), pages };
  }
}

module.exports = KomikindoCh;
