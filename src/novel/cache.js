'use strict';

/**
 * Cache kecil dengan TTL untuk fungsi serverless.
 * Isinya per-instance, jadi Vercel tetap memakai cache CDN di depannya.
 */
class TTLCache {
  constructor({ max = 500, ttl = 300_000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    // sentuh ulang supaya urutan Map mendekati LRU
    this.map.delete(key);
    this.map.set(key, entry);

    return {
      value: entry.value,
      ageMs: Date.now() - entry.createdAt,
    };
  }

  set(key, value, ttl = this.ttl) {
    if (ttl <= 0) return;

    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.max) {
      this.map.delete(this.map.keys().next().value);
    }

    const now = Date.now();
    this.map.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttl * 1000,
    });
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { TTLCache };
