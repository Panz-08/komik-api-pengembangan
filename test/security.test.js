'use strict';
// Tes kontrol akses. Environment harus diatur sebelum modul dimuat.
process.env.API_KEYS = 'test-key-1,test-key-2';
process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://preview-*.vercel.app';
process.env.IMAGE_SIGNING_SECRET = 'signing-secret';
process.env.REQUIRE_API_KEY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../src/configureApp');
const { signImageUrl, verifyImageUrl } = require('../src/lib/signedUrl');

async function withServer(run) {
  const app = configureApp(express());
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('endpoint data menolak request tanpa API key', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sources`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'UNAUTHORIZED');
  });
});

test('endpoint data menerima x-api-key dan Bearer', async () => {
  await withServer(async (base) => {
    const viaHeader = await fetch(`${base}/api/sources`, {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.equal(viaHeader.status, 200);

    const viaBearer = await fetch(`${base}/api/sources`, {
      headers: { authorization: 'Bearer test-key-2' },
    });
    assert.equal(viaBearer.status, 200);
  });
});

test('origin yang tidak terdaftar ditolak walau membawa API key', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sources`, {
      headers: { origin: 'https://situs-lain.example', 'x-api-key': 'test-key-1' },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'FORBIDDEN');
  });
});

test('origin terdaftar dan wildcard Vercel diizinkan', async () => {
  await withServer(async (base) => {
    const exact = await fetch(`${base}/api/sources`, {
      headers: { origin: 'https://app.example.com', 'x-api-key': 'test-key-1' },
    });
    assert.equal(exact.status, 200);

    const preview = await fetch(`${base}/api/sources`, {
      headers: { origin: 'https://preview-abc123.vercel.app', 'x-api-key': 'test-key-1' },
    });
    assert.equal(preview.status, 200);
  });
});

test('root dan health tetap terbuka', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test('gambar tanpa tanda tangan atau API key ditolak', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/image?url=not-a-url`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'UNAUTHORIZED');
  });
});

test('gambar dengan tanda tangan sah lolos pemeriksaan akses', async () => {
  await withServer(async (base) => {
    const url = 'not-a-url';
    const { exp, sig } = signImageUrl(url, '');
    const res = await fetch(
      `${base}/api/image?url=${encodeURIComponent(url)}&exp=${exp}&sig=${encodeURIComponent(sig)}`,
    );
    // Lolos auth, lalu ditolak validasi URL (400), bukan 401.
    assert.equal(res.status, 400);
  });
});

test('tanda tangan gambar kedaluwarsa ditolak', () => {
  const url = 'https://example.com/a.jpg';
  const exp = Math.floor(Date.now() / 1000) - 10;
  const { signatureFor } = require('../src/lib/signedUrl');
  assert.equal(verifyImageUrl(url, '', exp, signatureFor(url, '', exp)), false);
});

test('tanda tangan gambar tidak berlaku untuk URL lain', () => {
  const { exp, sig } = signImageUrl('https://example.com/a.jpg', '');
  assert.equal(verifyImageUrl('https://example.com/b.jpg', '', exp, sig), false);
});
