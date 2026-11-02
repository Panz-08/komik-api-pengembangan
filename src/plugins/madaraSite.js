'use strict';
/**
 * Plugin generik untuk situs bertema Madara (WordPress).
 * Dipakai oleh situs yang belum terverifikasi (eksperimental).
 */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, imgSrc, cleanText } = require('../lib/util');

const SLUG_RE = /\/manga\/([^/?#]+)\/?$/;

class MadaraSite extends BasePlugin {
  async search(query, page = 1) {
    const q = encodeURIComponent(query);
    const { $, url } = await this.load(
      page > 1 ? `/page/${page}/?s=${q}&post_type=wp-manga` : `/?s=${q}&post_type=wp-manga`,
    );
    return { comics: this.collectComics($, url, 'a[href*="/manga/"]', SLUG_RE), page };
  }

  async comic(slug) {
    const { $, url } = await this.load(`/manga/${encodeURIComponent(slug)}/`);
    const title = this.firstText($, ['.post-title h1', '.post-title h3', 'h1']);
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');
    return {
      id: slug, site: this.id, url, title,
      cover: toAbs(imgSrc($('.summary_image img').first()) || this.meta($, 'og:image'), url),
      summary: this.firstText($, ['.summary__content', '.description-summary']) || this.meta($, 'description'),
      genres: $('.genres-content a').map((_, el) => cleanText($(el).text())).get(),
      chapters: this.collectChapters($, url, 'li.wp-manga-chapter > a, .wp-manga-chapter a, a[href*="/chapter-"]'),
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    const pages = this.extractImages($, url, ['.reading-content img', '.page-break img']);
    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return { title: this.firstText($, ['h1', '#chapter-heading']), pages };
  }
}

module.exports = MadaraSite;
