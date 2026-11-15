/**
 * Liner Context Portability — Centro de Diagnósticos y Sanitización (Local-First)
 * Recopila advertencias, errores y estados de capacidades sin persistir ni exportar secretos ni PII.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const diagModule = factory();
    root.Liner.Diagnostics = diagModule;
    root.Lossy.Diagnostics = diagModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SENSITIVE_KEY_PATTERNS = [
    /token/i,
    /auth/i,
    /cookie/i,
    /secret/i,
    /password/i,
    /bearer/i,
    /session/i,
    /credential/i,
    /api[-_]?key/i
  ];

  const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ]);

  /**
   * Sanitiza recursivamente objetos de diagnósticos eliminando tokens, cabeceras y secretos.
   */
  function sanitizeDiagnostics(data, maxDepth = 6) {
    if (data === null || data === undefined) return data;
    if (maxDepth <= 0) return '[DEPTH_LIMIT_REACHED]';

    if (typeof data === 'string') {
      let cleaned = data
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/ey[A-Za-z0-9-_]{10,}\.ey[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]+/g, '[JWT_TOKEN_REDACTED]')
        .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL_REDACTED]');
      return cleaned;
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => sanitizeDiagnostics(item, maxDepth - 1));
    }

    const cleanObj = {};
    for (const [key, value] of Object.entries(data)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
      if (isSensitive) {
        cleanObj[key] = '[REDACTED_SENSITIVE_KEY]';
      } else {
        cleanObj[key] = sanitizeDiagnostics(value, maxDepth - 1);
      }
    }

    return cleanObj;
  }

  /**
   * Sanitiza nombres de archivo para empaquetado seguro contra Zip Slip y Path Traversal.
   */
  function sanitizeFilename(filename, fallback = 'conversation') {
    if (typeof filename !== 'string' || !filename.trim()) {
      return fallback;
    }

    let sanitized = filename
      .replace(/\.\./g, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[.\s_]+|[.\s_]+$/g, '');

    const upperBase = sanitized.toUpperCase().split('.')[0];
    if (WINDOWS_RESERVED_NAMES.has(upperBase)) {
      sanitized = `safe_${sanitized}`;
    }

    if (sanitized.length > 80) {
      sanitized = sanitized.substring(0, 80);
    }

    return sanitized.length > 0 ? sanitized : fallback;
  }

  /**
   * Gestor en memoria de eventos de diagnóstico locales.
   */
  class DiagnosticsManager {
    constructor() {
      this.logs = [];
      this.maxLogs = 100;
    }

    log(category, message, details = {}) {
      const entry = {
        id: `diag_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        category,
        message,
        details: sanitizeDiagnostics(details)
      };
      this.logs.unshift(entry);
      if (this.logs.length > this.maxLogs) {
        this.logs.pop();
      }
      return entry;
    }

    getLogs() {
      return this.logs.slice();
    }

    clear() {
      this.logs = [];
    }

    exportDiagnostics(extraInfo = {}) {
      return {
        exportedAt: new Date().toISOString(),
        product: 'Liner Context Portability',
        version: '1.3.0',
        environment: typeof window !== 'undefined' ? 'chrome-extension' : 'node-test',
        metadata: sanitizeDiagnostics(extraInfo),
        logs: this.logs.slice()
      };
    }
  }

  return {
    sanitizeDiagnostics,
    sanitizeFilename,
    DiagnosticsManager,
    defaultDiagnostics: new DiagnosticsManager()
  };
});
