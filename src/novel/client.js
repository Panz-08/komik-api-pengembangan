'use strict';

const {
  BASE_URL,
  API_PREFIX,
  SOURCE_ID,
  SOURCE_NAME,
  CACHE_TTL_SECONDS,
  CACHE_MAX_ENTRIES,
  UPSTREAM_TIMEOUT_MS,
  USER_AGENT,
  EXCERPT_MAX_LENGTH,
} = require('./config');
const { AppError } = require('../lib/errors');
const { TTLCache } = require('./cache');
const {
  stripHtml,
  truncateText,
  htmlToParagraphs,
  wordCount,
  notFound,
  badRequest,
} = require('./util');

const cache = new TTLCache({ max: CACHE_MAX_ENTRIES, ttl: CACHE_TTL_SECONDS });
const inflight = new Map();

const SOURCE = {
  id: SOURCE_ID,
  name: SOURCE_NAME,
  type: 'novel',
  baseUrl: BASE_URL,
  api: `${BASE_URL}${API_PREFIX}`,
};

const SERIES_FIELDS = 'id,name,slug,link,count,description';
const CHAPTER_LIST_FIELDS = 'id,slug,link,title,date,modified,seri,featured_media';
const CHAPTER_DETAIL_FIELDS =
  'id,slug,link,title,date,modified,excerpt,content,seri,featured_media';

const SORTS = {
  popular: { orderby: 'count', order: 'desc' },
  newest: { orderby: 'id', order: 'desc' },
  title: { orderby: 'name', order: 'asc' },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildUrl(endpoint, params = {}) {
  const safeEndpoint = String(endpoint || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = new URL(`${API_PREFIX}/${safeEndpoint}`, `${BASE_URL}/`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

function isCloudflareChallenge(body, headers) {
  const mitigated = String(headers.get('cf-mitigated') || '').toLowerCase();
  if (mitigated === 'challenge') return true;

  const text = String(body || '').slice(0, 30_000);
  return /<title>\s*just a moment|attention required|cf-chl|challenge-platform|enable javascript and cookies to continue|performing security verification/i.test(
    text,
  );
}

function parseTotal(headers, key) {
  const value = Number(headers.get(key));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function request(endpoint, params = {}, options = {}) {
  const {
    ttl = CACHE_TTL_SECONDS,
    retries = 1,
    cacheKey = null,
  } = options;

  const url = buildUrl(endpoint, params);
  const key = cacheKey || url.href;
  const cached = cache.get(key);
  if (cached) {
    return {
      ...cached.value,
      cached: true,
      ageMs: cached.ageMs,
    };
  }

  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    return { ...result, cached: true, shared: true };
  }

  const task = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
            'User-Agent': USER_AGENT,
          },
        });
      } catch (error) {
        lastError = new AppError(
          'Tidak bisa menghubungi Sakuranovel. Coba lagi beberapa saat.',
          503,
          'UPSTREAM_UNAVAILABLE',
          true,
        );
        if (attempt < retries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      const body = await response.text();

      if (isCloudflareChallenge(body, response.headers)) {
        throw new AppError(
          'Sakuranovel menolak request dari IP ini lewat Cloudflare. API ini tidak melakukan bypass; gunakan hosting/region lain atau minta akses resmi ke pengelola.',
          503,
          'UPSTREAM_BLOCKED',
          true,
        );
      }

      if (response.status === 404) {
        throw notFound('Data tidak ditemukan di Sakuranovel');
      }

      if (response.status === 400) {
        const parsed = safeJson(body);
        if (
          parsed?.code === 'rest_post_invalid_page_number' ||
          /invalid page number/i.test(String(parsed?.message || ''))
        ) {
          throw notFound('Halaman tidak ditemukan');
        }
        throw badRequest('Parameter request tidak diterima oleh Sakuranovel');
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          `Sakuranovel menolak request (HTTP ${response.status}). API ini tidak melakukan bypass.`,
          503,
          'UPSTREAM_BLOCKED',
          true,
        );
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new AppError(
          `Sakuranovel sedang tidak bisa diakses (HTTP ${response.status}).`,
          503,
          'UPSTREAM_UNAVAILABLE',
          true,
        );
        if (attempt < retries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter)
            ? Math.min(retryAfter * 1000, 3000)
            : 350 * (attempt + 1);
          await sleep(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new AppError(
          `Sakuranovel mengembalikan HTTP ${response.status}.`,
          502,
          'UPSTREAM_ERROR',
          response.status >= 500,
        );
      }

      const data = safeJson(body);
      if (data === null) {
        throw new AppError(
          'Respons Sakuranovel tidak valid (bukan JSON).',
          502,
          'UPSTREAM_INVALID',
          true,
        );
      }

      const total = parseTotal(response.headers, 'x-wp-total');
      const totalPages = parseTotal(response.headers, 'x-wp-totalpages');
      const requestedPage = Number(params.page);
      if (
        Number.isInteger(requestedPage) &&
        requestedPage > 1 &&
        totalPages !== null &&
        requestedPage > Math.max(totalPages, 1)
      ) {
        throw notFound('Halaman tidak ditemukan');
      }

      const result = {
        data,
        total,
        totalPages,
        cached: false,
      };

      cache.set(key, result, ttl);
      return result;
    }

    throw lastError || new AppError('Gagal mengambil data dari Sakuranovel', 502, 'UPSTREAM_ERROR', true);
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

function chapterNumber(title) {
  const text = stripHtml(title);
  const match =
    text.match(/(?:chapter|chap|ch|bab|episode|eps)\.?\s*([0-9]+(?:[.,][0-9]+)?)/i) ||
    text.match(/\b([0-9]+(?:[.,][0-9]+)?)\b/);
  if (!match) return null;

  const number = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function normalizeSeriesRef(term) {
  if (!term) return null;
  return {
    id: Number(term.id) || null,
    slug: term.slug || '',
    title: stripHtml(term.name || ''),
    url: term.link || term.url || null,
  };
}

function normalizeNovel(term) {
  const slug = term?.slug || '';
  return {
    id: Number(term?.id) || null,
    slug,
    title: stripHtml(term?.name || ''),
    description: stripHtml(term?.description || ''),
    url: term?.link || null,
    chapterCount: Number(term?.count) || 0,
    source: SOURCE_NAME,
    endpoints: {
      detail: `/api/novels/${encodeURIComponent(slug || term?.id)}`,
      chapters: `/api/novels/${encodeURIComponent(slug || term?.id)}/chapters`,
    },
  };
}

function normalizeChapter(post, series = null, { includeContent = false } = {}) {
  const title = stripHtml(post?.title?.rendered || post?.title || '');
  const chapter = {
    id: Number(post?.id) || null,
    slug: post?.slug || '',
    title,
    chapterNumber: chapterNumber(title),
    url: post?.link || null,
    publishedAt: post?.date || null,
    updatedAt: post?.modified || null,
    series: normalizeSeriesRef(series),
    contentAvailable: false,
    readAt: post?.link || null,
  };

  if (post?.excerpt?.rendered) {
    chapter.excerpt = truncateText(stripHtml(post.excerpt.rendered), EXCERPT_MAX_LENGTH);
  }

  if (includeContent) {
    const paragraphs = htmlToParagraphs(post?.content?.rendered || '');
    if (paragraphs.length) {
      const words = wordCount(paragraphs);
      chapter.contentAvailable = true;
      chapter.paragraphs = paragraphs;
      chapter.content = paragraphs.join('\n\n');
      chapter.wordCount = words;
      chapter.readingMinutes = Math.max(1, Math.round(words / 200));
    }
  }

  return chapter;
}

function normalizeGenre(tag) {
  return {
    id: Number(tag?.id) || null,
    slug: tag?.slug || '',
    name: stripHtml(tag?.name || ''),
    count: Number(tag?.count) || 0,
    url: tag?.link || null,
  };
}

function pagination(page, limit, total, totalPages) {
  const resolvedTotal = Number.isFinite(total) ? total : null;
  const resolvedTotalPages = Number.isFinite(totalPages) ? totalPages : null;
  return {
    page,
    limit,
    total: resolvedTotal,
    totalPages: resolvedTotalPages,
    hasPrev: page > 1,
    hasNext: resolvedTotalPages !== null ? page < resolvedTotalPages : null,
  };
}

async function listNovels({ page = 1, limit = 20, search = '', sort = 'popular' } = {}) {
  const selected = SORTS[sort] || SORTS.popular;
  const params = {
    page,
    per_page: limit,
    orderby: selected.orderby,
    order: selected.order,
    _fields: SERIES_FIELDS,
  };
  if (search) params.search = search;

  const result = await request('seri', params, { ttl: 300 });
  const items = Array.isArray(result.data) ? result.data.map(normalizeNovel) : [];

  return {
    items,
    pagination: pagination(page, limit, result.total, result.totalPages),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function findNovel(idOrSlug) {
  const raw = String(idOrSlug || '').trim();
  if (!raw) throw badRequest('ID atau slug novel wajib diisi');

  if (/^\d+$/.test(raw)) {
    try {
      const result = await request(
        `seri/${raw}`,
        { _fields: SERIES_FIELDS },
        { ttl: 300 },
      );
      return {
        item: normalizeNovel(result.data),
        cached: result.cached,
        ageMs: result.ageMs || 0,
      };
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(raw)) {
    throw badRequest('Slug novel tidak valid');
  }

  const result = await request(
    'seri',
    { slug: raw, per_page: 1, _fields: SERIES_FIELDS },
    { ttl: 300 },
  );
  const term = Array.isArray(result.data) ? result.data[0] : null;
  if (!term) throw notFound('Novel tidak ditemukan');

  return {
    item: normalizeNovel(term),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function getNovelDetail(idOrSlug) {
  const { item, cached, ageMs } = await findNovel(idOrSlug);

  const common = {
    seri: item.id,
    per_page: 1,
    orderby: 'date',
    _fields: CHAPTER_LIST_FIELDS,
  };

  const [latestResult, firstResult] = await Promise.allSettled([
    request('posts', { ...common, order: 'desc' }, { ttl: 120 }),
    request('posts', { ...common, order: 'asc' }, { ttl: 120 }),
  ]);

  const latestPost =
    latestResult.status === 'fulfilled' && Array.isArray(latestResult.value.data)
      ? latestResult.value.data[0]
      : null;
  const firstPost =
    firstResult.status === 'fulfilled' && Array.isArray(firstResult.value.data)
      ? firstResult.value.data[0]
      : null;

  return {
    ...item,
    latestChapter: latestPost ? normalizeChapter(latestPost, { ...item, name: item.title }) : null,
    firstChapter: firstPost ? normalizeChapter(firstPost, { ...item, name: item.title }) : null,
    cached,
    ageMs,
  };
}

async function listChapters(idOrSlug, { page = 1, limit = 50, order = 'desc' } = {}) {
  const { item } = await findNovel(idOrSlug);
  const result = await request(
    'posts',
    {
      seri: item.id,
      page,
      per_page: limit,
      orderby: 'date',
      order,
      _fields: CHAPTER_LIST_FIELDS,
    },
    { ttl: 120 },
  );

  const seriesRef = { ...item, name: item.title };
  const items = Array.isArray(result.data)
    ? result.data.map((post) => normalizeChapter(post, seriesRef))
    : [];

  return {
    novel: item,
    items,
    pagination: pagination(page, limit, result.total, result.totalPages),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function getChapter(id, { includeContent = true } = {}) {
  const numericId = Number.parseInt(String(id), 10);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw badRequest('ID chapter tidak valid');
  }

  const result = await request(
    `posts/${numericId}`,
    { _fields: CHAPTER_DETAIL_FIELDS },
    { ttl: 600 },
  );
  if (!result.data || Array.isArray(result.data)) {
    throw notFound('Chapter tidak ditemukan');
  }

  let series = null;
  const seriesId = Array.isArray(result.data.seri) ? result.data.seri[0] : null;
  if (seriesId) {
    try {
      const term = await request(
        `seri/${seriesId}`,
        { _fields: SERIES_FIELDS },
        { ttl: 300 },
      );
      series = term.data;
    } catch {
      // detail chapter tetap bisa dikembalikan walau metadata seri gagal diambil
    }
  }

  return {
    item: normalizeChapter(result.data, series, { includeContent }),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function getLatestChapters({ page = 1, limit = 20 } = {}) {
  const result = await request(
    'posts',
    {
      page,
      per_page: limit,
      orderby: 'date',
      order: 'desc',
      _fields: CHAPTER_LIST_FIELDS,
    },
    { ttl: 60 },
  );

  const posts = Array.isArray(result.data) ? result.data : [];
  const seriesIds = [
    ...new Set(
      posts
        .flatMap((post) => (Array.isArray(post.seri) ? post.seri : []))
        .filter((id) => Number.isInteger(Number(id))),
    ),
  ].slice(0, 100);

  let seriesMap = new Map();
  if (seriesIds.length) {
    try {
      const terms = await request(
        'seri',
        {
          include: seriesIds.join(','),
          per_page: seriesIds.length,
          _fields: SERIES_FIELDS,
        },
        { ttl: 300 },
      );
      if (Array.isArray(terms.data)) {
        seriesMap = new Map(terms.data.map((term) => [Number(term.id), term]));
      }
    } catch {
      // daftar chapter tetap berguna tanpa nama seri
    }
  }

  const items = posts.map((post) => {
    const seriesId = Array.isArray(post.seri) ? Number(post.seri[0]) : null;
    return normalizeChapter(post, seriesMap.get(seriesId) || null);
  });

  return {
    items,
    pagination: pagination(page, limit, result.total, result.totalPages),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function searchNovels(query, { page = 1, limit = 20 } = {}) {
  const result = await request(
    'seri',
    {
      search: query,
      page,
      per_page: limit,
      orderby: 'count',
      order: 'desc',
      _fields: SERIES_FIELDS,
    },
    { ttl: 120 },
  );

  return {
    items: Array.isArray(result.data) ? result.data.map(normalizeNovel) : [],
    pagination: pagination(page, limit, result.total, result.totalPages),
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function listGenres({ limit = 50 } = {}) {
  const result = await request(
    'tags',
    {
      per_page: limit,
      orderby: 'count',
      order: 'desc',
      _fields: 'id,name,slug,count,link',
    },
    { ttl: 3600 },
  );

  return {
    items: Array.isArray(result.data) ? result.data.map(normalizeGenre) : [],
    total: result.total,
    cached: result.cached,
    ageMs: result.ageMs || 0,
  };
}

async function getStats() {
  const [series, posts] = await Promise.all([
    request('seri', { per_page: 1, _fields: 'id' }, { ttl: 300 }),
    request('posts', { per_page: 1, _fields: 'id' }, { ttl: 300 }),
  ]);

  return {
    novels: series.total,
    chapters: posts.total,
    source: SOURCE_NAME,
    sourceUrl: BASE_URL,
    cached: Boolean(series.cached && posts.cached),
    ageMs: Math.min(series.ageMs || 0, posts.ageMs || 0),
  };
}

module.exports = {
  SOURCE,
  listNovels,
  findNovel,
  getNovelDetail,
  listChapters,
  getChapter,
  getLatestChapters,
  searchNovels,
  listGenres,
  getStats,
  normalizeNovel,
  normalizeChapter,
  normalizeGenre,
  chapterNumber,
  pagination,
  buildUrl,
  isCloudflareChallenge,
};
