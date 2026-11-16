'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getChapterNeighbors } = require('../src/novel/client');

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-wp-total': '10',
      'x-wp-totalpages': '2',
    },
  });
}

test('getChapterNeighbors mengambil chapter sebelum dan sesudah lewat tanggal', async () => {
  const originalFetch = global.fetch;
  const urls = [];

  global.fetch = async (url) => {
    const href = String(url);
    urls.push(href);

    if (href.includes('/wp-json/wp/v2/posts/9001')) {
      return jsonResponse({
        id: 9001,
        slug: 'novel-chapter-5',
        link: 'https://sakuranovel.id/novel-chapter-5/',
        title: { rendered: 'Novel Chapter 5' },
        date: '2026-02-05T00:00:00',
        modified: '2026-02-05T00:00:00',
        seri: [77],
      });
    }
    if (href.includes('/wp-json/wp/v2/seri/77')) {
      return jsonResponse({
        id: 77,
        name: 'Novel Uji',
        slug: 'novel-uji',
        link: 'https://sakuranovel.id/seri/novel-uji/',
      });
    }
    if (href.includes('/wp-json/wp/v2/posts?')) {
      if (href.includes('before=')) {
        return jsonResponse([
          {
            id: 9000,
            slug: 'novel-chapter-4',
            link: 'https://sakuranovel.id/novel-chapter-4/',
            title: { rendered: 'Novel Chapter 4' },
            date: '2026-02-04T00:00:00',
            seri: [77],
          },
        ]);
      }
      return jsonResponse([
        {
          id: 9002,
          slug: 'novel-chapter-6',
          link: 'https://sakuranovel.id/novel-chapter-6/',
          title: { rendered: 'Novel Chapter 6' },
          date: '2026-02-06T00:00:00',
          seri: [77],
        },
      ]);
    }
    throw new Error(`URL tak terduga: ${href}`);
  };

  try {
    const result = await getChapterNeighbors(9001);
    assert.equal(result.item.chapter.id, 9001);
    assert.equal(result.item.previous.id, 9000);
    assert.equal(result.item.previous.chapterNumber, 4);
    assert.equal(result.item.next.id, 9002);
    assert.equal(result.item.next.chapterNumber, 6);
    assert.equal(result.item.next.series.title, 'Novel Uji');
    assert.ok(urls.some((u) => u.includes('exclude=9001')));
    assert.ok(urls.some((u) => u.includes('orderby=date')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('getChapterNeighbors menolak ID yang tidak valid', async () => {
  await assert.rejects(() => getChapterNeighbors('abc'), (err) => {
    assert.equal(err.status, 400);
    return true;
  });
});
