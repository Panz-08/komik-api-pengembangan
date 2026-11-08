'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeEntities,
  stripHtml,
  htmlToParagraphs,
  wordCount,
  truncateText,
  parsePage,
  parseLimit,
  parseOrder,
  cleanSearch,
  assertSlug,
} = require('../src/novel/util');

test('decodeEntities mendukung entity umum dan numerik', () => {
  assert.equal(decodeEntities('A &amp; B &#8217;90 &#x2014; C'), 'A & B ’90 - C');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('stripHtml membersihkan tag dan spasi', () => {
  assert.equal(
    stripHtml('<p>Hello <strong>world</strong>.</p><p>Baris &amp; kedua</p>'),
    'Hello world . Baris & kedua',
  );
});

test('htmlToParagraphs memecah paragraf dan membuang script', () => {
  const paragraphs = htmlToParagraphs(
    '<p>Halo <strong>dunia</strong>.</p><script>alert(1)</script>' +
      '<p>Baris &amp; kedua<br>lanjut</p><p>   </p>',
  );

  assert.deepEqual(paragraphs, ['Halo dunia.', 'Baris & kedua lanjut']);
  assert.equal(wordCount(paragraphs), 5);
});

test('truncateText memotong dengan elipsis', () => {
  assert.equal(truncateText('abcdefghij', 5), 'abcd…');
  assert.equal(truncateText('abc', 5), 'abc');
});

test('parsePage dan parseLimit memvalidasi batas', () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage('3'), 3);
  assert.throws(() => parsePage('0'), /page/);
  assert.equal(parseLimit(undefined, 20, 100), 20);
  assert.equal(parseLimit('100', 20, 100), 100);
  assert.throws(() => parseLimit('101', 20, 100), /limit/);
});

test('parseOrder hanya menerima asc/desc', () => {
  assert.equal(parseOrder(undefined), 'desc');
  assert.equal(parseOrder('ASC'), 'asc');
  assert.throws(() => parseOrder('random'), /order/);
});

test('cleanSearch menolak input aneh', () => {
  assert.equal(cleanSearch('  academy   dungeon '), 'academy dungeon');
  assert.equal(cleanSearch(''), '');
  assert.throws(() => cleanSearch('<script>'), /karakter/);
});

test('assertSlug menerima slug WordPress', () => {
  assert.equal(assertSlug('the-victim-of-the-academy'), 'the-victim-of-the-academy');
  assert.throws(() => assertSlug('../etc/passwd'), /Slug/);
});
