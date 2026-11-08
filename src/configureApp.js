'use strict';
const cors = require('cors');
const apiRouter = require('./routes/api');
const novelsRouter = require('./routes/novels');
const registry = require('./plugins/registry');
const { SOURCE: NOVEL_SOURCE } = require('./novel/client');
const { AppError } = require('./lib/errors');
const { curlIsAvailable, flareSolverrAvailable } = require('./lib/http');
const {
  ALLOWED_ORIGINS,
  AUTH_REQUIRED,
  isOriginAllowed,
  isPublicPath,
  requireAllowedOrigin,
  requireApiKey,
} = require('./lib/auth');

// Rate limit sederhana per IP. Di Vercel batas ini berlaku per instance.
function rateLimit({ windowMs = 60000, max = Number(process.env.RATE_LIMIT || 120) } = {}) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) {
      return res.status(429).json({
        success: false,
        error: 'Terlalu banyak request, coba lagi sebentar',
        code: 'RATE_LIMIT',
      });
    }
    next();
  };
}

function docs() {
  return {
    success: true,
    name: 'Komik & Novel API',
    version: require('../package.json').version,
    creator: 'Panz-08',
    description:
      'API komik multi-sumber dan novel Sakuranovel, lengkap dengan teks chapter. ' +
      'Dibuat dengan Express 5, siap jalan di Vercel.',
    endpoints: [
      'GET /api/sources',
      'GET /api/sites',
      'GET /api/search?q=<judul>&site=<id>&page=1',
      'GET /api/comics/:slug?site=<id>',
      'GET /api/comics/:slug/chapters?site=<id>',
      'GET /api/chapters/:chapterId/pages?site=<id>',
      'GET /api/image?url=<url>&site=<id>',
      'GET /api/novels?page=1&limit=20&sort=popular',
      'GET /api/novels/search?q=<judul>',
      'GET /api/novels/latest',
      'GET /api/novels/:idOrSlug',
      'GET /api/novels/:idOrSlug/chapters',
      'GET /api/novels/chapters/:id?content=1',
      'GET /api/novels/genres',
      'GET /api/novels/stats',
      'GET /api/novels/source',
      'GET /health',
    ],
    notes: {
      comics: 'Sumber komik bisa berubah struktur HTML-nya. Plugin ada di src/plugins/.',
      novels:
        'Bagian novel memakai REST API WordPress publik Sakuranovel. ' +
        'Teks chapter diambil dari field content dan disajikan sebagai paragraf biasa.',
      docs: 'Dokumentasi lengkap ada di README.md.',
    },
    auth: AUTH_REQUIRED
      ? {
          required: true,
          header: 'x-api-key',
          alternative: 'Authorization: Bearer <key>',
          note: 'Endpoint data hanya bisa dipakai dengan API key pemilik deployment.',
        }
      : {
          required: false,
          note: 'API masih terbuka. Set API_KEYS di environment sebelum deploy publik.',
        },
  };
}

function configureApp(app) {
  app.disable('x-powered-by');

  // Di balik proxy Vercel agar req.ip dan req.protocol mengikuti request asli.
  if (process.env.VERCEL || process.env.TRUST_PROXY) app.set('trust proxy', 1);

  // Header keamanan dasar untuk semua response.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Tolak browser dari origin yang tidak diizinkan sebelum request di proses.
  app.use(requireAllowedOrigin);

  // Bila ALLOWED_ORIGINS diisi, CORS hanya membuka origin tersebut.
  const corsOptions = ALLOWED_ORIGINS.length
    ? {
        origin(origin, callback) {
          if (!origin || isOriginAllowed(origin)) return callback(null, true);
          return callback(null, false);
        },
        methods: ['GET', 'HEAD', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
        maxAge: 86400,
      }
    : {};
  app.use(cors(corsOptions));

  app.get('/', (req, res) => res.json(docs()));

  app.get('/health', async (req, res) => {
    const [curl, flareSolverr] = await Promise.all([
      curlIsAvailable(),
      flareSolverrAvailable(),
    ]);

    res.json({
      success: true,
      name: 'Komik & Novel API',
      version: require('../package.json').version,
      creator: 'Panz-08',
      sites: registry.sites(),
      novel: NOVEL_SOURCE,
      capabilities: { curl, flareSolverr },
      authRequired: AUTH_REQUIRED,
    });
  });

  // /api/image dipakai <img> untuk banyak gambar sekaligus, jadi tidak ikut rate limit.
  const limiter = rateLimit();
  app.use('/api', (req, res, next) => (req.path === '/image' ? next() : limiter(req, res, next)));

  // Semua endpoint selain dokumentasi/health wajib API key. /api/image punya
  // pemeriksaan sendiri karena harus menerima URL bertanda tangan dari <img>.
  app.use((req, res, next) => {
    if (isPublicPath(req.path) || req.path === '/api/image') return next();
    return requireApiKey(req, res, next);
  });

  app.get('/api/sources', (req, res) =>
    res.json({
      success: true,
      data: {
        comics: registry.sites(),
        novels: [NOVEL_SOURCE],
      },
    }),
  );

  app.use('/api', apiRouter);
  app.use('/api/novels', novelsRouter);

  app.use('/api', (req, res) =>
    res.status(404).json({
      success: false,
      error: 'Endpoint tidak ditemukan',
      code: 'NOT_FOUND',
    }),
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
