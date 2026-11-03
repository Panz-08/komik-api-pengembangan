'use strict';
const dns = require('dns').promises;
const net = require('net');
const { AppError } = require('./errors');

const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const toAbs = (href, base) => {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
};

/** Ambil URL gambar dari <img>, termasuk atribut lazy-load. */
const imgSrc = (el) => {
  if (!el || !el.length) return '';
  const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'src'];
  for (const a of attrs) {
    const v = (el.attr(a) || '').trim();
    if (v && !v.startsWith('data:')) return v;
  }
  const set = el.attr('data-srcset') || el.attr('srcset') || '';
  const first = set.split(',')[0].trim().split(/\s+/)[0];
  return first && !first.startsWith('data:') ? first : '';
};

// gambar non-konten (logo, banner, iklan, dst). "uploads/" tidak ikut terhitung iklan.
const BAD_IMG = /(logo|avatar|gravatar|icon|banner|sprite|emoji|loading|placeholder|favicon|histats|promosi|iklan|sponsor|(^|[/_-])ads?([/_.-]|$))/i;
const isComicImage = (url) =>
  !!url && !url.startsWith('data:') && !BAD_IMG.test(url) &&
  (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(url) || /\/uploads\//i.test(url));

/** "Chapter 12.5" -> 12.5 ; tidak ada angka -> null */
const chapterNumber = (title) => {
  const t = String(title || '');
  const m =
    t.match(/(?:chapter|chap|ch|episode|eps?|bab)\.?\s*([0-9]+(?:[.,][0-9]+)?)/i) ||
    t.match(/([0-9]+(?:[.,][0-9]+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

const encodeId = (url) => Buffer.from(url, 'utf8').toString('base64url');
const decodeId = (id) => {
  try {
    const url = Buffer.from(String(id), 'base64url').toString('utf8');
    if (!/^https?:\/\//i.test(url)) throw new Error('bad');
    return url;
  } catch {
    throw new AppError('chapterId tidak valid', 400, 'BAD_REQUEST');
  }
};

const unique = (arr) => [...new Set(arr)];

// ---------- proteksi SSRF untuk proxy gambar ----------
const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true;
};

async function assertPublicUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new AppError('URL tidak valid', 400, 'BAD_REQUEST');
  }
  if (!/^https?:$/.test(u.protocol)) throw new AppError('Hanya http/https', 400, 'BAD_REQUEST');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) {
    throw new AppError('Alamat tujuan tidak diizinkan', 403, 'FORBIDDEN');
  }
  return u;
}

module.exports = {
  cleanText, toAbs, imgSrc, isComicImage, chapterNumber,
  encodeId, decodeId, unique, isPrivateIp, assertPublicUrl,
};
