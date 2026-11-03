'use strict';
// Tes deteksi Cloudflare (tanpa jaringan).
const test = require('node:test');
const assert = require('node:assert');
const { isCloudflare } = require('../src/lib/http');

test('isCloudflare: halaman "Just a moment"', () => {
  assert.strictEqual(isCloudflare(403, '<html><title>Just a moment...</title></html>'), true);
  assert.strictEqual(isCloudflare(200, '<html><title>Just a moment...</title></html>'), true);
});

test('isCloudflare: header cf-mitigated', () => {
  assert.strictEqual(isCloudflare(403, 'Forbidden', { 'cf-mitigated': 'challenge' }), true);
  assert.strictEqual(isCloudflare(200, 'ok', { 'CF-Mitigated': 'CHALLENGE' }), true);
});

test('isCloudflare: challenge-platform pada status terkait', () => {
  assert.strictEqual(isCloudflare(503, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>'), true);
  assert.strictEqual(isCloudflare(429, 'performing security verification'), true);
});

test('isCloudflare: halaman normal bukan challenge', () => {
  assert.strictEqual(isCloudflare(200, '<html><title>Komik</title></html>'), false);
  assert.strictEqual(isCloudflare(403, '<html><body>Forbidden</body></html>'), false);
  assert.strictEqual(isCloudflare(404, 'Not Found'), false);
});
