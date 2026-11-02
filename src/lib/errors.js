'use strict';

class AppError extends Error {
  /**
   * @param {string} message pesan untuk user
   * @param {number} status  HTTP status untuk response API
   * @param {string} code    kode singkat (NOT_FOUND, CLOUDFLARE, dst)
   * @param {boolean} retryable apakah layak dicoba ulang
   */
  constructor(message, status = 500, code = 'ERROR', retryable = false) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

module.exports = { AppError };
