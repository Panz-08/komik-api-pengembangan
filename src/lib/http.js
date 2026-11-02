'use strict';
const axios = require('axios');
const { AppError } = require('./errors');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 300) * 1000;
const CACHE_MAX = 300;
const cache = new Map();

const cacheGet = (k) => {
  const e = cache.get(k);
  if (!e) return undefined;
  if (e.exp < Date.now()) { cache.delete(k); return undefined; }
  return e.v;
};
const cacheSet = (k, v, ttl) => {
  if (ttl <= 0) return;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { v, exp: Date.now() + ttl });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCloudflare = (status, body) =>
  [403, 429, 503].includes(status) &&
  /just a moment|cf-chl|challenge-platform|attention required/i.test(String(body).slice(0, 6000));

/** Request headers yang mirip browser. */
const browserHeaders = (referer) => ({
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  ...(referer ? { Referer: referer } : {}),
});

/**
 * Ambil HTML dengan retry + cache + deteksi Cloudflare.
 * @returns {Promise<string>}
 */
async function fetchHtml(url, { referer, ttl = CACHE_TTL, retries = 2, timeout = 15000 } = {}) {
  const hit = cacheGet(url);
  if (hit !== undefined) return hit;

  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        timeout,
        headers: browserHeaders(referer),
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: () => true,
        maxRedirects: 5,
      });
      if (isCloudflare(res.status, res.data)) {
        throw new AppError(
          'Situs diproteksi Cloudflare (butuh browser/solver, tidak bisa lewat scraper biasa)',
          503, 'CLOUDFLARE',
        );
      }
      if (res.status === 404) throw new AppError('Halaman tidak ditemukan di situs sumber', 404, 'NOT_FOUND');
      if (res.status >= 400) {
        throw new AppError(`Situs sumber membalas HTTP ${res.status}`, 502, 'UPSTREAM_ERROR',
          res.status >= 500 || res.status === 429);
      }
      cacheSet(url, res.data, ttl);
      return res.data;
    } catch (err) {
      last = err;
      if (err instanceof AppError && !err.retryable) throw err;
      if (i < retries) await sleep(400 * (i + 1));
    }
  }
  if (last instanceof AppError) throw last;
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  throw new AppError(`Gagal terhubung ke ${host} (${last.code || last.message})`, 502, 'NETWORK_ERROR');
}

module.exports = { fetchHtml, browserHeaders, UA };
