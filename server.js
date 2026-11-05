'use strict';
/**
 * Entry point.
 * - Vercel mencari file entry yang meng-import 'express' secara langsung, jadi app dibuat di sini.
 * - Lokal  : `npm start` -> server mendengarkan di PORT.
 * - Vercel : app diekspor (module.exports) dan dijalankan sebagai Vercel Function (tanpa listen()).
 */
const express = require('express');
const { configureApp } = require('./src/configureApp');

const app = express();
configureApp(app);

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  Komik & Novel API aktif`);
    console.log(`  Info   : http://localhost:${PORT}/`);
    console.log(`  Komik  : http://localhost:${PORT}/api/sites`);
    console.log(`  Novel  : http://localhost:${PORT}/api/novels\n`);
  });
}

module.exports = app;
