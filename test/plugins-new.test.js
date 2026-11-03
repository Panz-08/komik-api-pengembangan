'use strict';
// Tes parsing plugin baru memakai HTML/JSON contoh (tanpa internet).
const test = require('node:test');
const assert = require('node:assert');
const cheerio = require('cheerio');
const MgKomik = require('../src/plugins/mgkomik');
const KomikuAsia = require('../src/plugins/komikuAsia');
const Shinigami = require('../src/plugins/shinigami');
const { encodeId } = require('../src/lib/util');

const withHtml = (plugin, html, url) => {
  plugin.load = async () => ({ $: cheerio.load(html), url, html });
  return plugin;
};

// Bungkus payload JSON seperti flight data Next.js: self.__next_f.push([1,"<json>"])
const flight = (obj) =>
  `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(obj))}])</script>`;

// ---------- MGKomik ----------
test('mgkomik: search (dua varian markup manga-card)', async () => {
  const p = withHtml(new MgKomik(), `
    <div class="manga-card">
      <a href="https://web1.mgkomik.cc/komik/solo-leveling/" title="Solo Leveling">
        <img data-src="/c/solo.jpg" src="data:image/gif;base64,R0lG"></a>
    </div>
    <a class="manga-card" href="https://web1.mgkomik.cc/komik/solo-farming/" title="Solo Farming">
      <img src="/c/farm.jpg"></a>`, 'https://web1.mgkomik.cc/search/?q=solo');
  const { comics } = await p.search('solo');
  assert.deepStrictEqual(comics.map((c) => c.id), ['solo-leveling', 'solo-farming']);
  assert.strictEqual(comics[0].title, 'Solo Leveling');
  assert.strictEqual(comics[0].cover, 'https://web1.mgkomik.cc/c/solo.jpg');
});

test('mgkomik: comic memakai og:image dan chapters', async () => {
  const p = withHtml(new MgKomik(), `
    <meta property="og:image" content="https://id.mgkomik.cc/wp-content/uploads/cover.jpg">
    <div class="manga-info-col">
      <h1 class="manga-title">Solo Leveling</h1>
      <img src="/banner/gaza88.gif">
    </div>
    <div class="manga-description"><div id="sinopsisContainer">Sinopsis singkat.</div></div>
    <div class="genre-list">
      <a class="genre-tag">Action</a><a class="genre-tag">Fantasy</a>
    </div>
    <span class="status-badge">Status: Ongoing</span>
    <div id="chapterList">
      <a class="chapter-link" href="https://web1.mgkomik.cc/komik/solo-leveling/chapter-2/">Chapter 2</a>
      <a class="chapter-link" href="https://web1.mgkomik.cc/komik/solo-leveling/chapter-1/">Chapter 1</a>
    </div>`, 'https://web1.mgkomik.cc/komik/solo-leveling/');
  const c = await p.comic('solo-leveling');
  assert.strictEqual(c.title, 'Solo Leveling');
  assert.strictEqual(c.cover, 'https://id.mgkomik.cc/wp-content/uploads/cover.jpg');
  assert.deepStrictEqual(c.genres, ['Action', 'Fantasy']);
  assert.strictEqual(c.status, 'Ongoing');
  assert.strictEqual(c.chapters.length, 2);
  assert.strictEqual(c.chapters[0].number, 2);
});

test('mgkomik: pages', async () => {
  const p = withHtml(new MgKomik(), `
    <div id="readingContent">
      <img data-src="https://static2.mgis.my.id/manga/x/chapter-1/image-0.webp">
      <img src="https://static2.mgis.my.id/manga/x/chapter-1/image-1.webp">
    </div>`, 'https://web1.mgkomik.cc/komik/x/chapter-1/');
  const r = await p.pages('https://web1.mgkomik.cc/komik/x/chapter-1/');
  assert.deepStrictEqual(r.pages, [
    'https://static2.mgis.my.id/manga/x/chapter-1/image-0.webp',
    'https://static2.mgis.my.id/manga/x/chapter-1/image-1.webp',
  ]);
});

// ---------- Komiku Asia (Next.js flight data) ----------
test('komiku-asia: search dari flight data', async () => {
  const p = withHtml(new KomikuAsia(), flight({
    items: [{ slug: 'solo-leveling', title: 'Solo Leveling', coverUrl: '/cover.jpg', type: 'Manhwa', status: 'Ongoing' }],
  }), 'https://01.komiku.asia/browse?q=solo');
  const { comics } = await p.search('solo');
  assert.strictEqual(comics.length, 1);
  assert.strictEqual(comics[0].id, 'solo-leveling');
  assert.strictEqual(comics[0].title, 'Solo Leveling');
  assert.strictEqual(comics[0].cover, 'https://01.komiku.asia/cover.jpg');
  assert.strictEqual(comics[0].type, 'Manhwa');
});

test('komiku-asia: comic + chapters dari flight data', async () => {
  const html = flight({
    comic: {
      title: 'Solo Leveling', coverUrl: 'https://content.komiku.me/c.jpg',
      synopsis: 'Sinopsis.', genres: ['Action', 'Fantasy'], status: 'Ongoing',
      type: 'Manhwa', author: 'Chugong', artist: '-',
    },
    chapters: [
      { id: 123, n: 2, title: 'Chapter 2', releasedLabel: '2 days ago' },
      { id: 122, n: 1, title: 'Chapter 1' },
    ],
  }) + '<a href="/read/id/solo-leveling/ch1-122">Chapter 1</a>';
  const p = withHtml(new KomikuAsia(), html, 'https://01.komiku.asia/manga/solo-leveling');
  const c = await p.comic('solo-leveling');
  assert.strictEqual(c.title, 'Solo Leveling');
  assert.strictEqual(c.cover, 'https://content.komiku.me/c.jpg');
  assert.deepStrictEqual(c.genres, ['Action', 'Fantasy']);
  assert.strictEqual(c.author, 'Chugong');
  assert.strictEqual(c.artist, undefined);
  assert.strictEqual(c.chapters.length, 2);
  assert.strictEqual(c.chapters[0].number, 2);
  assert.strictEqual(c.chapters[0].url, 'https://01.komiku.asia/read/id/solo-leveling/ch2-123');
  assert.strictEqual(c.chapters[0].id, encodeId('https://01.komiku.asia/read/id/solo-leveling/ch2-123'));
  assert.strictEqual(c.chapters[0].date, '2 days ago');
});

test('komiku-asia: pages dari HTML reader', async () => {
  const p = withHtml(new KomikuAsia(), `
    <img class="rd-page-image" src="https://cdnkomiku.xyz/wp-content/a.jpg">
    <img class="rd-page-image" data-src="https://cdnkomiku.xyz/wp-content/b.webp">`,
  'https://01.komiku.asia/read/id/x/ch1-1');
  const r = await p.pages('https://01.komiku.asia/read/id/x/ch1-1');
  assert.deepStrictEqual(r.pages, [
    'https://cdnkomiku.xyz/wp-content/a.jpg',
    'https://cdnkomiku.xyz/wp-content/b.webp',
  ]);
});

test('komiku-asia: pages fallback dari flight data', async () => {
  const p = withHtml(new KomikuAsia(), flight({
    pages: [{ url: 'https://cdnkomiku.xyz/wp-content/1.jpg' }, { url: 'https://cdnkomiku.xyz/wp-content/2.jpg' }],
  }), 'https://01.komiku.asia/read/id/x/ch1-1');
  const r = await p.pages('https://01.komiku.asia/read/id/x/ch1-1');
  assert.deepStrictEqual(r.pages, [
    'https://cdnkomiku.xyz/wp-content/1.jpg',
    'https://cdnkomiku.xyz/wp-content/2.jpg',
  ]);
});

// ---------- Shinigami (API) ----------
const MANGA_ID = 'ad6fa0a8-43b5-4dd1-aa89-1a1bbde66f65';
const CHAPTER_ID = '5e4a9ee1-1111-2222-3333-444455556666';

const stubShinigamiApi = (p, routes) => {
  p.loadJson = async (url) => {
    const path = new URL(url).pathname;
    const handler = Object.entries(routes).find(([re]) => new RegExp(re).test(path));
    if (!handler) throw new Error(`unexpected path ${path}`);
    return handler[1];
  };
  return p;
};

test('shinigami: search memetakan hasil API', async () => {
  const p = stubShinigamiApi(new Shinigami(), {
    '^/v1/manga/list$': {
      retcode: 0,
      data: [{ manga_id: MANGA_ID, title: 'Solo Max-Level Newbie', cover_portrait_url: 'https://assets.shngm.id/c.jpg', status: 1 }],
    },
  });
  const { comics } = await p.search('solo');
  assert.strictEqual(comics.length, 1);
  assert.strictEqual(comics[0].id, MANGA_ID);
  assert.strictEqual(comics[0].title, 'Solo Max-Level Newbie');
  assert.strictEqual(comics[0].cover, 'https://assets.shngm.id/c.jpg');
  assert.strictEqual(comics[0].status, 'Ongoing');
  assert.strictEqual(comics[0].url, `https://11.shinigami.asia/manga/detail/${MANGA_ID}`);
});

test('shinigami: comic + chapters memetakan detail & list', async () => {
  const p = stubShinigamiApi(new Shinigami(), {
    '^/v1/manga/detail/': {
      retcode: 0,
      data: {
        manga_id: MANGA_ID, title: 'Solo Max-Level Newbie', cover_portrait_url: 'https://assets.shngm.id/c.jpg',
        description: 'Deskripsi.', alternative_title: 'Alternatif', status: 1, release_year: 2024,
        taxonomy: {
          Genre: [{ name: 'Action' }, { name: 'Fantasy' }],
          Author: [{ name: 'Penulis' }], Artist: [{ name: 'Artis' }], Format: [{ name: 'Manhwa' }],
        },
      },
    },
    '^/v1/chapter/[^/]+/list$': {
      retcode: 0,
      data: [{ chapter_id: CHAPTER_ID, chapter_number: 283, chapter_title: 'The End', release_date: '2024-01-01' }],
      meta: { total_page: 1 },
    },
  });
  const c = await p.comic(MANGA_ID);
  assert.strictEqual(c.title, 'Solo Max-Level Newbie');
  assert.strictEqual(c.altTitle, 'Alternatif');
  assert.deepStrictEqual(c.genres, ['Action', 'Fantasy']);
  assert.strictEqual(c.author, 'Penulis');
  assert.strictEqual(c.artist, 'Artis');
  assert.strictEqual(c.type, 'Manhwa');
  assert.strictEqual(c.status, 'Ongoing');
  assert.strictEqual(c.releaseYear, 2024);
  assert.strictEqual(c.chapters.length, 1);
  assert.strictEqual(c.chapters[0].title, 'Chapter 283 - The End');
  assert.strictEqual(c.chapters[0].number, 283);
  assert.strictEqual(c.chapters[0].url, `https://11.shinigami.asia/chapter/${CHAPTER_ID}`);
});

test('shinigami: pages menyusun URL dari base_url + path + data', async () => {
  const p = stubShinigamiApi(new Shinigami(), {
    '^/v1/chapter/detail/': {
      retcode: 0,
      data: {
        base_url: 'https://assets.shngm.id/',
        chapter: { path: 'manga/x/chapter_1/', data: ['1.jpg', '2.webp'] },
        chapter_title: 'The End', chapter_number: 283,
        prev_chapter_id: 'prev', next_chapter_id: 'next',
      },
    },
  });
  const r = await p.pages(`https://11.shinigami.asia/chapter/${CHAPTER_ID}`);
  assert.deepStrictEqual(r.pages, [
    'https://assets.shngm.id/manga/x/chapter_1/1.jpg',
    'https://assets.shngm.id/manga/x/chapter_1/2.webp',
  ]);
  assert.strictEqual(r.title, 'Chapter 283 - The End');
  assert.strictEqual(r.prevChapter, 'prev');
  assert.strictEqual(r.nextChapter, 'next');
});

test('shinigami: chapterId tanpa UUID ditolak', async () => {
  await assert.rejects(
    () => new Shinigami().pages('https://11.shinigami.asia/chapter/bukan-uuid'),
    (e) => e.code === 'BAD_REQUEST' && e.status === 400,
  );
});
