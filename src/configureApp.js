'use strict';
const cors = require('cors');
const apiRouter = require('./routes/api');
const registry = require('./plugins/registry');
const { AppError } = require('./lib/errors');
const { curlIsAvailable, flareSolverrAvailable } = require('./lib/http');

// rate limit sederhana per IP (tanpa dependency)
function rateLimit({ windowMs = 60000, max = Number(process.env.RATE_LIMIT || 120) } = {}) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ success: false, error: 'Terlalu banyak request, coba lagi sebentar', code: 'RATE_LIMIT' });
    next();
  };
}

function configureApp(app) {
  app.disable('x-powered-by');
  // di balik proxy (Vercel) agar req.ip = IP pengunjung asli, bukan IP proxy
  if (process.env.VERCEL || process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(cors());

  app.get('/', (req, res) =>
    res.json({
      success: true,
      name: 'Komik Scraper API',
      version: require('../package.json').version,
      endpoints: [
        'GET /api/sites',
        'GET /api/search?q=<judul>&site=<id>&page=1',
        'GET /api/comics/:slug?site=<id>',
        'GET /api/comics/:slug/chapters?site=<id>',
        'GET /api/chapters/:chapterId/pages?site=<id>',
        'GET /api/image?url=<url>&site=<id>',
        'GET /health',
      ],
    }),
  );

  app.get('/health', async (req, res) => {
    const [curl, flareSolverr] = await Promise.all([
      curlIsAvailable(),
      flareSolverrAvailable(),
    ]);
    res.json({
      success: true,
      name: 'Komik Scraper API',
      version: require('../package.json').version,
      sites: registry.sites(),
      capabilities: { curl, flareSolverr },
    });
  });

  // /api/image dipakai <img> untuk banyak gambar sekaligus, jadi tidak ikut rate limit
  const limiter = rateLimit();
  app.use('/api', (req, res, next) => (req.path === '/image' ? next() : limiter(req, res, next)));
  app.use('/api', apiRouter);
  app.use('/api', (req, res) =>
    res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' }),
  );

  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const known = err instanceof AppError;
    if (!known) console.error('[ERROR]', req.method, req.originalUrl, err.message);
    if (res.headersSent) return res.destroy();
    res.status(known ? err.status : 500).json({
      success: false,
      error: known ? err.message : 'Terjadi kesalahan internal server',
      code: known ? err.code : 'INTERNAL',
    });
  });

  return app;
}

module.exports = { configureApp };
