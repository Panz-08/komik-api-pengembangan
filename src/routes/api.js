'use strict';
/**
 * GET /api/sites
 * GET /api/search?q=&site=&page=            (site kosong = cari di semua situs)
 * GET /api/comics/:slug?site=
 * GET /api/comics/:slug/chapters?site=
 * GET /api/chapters/:chapterId/pages?site=
 * GET /api/image?url=&site=                 (proxy gambar, melewati hotlink protection)
 */
const express = require('express');
const axios = require('axios');
const registry = require('../plugins/registry');
const { AppError } = require('../lib/errors');
const { assertPublicUrl } = require('../lib/util');
const { UA, curlImage } = require('../lib/http');

const router = express.Router();
const ok = (res, data) => res.json({ success: true, data });
const imageProxy = (url, site) =>
  `/api/image?url=${encodeURIComponent(url)}${site ? `&site=${encodeURIComponent(site)}` : ''}`;

router.get('/sites', (req, res) => ok(res, registry.sites()));

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) throw new AppError('Parameter q wajib diisi', 400, 'BAD_REQUEST');
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const data = await registry.search(q, req.query.site, page);
  data.results.forEach((c) => { if (c.cover) c.coverProxy = imageProxy(c.cover, c.site); });
  ok(res, data);
});

router.get('/comics/:slug', async (req, res) => {
  const data = await registry.comic(req.params.slug, req.query.site);
  if (data.cover) data.coverProxy = imageProxy(data.cover, data.site);
  ok(res, data);
});

router.get('/comics/:slug/chapters', async (req, res) => {
  ok(res, await registry.chapters(req.params.slug, req.query.site));
});

router.get('/chapters/:chapterId/pages', async (req, res) => {
  const data = await registry.pages(req.params.chapterId, req.query.site);
  data.proxy = data.pages.map((u) => imageProxy(u, data.site));
  ok(res, data);
});

router.get('/image', async (req, res) => {
  let target = String(req.query.url || '');
  let site = req.query.site ? registry.getPlugin(req.query.site) : null;

  // ikuti redirect manual (maks 3x) sambil memeriksa tiap tujuan agar tidak bisa diarahkan ke jaringan internal
  for (let hop = 0; hop <= 3; hop++) {
    const u = await assertPublicUrl(target);
    const referer = site ? site.host + '/' : u.origin + '/';

    let upstream = null;
    try {
      upstream = await axios.get(u.href, {
        responseType: 'stream',
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' },
      });
    } catch {
      upstream = null;
    }

    if (upstream) {
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.location) {
        upstream.data.destroy();
        target = new URL(upstream.headers.location, u).href;
        continue;
      }
      if (upstream.status < 400) {
        const type = String(upstream.headers['content-type'] || '');
        if (!type.startsWith('image/')) {
          upstream.data.destroy();
          throw new AppError('URL bukan gambar', 415, 'BAD_REQUEST');
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        upstream.data.on('error', () => res.destroy());
        upstream.data.pipe(res);
        return;
      }
      upstream.data.destroy();
    }

    // axios kena Cloudflare/403 atau error jaringan -> coba curl (TLS fingerprint berbeda)
    const viaCurl = await curlImage(u.href, { referer, timeout: 20000 });
    if (!viaCurl) {
      throw new AppError(
        `Gambar tidak bisa diambil${upstream ? ` (HTTP ${upstream.status})` : ''}`,
        502, 'UPSTREAM_ERROR',
      );
    }
    if (viaCurl.status >= 300 && viaCurl.status < 400 && viaCurl.headers.location) {
      target = new URL(viaCurl.headers.location, u).href;
      continue;
    }
    if (viaCurl.status >= 400) {
      throw new AppError(`Gambar tidak bisa diambil (HTTP ${viaCurl.status})`, 502, 'UPSTREAM_ERROR');
    }
    const type = String(viaCurl.headers['content-type'] || '');
    if (!type.startsWith('image/')) {
      throw new AppError('URL bukan gambar', 415, 'BAD_REQUEST');
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(viaCurl.body);
    return;
  }
  throw new AppError('Terlalu banyak redirect saat mengambil gambar', 502, 'UPSTREAM_ERROR');
});

module.exports = router;
