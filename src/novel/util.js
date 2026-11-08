'use strict';

const { AppError } = require('../lib/errors');

const badRequest = (message) => new AppError(message, 400, 'BAD_REQUEST');
const notFound = (message = 'Data tidak ditemukan') => new AppError(message, 404, 'NOT_FOUND');

const ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '-',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  rsquo: '’',
  trade: '™',
};

function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1].toLowerCase() === 'x';
      const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(number) && number > 0 && number <= 0x10ffff) {
        try {
          return String.fromCodePoint(number);
        } catch {
          return match;
        }
      }
      return match;
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, code.toLowerCase())
      ? ENTITIES[code.toLowerCase()]
      : match;
  });
}

function stripHtml(value) {
  return decodeEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToParagraphs(value) {
  const text = String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim())
    .filter(Boolean);
}

function wordCount(paragraphs) {
  const text = Array.isArray(paragraphs) ? paragraphs.join(' ') : String(paragraphs || '');
  return (text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
}

function truncateText(value, max = 320) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function parseInteger(value, { name = 'parameter', min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw badRequest(`${name} harus berupa angka antara ${min} dan ${max}`);
  }
  return parsed;
}

function parsePage(value, fallback = 1) {
  return parseInteger(value, { name: 'page', min: 1, max: 100000, fallback });
}

function parseLimit(value, fallback = 20, max = 100) {
  return parseInteger(value, { name: 'limit', min: 1, max, fallback });
}

function parseOrder(value, fallback = 'desc') {
  if (value === undefined || value === '') return fallback;
  const order = String(value).toLowerCase();
  if (order !== 'asc' && order !== 'desc') {
    throw badRequest('order harus "asc" atau "desc"');
  }
  return order;
}

function cleanSearch(value, { max = 120 } = {}) {
  const search = String(value || '').replace(/\s+/g, ' ').trim();
  if (!search) return '';
  if (search.length > max) throw badRequest(`q maksimal ${max} karakter`);
  if (/[<>\0]/.test(search)) throw badRequest('q mengandung karakter yang tidak diizinkan');
  return search;
}

function assertSlug(value) {
  const slug = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    throw badRequest('Slug tidak valid');
  }
  return slug;
}

module.exports = {
  AppError,
  badRequest,
  notFound,
  decodeEntities,
  stripHtml,
  htmlToParagraphs,
  wordCount,
  truncateText,
  parseInteger,
  parsePage,
  parseLimit,
  parseOrder,
  cleanSearch,
  assertSlug,
};
