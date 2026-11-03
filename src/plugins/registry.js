'use strict';
/** Daftar plugin + dispatcher. Menambah situs baru = tambahkan satu baris di `plugins`. */
const { AppError } = require('../lib/errors');
const { decodeId } = require('../lib/util');

const plugins = [
  new (require('./komikindoCh'))(),
  new (require('./komikuOrg'))(),
  new (require('./komikuAsia'))(),
  new (require('./mgkomik'))(),
  new (require('./shinigami'))(),
];

const SEARCH_TIMEOUT_MS = 25000;
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new AppError(`${label} timeout`, 504, 'TIMEOUT')), ms)),
  ]);

function getPlugin(site) {
  if (!site) throw new AppError('Parameter site wajib diisi (lihat /api/sites)', 400, 'BAD_REQUEST');
  const key = String(site).toLowerCase();
  const p = plugins.find((x) => x.id === key || x.name.toLowerCase() === key);
  if (!p) throw new AppError(`Situs "${site}" tidak dikenal`, 400, 'BAD_REQUEST');
  if (!p.enabled) {
    throw new AppError(`Situs "${p.id}" sedang dinonaktifkan${p.note ? ': ' + p.note : ''}`, 503, 'DISABLED');
  }
  return p;
}

module.exports = {
  sites: () => plugins.map((p) => p.info()),
  getPlugin,

  /** Cari di satu situs, atau di semua situs aktif secara paralel bila site kosong. */
  async search(q, site, page = 1) {
    const targets = site ? [getPlugin(site)] : plugins.filter((p) => p.enabled);
    const settled = await Promise.allSettled(
      targets.map((p) => withTimeout(p.search(q, page), SEARCH_TIMEOUT_MS, p.id)),
    );
    const results = [];
    const sites = settled.map((r, i) => {
      const id = targets[i].id;
      if (r.status === 'fulfilled') {
        const comics = r.value.comics.map((c) => ({ ...c, site: id }));
        results.push(...comics);
        return { site: id, ok: true, count: comics.length };
      }
      return { site: id, ok: false, error: r.reason.message, code: r.reason.code };
    });
    // semua situs gagal + user hanya minta satu -> teruskan error aslinya
    if (site && !sites[0].ok) {
      const e = settled[0].reason;
      throw e instanceof AppError ? e : new AppError(e.message, 502, 'UPSTREAM_ERROR');
    }
    return { query: q, page, total: results.length, results, sites };
  },

  async comic(slug, site) {
    return getPlugin(site).comic(slug);
  },

  async chapters(slug, site) {
    return getPlugin(site).chapters(slug);
  },

  async pages(chapterId, site) {
    const p = getPlugin(site);
    const url = decodeId(chapterId);
    if (!p.ownsUrl(url)) throw new AppError('chapterId bukan milik situs tersebut', 400, 'BAD_REQUEST');
    const data = await p.pages(url);
    return { id: chapterId, site: p.id, url, ...data, total: data.pages.length };
  },
};
