'use strict';
// Tes batas ukuran respons gambar (tanpa jaringan).
const test = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  contentLengthTooLarge,
  formatBytes,
} = require('../src/lib/limits');

test('contentLengthTooLarge: mendeteksi Content-Length berlebih', () => {
  assert.strictEqual(contentLengthTooLarge({ 'content-length': 11 }, 10), true);
  assert.strictEqual(contentLengthTooLarge({ 'Content-Length': '11' }, 10), true);
});

test('contentLengthTooLarge: menerima ukuran di bawah/tepat batas', () => {
  assert.strictEqual(contentLengthTooLarge({ 'content-length': '10' }, 10), false);
  assert.strictEqual(contentLengthTooLarge({ 'content-length': 1 }, 10), false);
});

test('contentLengthTooLarge: aman bila header tidak ada atau tidak valid', () => {
  assert.strictEqual(contentLengthTooLarge({}, 10), false);
  assert.strictEqual(contentLengthTooLarge(null, 10), false);
  assert.strictEqual(contentLengthTooLarge({ 'content-length': 'abc' }, 10), false);
  assert.strictEqual(contentLengthTooLarge({ 'content-length': '' }, 10), false);
});

test('batas default 10 MB dan formatBytes', () => {
  assert.strictEqual(DEFAULT_MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.ok(MAX_IMAGE_BYTES > 0);
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(2048), '2.0 KB');
  assert.strictEqual(formatBytes(10 * 1024 * 1024), '10.0 MB');
});
