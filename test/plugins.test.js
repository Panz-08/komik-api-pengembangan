'use strict';
// Untuk Tess parsing
const test = require('node:test');
const assert = require('node:assert');
const cheerio = require('cheerio');
const Komikindo = require('../src/plugins/komikindoCh');

const withHtml = (plugin, html, url) => {
  plugin.load = async () => ({ $: cheerio.load(html), url, html });
  return plugin;
};

test('komikindo: search', async () => {
  const p = withHtml(new Komikindo(), `
    <div class="animposx">
      <a href="https://komikindo.ch/komik/solo-leveling/" title="Solo Leveling">
        <img data-src="/c/solo.jpg" src="data:image/gif;base64,R0lG"></a>
    </div>
    <a href="https://komikindo.ch/komik/">Daftar Komik</a>`, 'https://komikindo.ch/?s=solo');
  const { comics } = await p.search('solo');
  assert.strictEqual(comics.length, 1);
  assert.strictEqual(comics[0].id, 'solo-leveling');
  assert.strictEqual(comics[0].title, 'Solo Leveling');
  assert.strictEqual(comics[0].cover, 'https://komikindo.ch/c/solo.jpg');
});

test('komikindo: comic + chapters', async () => {
  const p = withHtml(new Komikindo(), `
    <h1 class="entry-title">Komik Solo Leveling</h1>
    <div id="chapter_list"><ul>
      <li><span class="lchx"><a href="https://komikindo.ch/solo-leveling-chapter-2/">Chapter 2</a></span></li>
      <li><span class="lchx"><a href="https://komikindo.ch/solo-leveling-chapter-1/">Chapter 1</a></span></li>
    </ul></div>`, 'https://komikindo.ch/komik/solo-leveling/');
  const c = await p.comic('solo-leveling');
  assert.strictEqual(c.title, 'Solo Leveling');
  assert.strictEqual(c.chapters.length, 2);
  assert.strictEqual(c.chapters[0].number, 2);
});

test('komikindo: pages', async () => {
  const p = withHtml(new Komikindo(), `
    <h1 class="entry-title">Chapter 1</h1>
    <div id="readerarea"><img data-src="/img/1.jpg"><img src="/img/2.jpg"></div>`,
  'https://komikindo.ch/solo-leveling-chapter-1/');
  const r = await p.pages('https://komikindo.ch/solo-leveling-chapter-1/');
  assert.deepStrictEqual(r.pages, ['https://komikindo.ch/img/1.jpg', 'https://komikindo.ch/img/2.jpg']);
});
