'use strict';

const trimSlash = (value) => String(value || '').replace(/\/+$/, '');

const BASE_URL = trimSlash(process.env.SAKURANOVEL_BASE_URL || 'https://sakuranovel.id');
const API_PREFIX = '/wp-json/wp/v2';

const numberFromEnv = (name, fallback, min = 1) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
};

module.exports = {
  BASE_URL,
  API_PREFIX,
  SOURCE_ID: 'sakuranovel',
  SOURCE_NAME: 'Sakuranovel',
  CREATOR: 'Panz-08',
  CACHE_TTL_SECONDS: numberFromEnv('SAKURANOVEL_CACHE_TTL_SECONDS', 300, 0),
  CACHE_MAX_ENTRIES: numberFromEnv('SAKURANOVEL_CACHE_MAX_ENTRIES', 500, 1),
  UPSTREAM_TIMEOUT_MS: numberFromEnv('SAKURANOVEL_TIMEOUT_MS', 12000, 1000),
  USER_AGENT:
    process.env.SAKURANOVEL_USER_AGENT ||
    'KomikNovelAPI/2.1 (metadata-only; creator: Panz-08)',
  EXCERPT_MAX_LENGTH: 320,
};
