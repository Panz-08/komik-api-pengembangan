'use strict';
/**
 * Entry point.
 * - Lokal  : `npm start` -> server mendengarkan di PORT.
 * - Vercel : app Express diekspor (module.exports) dan dijalankan sebagai Vercel Function,
 *            jadi tidak boleh memanggil listen().
 */
const { createApp } = require('./src/createApp');

const app = createApp();

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  Komik Scraper API aktif`);
    console.log(`  Reader : http://localhost:${PORT}/`);
    console.log(`  API    : http://localhost:${PORT}/api/sites\n`);
  });
}

module.exports = app;
