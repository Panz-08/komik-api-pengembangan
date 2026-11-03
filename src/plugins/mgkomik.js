'use strict';
/**
 * MGKomik - tema kustom (bukan Madara).
 * Host utama web1.mgkomik.cc tidak memasang challenge; id.mgkomik.cc dipakai
 * sebagai mirror dan akan otomatis lewat FlareSolverr bila diproteksi.
 */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, imgSrc, cleanText } = require('../lib/util');

const SLUG_RE = /\/komik\/([^/?#]+)\/?$/;

class MgKomik extends BasePlugin {
  constructor() {
    super({
      id: 'mgkomik',
      hosts: ['https://web1.mgkomik.cc', 'https://id.mgkomik.cc'],
      description: 'MGKomik - manga, manhwa, manhua bahasa Indonesia',
      note: 'Memakai mirror web1.mgkomik.cc agar tidak terkena challenge Cloudflare.',
    });
  }

  async search(query, page = 1) {
    const q = encodeURIComponent(query);
    const path = page > 1 ? `/search/?q=${q}&page=${page}` : `/search/?q=${q}`;
    const { $, url } = await this.load(path);
    const comics = this.collectComics(
      $, url,
      '.manga-card a[href*="/komik/"], a.manga-card[href*="/komik/"], a.manga-title-link[href*="/komik/"]',
      SLUG_RE,
    );
    return { comics, page };
  }

  async comic(slug) {
    const { $, url } = await this.load(`/komik/${encodeURIComponent(slug)}/`);
    const title = this.firstText($, ['.manga-info-col h1.manga-title', 'h1.manga-title', 'h1']);
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    // og:image adalah cover asli; img pertama di .manga-info-col sering banner iklan.
    const cover = toAbs(
      this.meta($, 'og:image') ||
        imgSrc($('.manga-cover, .manga-info-col .cover img, .manga-info-col img[itemprop="image"]').first()),
      url,
    );
    const summary =
      this.firstText($, [
        '.manga-description #sinopsisContainer',
        '.manga-description .sinopsis-wrapper',
        '.manga-description',
      ]) || this.meta($, 'description');
    const genres = $('.genre-list a.genre-tag, .genre-tag')
      .map((_, el) => cleanText($(el).text())).get().filter(Boolean);

    let chapters = this.collectChapters(
      $, url,
      '#chapterList a.chapter-link, .chapter-list a.chapter-link, a.chapter-link',
    );
    if (!chapters.length) chapters = this.collectChapters($, url, 'a[href*="/chapter-"]');

    return {
      id: slug, site: this.id, url, title, cover, summary,
      genres: [...new Set(genres)],
      type: this.firstText($, ['.manga-meta .meta-item']),
      status: this.firstText($, ['.status-badge']).replace(/^status\s*:?\s*/i, '') || undefined,
      chapters,
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    const pages = this.extractImages($, url, [
      '#readingContent img', '.reading-content img', '.reading-content.longstrip img',
    ]);
    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return {
      title: this.firstText($, ['.chapter-title', '.chapter-num', 'h1']),
      pages,
    };
  }
}

module.exports = MgKomik;
