'use strict';
/**
 * Tanda tangan URL gambar.
 *
 * <img src="..."> tidak bisa mengirim header x-api-key, jadi URL proxy gambar
 * dibuat bertanda tangan dan berumur pendek. URL hanya bisa dibuat lewat
 * endpoint API yang sudah terautentikasi.
 */
const crypto = require('crypto');

const apiKeys = String(process.env.API_KEYS || process.env.API_KEY || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const SECRET = String(
  process.env.IMAGE_SIGNING_SECRET || apiKeys[0] || '',
).trim();

const parsedTtl = Number(process.env.IMAGE_URL_TTL_SECONDS || 86400);
const TTL_SECONDS = Number.isFinite(parsedTtl) && parsedTtl > 0 ? Math.floor(parsedTtl) : 86400;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signatureFor(url, site, exp) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${url}\n${site || ''}\n${exp}`)
    .digest('base64url')
    .slice(0, 43);
}

/** Buat parameter tanda tangan. Mengembalikan null bila belum ada secret. */
function signImageUrl(url, site = '') {
  if (!SECRET) return null;
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return { exp, sig: signatureFor(url, site, exp) };
}

/** Verifikasi parameter exp/sig pada URL gambar. */
function verifyImageUrl(url, site = '', exp, sig) {
  if (!SECRET) return false;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;

  return safeEqual(signatureFor(url, site, expiresAt), String(sig || ''));
}

/** Cek apakah request /api/image membawa tanda tangan yang sah. */
function verifyImageRequest(req) {
  return verifyImageUrl(
    String(req.query.url || ''),
    String(req.query.site || ''),
    req.query.exp,
    req.query.sig,
  );
}

module.exports = {
  SECRET,
  TTL_SECONDS,
  signImageUrl,
  signatureFor,
  verifyImageUrl,
  verifyImageRequest,
};
