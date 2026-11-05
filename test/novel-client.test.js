'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeNovel,
  normalizeChapter,
  normalizeGenre,
  chapterNumber,
  pagination,
  buildUrl,
  isCloudflareChallenge,
} = require('../src/novel/client');

test('normalizeNovel memetakan term WordPress', () => {
  const novel = normalizeNovel({
    id: 1789,
    name: 'The Victim &amp; the Academy',
    slug: 'the-victim-of-the-academy',
    link: 'https://sakuranovel.id/seri/the-victim-of-the-academy/',
    count: 372,
    description: '<p>Deskripsi</p>',
  });

  assert.equal(novel.id, 1789);
  assert.equal(novel.title, 'The Victim & the Academy');
  assert.equal(novel.chapterCount, 372);
  assert.equal(novel.description, 'Deskripsi');
  assert.equal(novel.endpoints.detail, '/api/novels/the-victim-of-the-academy');
});

test('normalizeChapter membatasi excerpt dan menandai konten tidak tersedia', () => {
  const chapter = normalizeChapter(
    {
      id: 1,
      slug: 'chapter-1',
      link: 'https://sakuranovel.id/chapter-1/',
      title: { rendered: 'Novel Chapter 1 &ndash; Mulai' },
      date: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00',
      excerpt: { rendered: `<p>${'kata '.repeat(200)}</p>` },
      seri: [1789],
    },
    {
      id: 1789,
      name: 'Novel',
      slug: 'novel',
      link: 'https://sakuranovel.id/seri/novel/',
    },
  );

  assert.equal(chapter.title, 'Novel Chapter 1 – Mulai');
  assert.equal(chapter.chapterNumber, 1);
  assert.equal(chapter.contentAvailable, false);
  assert.equal(chapter.series.url, 'https://sakuranovel.id/seri/novel/');
  assert.ok(chapter.excerpt.length <= 320);
  assert.ok(chapter.excerpt.endsWith('…'));
});

test('normalizeChapter menyajikan teks lengkap saat diminta', () => {
  const chapter = normalizeChapter(
    {
      id: 2,
      slug: 'chapter-2',
      link: 'https://sakuranovel.id/chapter-2/',
      title: { rendered: 'Novel Chapter 2' },
      date: '2026-01-02T00:00:00',
      content: { rendered: '<p>Paragraf pertama.</p><p>Paragraf kedua.</p>' },
      excerpt: { rendered: '<p>Paragraf pertama.</p>' },
      seri: [1789],
    },
    null,
    { includeContent: true },
  );

  assert.equal(chapter.contentAvailable, true);
  assert.deepEqual(chapter.paragraphs, ['Paragraf pertama.', 'Paragraf kedua.']);
  assert.equal(chapter.content, 'Paragraf pertama.\n\nParagraf kedua.');
  assert.equal(chapter.wordCount, 4);
  assert.equal(chapter.readingMinutes, 1);
});

test('normalizeGenre memetakan tag', () => {
  assert.deepEqual(normalizeGenre({ id: 17, name: 'Action', slug: 'action', count: 10 }), {
    id: 17,
    slug: 'action',
    name: 'Action',
    count: 10,
    url: null,
  });
});

test('chapterNumber mengenali berbagai format', () => {
  assert.equal(chapterNumber('Novel Chapter 12.5 Bahasa Indonesia'), 12.5);
  assert.equal(chapterNumber('Novel Ch. 7'), 7);
  assert.equal(chapterNumber('Bab 9 – Pulang'), 9);
  assert.equal(chapterNumber('Tanpa nomor'), null);
});

test('pagination menghitung next/prev', () => {
  assert.deepEqual(pagination(1, 20, 476, 24), {
    page: 1,
    limit: 20,
    total: 476,
    totalPages: 24,
    hasPrev: false,
    hasNext: true,
  });
});

test('buildUrl meng-encode path dan query dengan aman', () => {
  const url = buildUrl('posts?x', { search: 'a b', page: 2 });
  assert.equal(url.origin, 'https://sakuranovel.id');
  assert.match(url.pathname, /^\/wp-json\/wp\/v2\/posts%3Fx$/);
  assert.equal(url.searchParams.get('search'), 'a b');
});

test('isCloudflareChallenge mendeteksi halaman challenge', () => {
  assert.equal(
    isCloudflareChallenge('<title>Just a moment...</title>', new Headers()),
    true,
  );
  assert.equal(
    isCloudflareChallenge('{}', new Headers({ 'cf-mitigated': 'challenge' })),
    true,
  );
  assert.equal(isCloudflareChallenge('[]', new Headers()), false);
});
