'use strict';

/**
 * Batas ukuran gambar yang boleh diproksikan /api/image.
 *
 * Nilai bisa diubah lewat MAX_IMAGE_BYTES (byte). Default 10 MB supaya satu
 * request tidak menghabiskan bandwidth/kuota function.
 */
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const parsed = Number(process.env.MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES);
const MAX_IMAGE_BYTES = Number.isFinite(parsed) && parsed > 0
  ? Math.floor(parsed)
  : DEFAULT_MAX_IMAGE_BYTES;

/** True bila header Content-Length ada dan melebihi batas. */
function contentLengthTooLarge(headers, max = MAX_IMAGE_BYTES) {
  if (!headers) return false;
  const raw = headers['content-length'] ?? headers['Content-Length'];
  if (raw === undefined || raw === null || raw === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > max;
}

/** Format byte menjadi string ringkas untuk pesan error. */
function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

module.exports = {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  contentLengthTooLarge,
  formatBytes,
};
