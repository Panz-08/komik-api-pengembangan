'use strict';
const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`\n  Komik Scraper API aktif`);
  console.log(`  Reader : http://localhost:${PORT}/`);
  console.log(`  API    : http://localhost:${PORT}/api/sites\n`);
});
