'use strict';
const test = require('node:test');
const assert = require('node:assert');
const u = require('../src/lib/util');

test('chapterNumber', () => {
  assert.strictEqual(u.chapterNumber('Chapter 12.5'), 12.5);
  assert.strictEqual(u.chapterNumber('Ch. 7 - judul'), 7);
  assert.strictEqual(u.chapterNumber('Oneshot'), null);
});

test('encodeId/decodeId roundtrip dan validasi', () => {
  const url = 'https://komiku.org/solo-leveling-chapter-1/';
  assert.strictEqual(u.decodeId(u.encodeId(url)), url);
  assert.throws(() => u.decodeId(Buffer.from('bukan-url').toString('base64url')));
});

test('isPrivateIp', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'])
    assert.ok(u.isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1']) assert.ok(!u.isPrivateIp(ip), ip);
});

test('assertPublicUrl menolak alamat internal', async () => {
  await assert.rejects(u.assertPublicUrl('http://127.0.0.1:3000/'));
  await assert.rejects(u.assertPublicUrl('http://169.254.169.254/latest/meta-data'));
  await assert.rejects(u.assertPublicUrl('file:///etc/passwd'));
});

test('isComicImage', () => {
  assert.ok(u.isComicImage('https://x.com/wp-content/uploads/2024/01/001.jpg'));
  assert.ok(!u.isComicImage('https://x.com/images/logo.png'));
  assert.ok(!u.isComicImage('data:image/png;base64,xx'));
});
