'use strict';
/**
 * Kontrol akses API.
 *
 * - API_KEYS (boleh lebih dari satu, pisahkan dengan koma) mengaktifkan mode
 *   terkunci. Semua endpoint data wajib menyertakan kunci lewat header
 *   `x-api-key` atau `Authorization: Bearer <kunci>`.
 * - ALLOWED_ORIGINS membatasi browser yang boleh memakai API. Isi dengan
 *   origin frontend sendiri, misalnya `https://proyekku.vercel.app`.
 * - Bila API_KEYS kosong, API tetap terbuka seperti sebelumnya. Ini berguna
 *   untuk pengembangan lokal, tetapi di Vercel sebaiknya selalu diisi.
 */
const crypto = require('crypto');
const { AppError } = require('./errors');

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const API_KEYS = parseList(process.env.API_KEYS || process.env.API_KEY);
const ALLOWED_ORIGINS = parseList(process.env.ALLOWED_ORIGINS);
const FORCE_KEY = /^(1|true|yes|on)$/i.test(String(process.env.REQUIRE_API_KEY || ''));

const AUTH_REQUIRED = API_KEYS.length > 0 || FORCE_KEY;

/** Path yang tetap bisa dibuka tanpa kunci (dokumentasi dan cek kesehatan). */
const PUBLIC_PATHS = new Set(['/', '/health', '/favicon.ico']);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cocokkan origin dengan pola. `*` boleh dipakai, mis. https://proyek-*.vercel.app */
function originMatches(pattern, origin) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern.toLowerCase() === origin.toLowerCase();
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`, 'i');
  return regex.test(origin);
}

function isOriginAllowed(origin) {
  // Request tanpa Origin (curl, server-side, <img>) tidak dibatasi di sini.
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.length) return true;
  return ALLOWED_ORIGINS.some((pattern) => originMatches(pattern, origin));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function keyFromRequest(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();

  const authorization = req.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  // Query hanya untuk kemudahan integrasi, usahakan tetap memakai header.
  return String(req.query.api_key || req.query.key || '').trim();
}

function isValidKey(key) {
  if (!key || !API_KEYS.length) return false;
  return API_KEYS.some((candidate) => safeEqual(candidate, key));
}

function isPublicPath(path) {
  return PUBLIC_PATHS.has(path);
}

/**
 * Middleware untuk endpoint data. Signature URL gambar ditangani terpisah
 * oleh route /api/image karena <img> tidak bisa mengirim header.
 */
function requireApiKey(req, res, next) {
  if (!AUTH_REQUIRED) return next();
  if (isValidKey(keyFromRequest(req))) return next();

  return next(
    new AppError(
      'API key tidak valid. Kirim header x-api-key atau Authorization: Bearer <key>.',
      401,
      'UNAUTHORIZED',
    ),
  );
}

/** Middleware yang memastikan origin browser ada di daftar putih. */
function requireAllowedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (isOriginAllowed(origin)) return next();

  return next(new AppError('Origin tidak diizinkan memakai API ini', 403, 'FORBIDDEN'));
}

module.exports = {
  API_KEYS,
  ALLOWED_ORIGINS,
  AUTH_REQUIRED,
  PUBLIC_PATHS,
  isOriginAllowed,
  isPublicPath,
  isValidKey,
  keyFromRequest,
  requireAllowedOrigin,
  requireApiKey,
  safeEqual,
};
