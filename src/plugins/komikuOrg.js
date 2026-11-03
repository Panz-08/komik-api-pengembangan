'use strict';
/** komiku.org - komik: /manga/<slug>/ , chapter: /<slug>-chapter-<n>/ , search lewat api.komiku.org */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { toAbs, imgSrc, cleanText } = require('../lib/util');

const SLUG_RE = /\/manga\/([^/?#]+)\/?$/;

class KomikuOrg extends BasePlugin {
  constructor() {
    super({
      id: 'komiku',
      hosts: ['https://komiku.org'],
      description: 'Komiku - manga, manhwa, manhua bahasa Indonesia',
      note: 'Halaman chapter memakai Cloudflare challenge; fallback otomatis ke FlareSolverr bila FLARESOLVERR_URL aktif.',
    });
  }

  async search(query, page = 1) {
    const q = encodeURIComponent(query);
    const path = page > 1
      ? `/page/${page}/?post_type=manga&s=${q}`
      : `/?post_type=manga&s=${q}`;
    // Pencarian ada di subdomain api.komiku.org, tetapi URL komik tetap di komiku.org.
    const { $ } = await this.load(`https://api.komiku.org${path}`);
    const comics = this.collectComics($, this.host + '/', '.bge a[href*="/manga/"], a[href*="/manga/"]', SLUG_RE)
      .filter((c) => c.id !== 'page');
    return { comics, page };
  }

  async comic(slug) {
    const { $, url } = await this.load(`/manga/${encodeURIComponent(slug)}/`);
    const title = this.firstText($, ['h1 span[itemprop="name"]', '#Judul h1', 'h1'])
      .replace(/^komik\s+/i, '');
    if (!title) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    const cover = toAbs(
      imgSrc($('.ims img, img[itemprop="image"]').first()) || this.meta($, 'og:image'),
      url,
    );
    const summary =
      this.firstText($, ['p.desc', '.desc', '[itemprop="description"]']) || this.meta($, 'description');
    const genres = $('ul.genre li a, .genre a, a[href*="/genre/"]')
      .map((_, el) => cleanText($(el).text())).get().filter((g) => g && g.length < 30);

    let chapters = this.collectChapters($, url, '#daftarChapter a, td.judulseries a');
    if (!chapters.length) chapters = this.collectChapters($, url, 'a[href*="-chapter-"]');

    return {
      id: slug, site: this.id, url, title, cover, summary,
      genres: [...new Set(genres)],
      status: this.firstText($, ['#Informasi .status', '.status']).replace(/^status\s*:?\s*/i, '') || undefined,
      chapters,
    };
  }

  async pages(chapterUrl) {
    const { $, url } = await this.load(chapterUrl);
    const pages = this.extractImages($, url, [
      '#Baca_Komik img.ww', '#Baca_Komik img[id]', '#Baca_Komik img', '.reading-area img',
    ]);
    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return { title: this.firstText($, ['#Judul h1', 'h1', '.judulbaca']), pages };
  }
}

module.exports = KomikuOrg;
