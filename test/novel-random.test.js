'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../src/configureApp');
const { mulberry32, pickIndex } = require('../src/novel/client');

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

test('mulberry32 deterministik untuk seed yang sama', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const first = [a(), a(), a(), a()];
  const second = [b(), b(), b(), b()];

  assert.deepEqual(first, second);
  first.forEach((value) => assert.ok(value >= 0 && value < 1));
});

test('mulberry32 menghasilkan urutan berbeda untuk seed berbeda', () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('pickIndex aman untuk batas dan nilai acak di luar rentang', () => {
  assert.equal(pickIndex(0), -1);
  assert.equal(pickIndex(-3), -1);
  assert.equal(pickIndex(10, () => 0), 0);
  assert.equal(pickIndex(10, () => 0.999999), 9);
  assert.equal(pickIndex(10, () => 1), 9);
  assert.equal(pickIndex(10, () => -1), 0);
  assert.equal(pickIndex(10, () => Number.NaN), 0);
});

test('endpoint acak memvalidasi seed dan limit sebelum menyentuh sumber', async () => {
  await withServer(async (base) => {
    const badSeed = await fetch(`${base}/api/novels/random?seed=abc`);
    assert.equal(badSeed.status, 400);
    assert.equal((await badSeed.json()).code, 'BAD_REQUEST');

    const tooBig = await fetch(`${base}/api/novels/random?seed=99999999999`);
    assert.equal(tooBig.status, 400);

    const badLimit = await fetch(`${base}/api/novels/random?limit=999`);
    assert.equal(badLimit.status, 400);

    const badChapterSeed = await fetch(
      `${base}/api/novels/contoh-novel/random-chapter?seed=abc`,
    );
    assert.equal(badChapterSeed.status, 400);
    assert.equal((await badChapterSeed.json()).code, 'BAD_REQUEST');
  });
});
