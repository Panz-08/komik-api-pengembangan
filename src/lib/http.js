'use strict';
const axios = require('axios');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { AppError } = require('./errors');

const execFileAsync = promisify(execFile);

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

// ---------- cookie jar (dipakai ulang oleh axios & FlareSolverr) ----------
const cookieJar = new Map(); // hostname -> Map(name -> value)

function jarFor(host) {
  if (!cookieJar.has(host)) cookieJar.set(host, new Map());
  return cookieJar.get(host);
}

function cookieHeader(url) {
  try {
    const host = new URL(url).hostname;
    const jar = cookieJar.get(host);
    if (!jar || !jar.size) return '';
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {
    return '';
  }
}

function storeSetCookie(url, setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  for (const raw of list) {
    if (!raw || typeof raw !== 'string') continue;
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    // simpan di host request + domain cookie (bila ada)
    jarFor(host).set(name, value);
    const dm = raw.match(/;\s*domain=([^;]+)/i);
    if (dm) {
      const domain = dm[1].trim().replace(/^\./, '').toLowerCase();
      if (domain) jarFor(domain).set(name, value);
    }
  }
}

function storeFlareCookies(cookies) {
  if (!Array.isArray(cookies)) return;
  for (const c of cookies) {
    if (!c || !c.name) continue;
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (domain) jarFor(domain).set(c.name, c.value);
  }
}

// ---------- deteksi Cloudflare ----------
const CF_TEXT = /just a moment|attention required|cf-chl|challenge-platform|cf-mitigated|turnstile|performing security verification/i;
const isCloudflare = (status, body, headers = {}) => {
  const mitigated = String(headers['cf-mitigated'] || headers['CF-Mitigated'] || '').toLowerCase();
  if (mitigated === 'challenge') return true;
  const text = String(body || '');
  if (/<title>\s*just a moment/i.test(text)) return true;
  return [403, 429, 503].includes(status) && CF_TEXT.test(text.slice(0, 10000));
};

// ---------- FlareSolverr (opsional, untuk halaman yang diproteksi Cloudflare) ----------
const FLARE_URL =
  process.env.FLARESOLVERR_URL !== undefined
    ? String(process.env.FLARESOLVERR_URL).trim().replace(/\/+$/, '')
    : 'http://127.0.0.1:8191';
const FLARE_TIMEOUT = Math.max(30000, Number(process.env.FLARESOLVERR_TIMEOUT_MS || 120000));
const flareSessions = new Map(); // hostname -> session name
let flareAvailable;
let flareCheckedAt = 0;

async function flarePost(payload, timeout = 15000) {
  const res = await axios.post(FLARE_URL + '/v1', payload, {
    timeout,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(`FlareSolverr HTTP ${res.status}`);
  }
  const data = res.data || {};
  if (data.status === 'error') throw new Error(data.message || 'FlareSolverr error');
  return data;
}

async function flareIsAvailable() {
  if (!FLARE_URL) return false;
  // Di Vercel, default localhost tidak mungkin dijangkau; jangan buang waktu 3 detik.
  if (process.env.VERCEL && !process.env.FLARESOLVERR_URL) return false;
  if (Date.now() - flareCheckedAt < 30000) return !!flareAvailable;
  flareCheckedAt = Date.now();
  try {
    await flarePost({ cmd: 'sessions.list' }, 3000);
    flareAvailable = true;
  } catch {
    flareAvailable = false;
  }
  return !!flareAvailable;
}

async function flareCreateSession(host) {
  const name = 'komik-' + crypto.createHash('sha1').update(host).digest('hex').slice(0, 12);
  try {
    await flarePost({ cmd: 'sessions.create', session: name }, 15000);
  } catch (e) {
    // "Session already exists" bukan masalah
    if (!/already exists|sudah ada/i.test(e.message)) throw e;
  }
  flareSessions.set(host, name);
  return name;
}

async function flareRequest(url, session) {
  const data = await flarePost(
    { cmd: 'request.get', url, session, maxTimeout: FLARE_TIMEOUT },
    FLARE_TIMEOUT + 15000,
  );
  if (!data.solution) throw new Error(data.message || 'FlareSolverr tidak memberi solusi');
  return data.solution;
}

/**
 * Selesaikan Cloudflare challenge lewat FlareSolverr.
 * Session dipakai ulang per host supaya cookie cf_clearance tetap berlaku.
 * @returns {Promise<string>} HTML hasil render
 */
async function solveWithFlareSolverr(url) {
  if (!(await flareIsAvailable())) {
    throw new AppError(
      'Situs diproteksi Cloudflare. Jalankan FlareSolverr lalu set FLARESOLVERR_URL ' +
        '(contoh: http://localhost:8191), atau gunakan mirror situs yang tidak diproteksi.',
      503,
      'CLOUDFLARE',
    );
  }

  const host = new URL(url).hostname;
  let session = flareSessions.get(host);
  if (!session) {
    session = await flareCreateSession(host);
    // warm-up: challenge biasanya lebih mudah diselesaikan dari halaman utama
    if (url !== `https://${host}/` && url !== `http://${host}/`) {
      try { await flareRequest(`https://${host}/`, session); } catch { /* lanjut ke target */ }
    }
  }

  let solution;
  try {
    solution = await flareRequest(url, session);
  } catch (e) {
    // session bisa mati (browser crash); buat ulang sekali
    flareSessions.delete(host);
    session = await flareCreateSession(host);
    try { await flareRequest(`https://${host}/`, session); } catch { /* lanjut */ }
    solution = await flareRequest(url, session);
  }

  storeFlareCookies(solution.cookies);
  const body = String(solution.response || '');
  if (isCloudflare(solution.status, body, solution.headers)) {
    throw new AppError(
      'Cloudflare challenge tidak berhasil diselesaikan (coba naikkan FLARESOLVERR_TIMEOUT_MS)',
      503,
      'CLOUDFLARE',
    );
  }
  return body;
}

// ---------- request biasa ----------
/** Request headers yang mirip browser. */
const browserHeaders = (referer, extra = {}) => ({
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  ...(referer ? { Referer: referer } : {}),
  ...extra,
});

// ---------- fallback curl (TLS fingerprint curl sering lolos saat axios kena challenge) ----------
const CURL_FALLBACK = process.env.CURL_FALLBACK !== '0';
let curlAvailable;

async function curlFetch(url, { referer, timeout = 15000, accept } = {}) {
  if (!CURL_FALLBACK || curlAvailable === false) return null;
  const marker = '\n@@CURL_STATUS@@:';
  const args = [
    '-sS', '-L', '--compressed',
    '--max-time', String(Math.max(5, Math.ceil(timeout / 1000))),
    '-A', UA,
    '-H', `Accept: ${accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}`,
    '-H', 'Accept-Language: id-ID,id;q=0.9,en;q=0.8',
    '-w', `${marker}%{http_code}`,
  ];
  if (referer) args.push('-e', referer);
  const cookie = cookieHeader(url);
  if (cookie) args.push('-H', `Cookie: ${cookie}`);
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, {
      timeout: timeout + 4000,
      maxBuffer: 30 * 1024 * 1024,
      encoding: 'utf8',
    });
    curlAvailable = true;
    const idx = stdout.lastIndexOf(marker);
    if (idx < 0) return { status: 0, body: stdout, headers: {} };
    return {
      status: parseInt(stdout.slice(idx + marker.length), 10) || 0,
      body: stdout.slice(0, idx),
      headers: {},
    };
  } catch (e) {
    if (e.code === 'ENOENT') curlAvailable = false;
    return null;
  }
}

/** Fallback curl untuk gambar (binary). Mengembalikan {status, headers, body:Buffer}. */
async function curlImage(url, { referer, timeout = 20000 } = {}) {
  if (!CURL_FALLBACK || curlAvailable === false) return null;
  const args = [
    '-sS', '--max-redirs', '0', '--compressed',
    '--max-time', String(Math.max(5, Math.ceil(timeout / 1000))),
    '-A', UA,
    '-H', 'Accept: image/avif,image/webp,image/*,*/*;q=0.8',
    '-D', '-', '-o', '-',
  ];
  if (referer) args.push('-e', referer);
  const cookie = cookieHeader(url);
  if (cookie) args.push('-H', `Cookie: ${cookie}`);
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, {
      timeout: timeout + 4000,
      maxBuffer: 40 * 1024 * 1024,
      encoding: 'buffer',
    });
    curlAvailable = true;
    const sep = stdout.indexOf(Buffer.from('\r\n\r\n'));
    if (sep < 0) return null;
    const head = stdout.subarray(0, sep).toString('latin1');
    const body = stdout.subarray(sep + 4);
    const lines = head.split(/\r?\n/);
    const status = parseInt((lines[0].match(/\s(\d{3})\s/) || [])[1], 10) || 0;
    const headers = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return { status, headers, body };
  } catch (e) {
    if (e.code === 'ENOENT') curlAvailable = false;
    return null;
  }
}

/** Cek sekali apakah binary curl tersedia (dipakai /health untuk diagnosa deploy). */
async function curlIsAvailable() {
  if (!CURL_FALLBACK) return false;
  if (curlAvailable !== undefined) return curlAvailable;
  try {
    await execFileAsync('curl', ['--version'], { timeout: 5000 });
    curlAvailable = true;
  } catch {
    curlAvailable = false;
  }
  return curlAvailable;
}

async function axiosGet(url, { referer, headers = {}, timeout = 15000, accept } = {}) {
  const cookie = cookieHeader(url);
  const res = await axios.get(url, {
    timeout,
    headers: browserHeaders(referer, {
      ...(accept ? { Accept: accept } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    }),
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 5,
  });
  storeSetCookie(url, res.headers['set-cookie']);
  return res;
}

/**
 * Ambil HTML/JSON dengan retry + cache + cookie + fallback Cloudflare.
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.referer]
 * @param {number} [opts.ttl] cache TTL (ms)
 * @param {number} [opts.retries]
 * @param {number} [opts.timeout]
 * @param {string} [opts.accept]
 * @param {object} [opts.headers]
 * @returns {Promise<string>}
 */
async function fetchHtml(url, { referer, ttl = CACHE_TTL, retries = 2, timeout = 15000, accept, headers = {} } = {}) {
  const key = `html:${url}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axiosGet(url, { referer, timeout, accept, headers });
      if (isCloudflare(res.status, res.data, res.headers)) {
        // 1) coba curl: TLS fingerprint-nya sering diterima Cloudflare
        const viaCurl = await curlFetch(url, { referer, timeout, accept });
        if (viaCurl && !isCloudflare(viaCurl.status, viaCurl.body, viaCurl.headers)) {
          if (viaCurl.status === 404) throw new AppError('Halaman tidak ditemukan di situs sumber', 404, 'NOT_FOUND');
          if (viaCurl.status >= 400) {
            throw new AppError(`Situs sumber membalas HTTP ${viaCurl.status}`, 502, 'UPSTREAM_ERROR',
              viaCurl.status >= 500 || viaCurl.status === 429);
          }
          cacheSet(key, viaCurl.body, ttl);
          return viaCurl.body;
        }
        // 2) terakhir: FlareSolverr (browser headless + session/cookie)
        const body = await solveWithFlareSolverr(url);
        cacheSet(key, body, ttl);
        return body;
      }
      if (res.status === 404) throw new AppError('Halaman tidak ditemukan di situs sumber', 404, 'NOT_FOUND');
      if (res.status >= 400) {
        throw new AppError(`Situs sumber membalas HTTP ${res.status}`, 502, 'UPSTREAM_ERROR',
          res.status >= 500 || res.status === 429);
      }
      cacheSet(key, res.data, ttl);
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

/** Seperti fetchHtml, tetapi hasilnya di-parse sebagai JSON. */
async function fetchJson(url, opts = {}) {
  const text = await fetchHtml(url, {
    ...opts,
    accept: opts.accept || 'application/json, text/plain, */*',
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('Situs sumber tidak mengembalikan JSON yang valid', 502, 'UPSTREAM_ERROR');
  }
}

module.exports = {
  fetchHtml, fetchJson, browserHeaders, curlImage, UA, isCloudflare,
  curlIsAvailable, flareSolverrAvailable: flareIsAvailable,
};
