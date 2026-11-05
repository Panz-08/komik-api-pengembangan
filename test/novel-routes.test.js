'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../src/configureApp');

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

test('root dan daftar sumber menampilkan komik + novel', async () => {
  await withServer(async (base) => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    const docs = await root.json();
    assert.equal(docs.name, 'Komik & Novel API');
    assert.ok(docs.endpoints.some((endpoint) => endpoint.includes('/api/novels')));

    const sources = await fetch(`${base}/api/sources`);
    assert.equal(sources.status, 200);
    const body = await sources.json();
    assert.ok(Array.isArray(body.data.comics));
    assert.equal(body.data.novels[0].id, 'sakuranovel');
  });
});

test('validasi endpoint novel tidak menyentuh sumber', async () => {
  await withServer(async (base) => {
    const badLimit = await fetch(`${base}/api/novels?limit=999`);
    assert.equal(badLimit.status, 400);
    assert.equal((await badLimit.json()).code, 'BAD_REQUEST');

    const noQuery = await fetch(`${base}/api/novels/search`);
    assert.equal(noQuery.status, 400);

    const badChapter = await fetch(`${base}/api/novels/chapters/abc`);
    assert.equal(badChapter.status, 400);
  });
});
