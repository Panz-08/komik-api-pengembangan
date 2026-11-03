'use strict';
/**
 * Shinigami Scans (11.shinigami.asia) memakai SvelteKit + API publik api.shngm.io.
 * Tidak perlu scraping HTML: semua data (termasuk daftar gambar chapter) ada di API.
 */
const BasePlugin = require('./basePlugin');
const { AppError } = require('../lib/errors');
const { cleanText, encodeId, chapterNumber } = require('../lib/util');

const API = 'https://api.shngm.io';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const STATUS = { 1: 'Ongoing', 2: 'Completed', 3: 'Hiatus', 4: 'Dropped' };

class Shinigami extends BasePlugin {
  constructor() {
    super({
      id: 'shinigami',
      hosts: ['https://11.shinigami.asia'],
      description: 'Shinigami Scans - manhwa, manga, manhua (API resmi)',
    });
  }

  async _api(path, params = {}, opts = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const data = await this.loadJson(url.href, {
      ttl: opts.ttl,
      headers: { Origin: this.host, Referer: this.host + '/' },
    });
    if (!data || data.retcode !== 0) {
      throw new AppError(data && data.message ? `Shinigami API: ${data.message}` : 'Shinigami API gagal', 502, 'UPSTREAM_ERROR');
    }
    return data;
  }

  _taxonomy(item, key) {
    const list = item && item.taxonomy && item.taxonomy[key];
    if (!Array.isArray(list)) return [];
    return list.map((x) => cleanText(x && x.name)).filter(Boolean);
  }

  async search(query, page = 1) {
    const res = await this._api('/v1/manga/list', {
      q: query, page, page_size: 24, sort: 'latest', sort_order: 'desc',
    });
    const comics = (res.data || [])
      .filter((x) => x && x.manga_id && x.title)
      .map((x) => ({
        id: x.manga_id,
        site: this.id,
        title: cleanText(x.title),
        cover: x.cover_portrait_url || x.cover_image_url || '',
        url: `${this.host}/manga/detail/${x.manga_id}`,
        status: STATUS[x.status] || undefined,
      }));
    return { comics, page };
  }

  async comic(slug) {
    const id = (String(slug).match(UUID_RE) || [String(slug)])[0];
    const res = await this._api(`/v1/manga/detail/${encodeURIComponent(id)}`);
    const m = res.data || {};
    if (!m.manga_id) throw new AppError('Komik tidak ditemukan', 404, 'NOT_FOUND');

    const chapters = [];
    let page = 1;
    let totalPage = 1;
    do {
      const list = await this._api(`/v1/chapter/${encodeURIComponent(m.manga_id)}/list`, {
        page,
        page_size: 200,
        sort_by: 'chapter_number',
        sort_order: 'desc',
      });
      for (const c of list.data || []) {
        if (!c || !c.chapter_id) continue;
        const n = c.chapter_number != null ? Number(c.chapter_number) : chapterNumber(c.chapter_title);
        const title = c.chapter_title
          ? `Chapter ${n} - ${cleanText(c.chapter_title)}`
          : `Chapter ${n}`;
        const url = `${this.host}/chapter/${c.chapter_id}`;
        chapters.push({
          id: encodeId(url),
          title,
          number: Number.isFinite(n) ? n : null,
          url,
          date: c.release_date || undefined,
        });
      }
      totalPage = Number((list.meta && list.meta.total_page) || 1);
      page++;
    } while (page <= totalPage && page <= 50);

    return {
      id: m.manga_id,
      site: this.id,
      url: `${this.host}/manga/detail/${m.manga_id}`,
      title: cleanText(m.title),
      cover: m.cover_portrait_url || m.cover_image_url || '',
      summary: cleanText(m.description),
      altTitle: cleanText(m.alternative_title) || undefined,
      genres: this._taxonomy(m, 'Genre'),
      author: this._taxonomy(m, 'Author').join(', ') || undefined,
      artist: this._taxonomy(m, 'Artist').join(', ') || undefined,
      type: this._taxonomy(m, 'Format').join(', ') || undefined,
      status: STATUS[m.status] || undefined,
      releaseYear: m.release_year || undefined,
      chapters,
    };
  }

  async pages(chapterUrl) {
    const id = (String(chapterUrl).match(UUID_RE) || [null])[0];
    if (!id) throw new AppError('chapterId Shinigami tidak valid', 400, 'BAD_REQUEST');
    const res = await this._api(`/v1/chapter/detail/${encodeURIComponent(id)}`);
    const d = res.data || {};
    const chapter = d.chapter || {};
    const base = String(d.base_url || '').replace(/\/+$/, '');
    const path = String(chapter.path || '').replace(/^\/?/, '/').replace(/\/?$/, '/');
    const pages = (chapter.data || [])
      .filter((f) => typeof f === 'string' && f)
      .map((f) => `${base}${path}${f.replace(/^\/+/, '')}`);

    if (!pages.length) throw new AppError('Gambar chapter tidak ditemukan', 404, 'NOT_FOUND');
    return {
      title: d.chapter_title
        ? `Chapter ${d.chapter_number} - ${cleanText(d.chapter_title)}`
        : `Chapter ${d.chapter_number}`,
      pages,
      prevChapter: d.prev_chapter_id || undefined,
      nextChapter: d.next_chapter_id || undefined,
    };
  }
}

module.exports = Shinigami;
