/**
 * Liner Context Portability — Detector y Registro de Capacidades de ChatGPT
 * Evalúa empíricamente qué primitivas están disponibles en el entorno actual.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const canonicalSchema = require('../../../core/canonical/canonical_schema.js');
    module.exports = factory(canonicalSchema);
  } else {
    root.Liner = root.Liner || {};
    const canonicalSchema = root.Liner.CanonicalSchema;
    root.Liner.ChatGPTCapabilityDetector = factory(canonicalSchema).ChatGPTCapabilityDetector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (canonicalSchema) {
  'use strict';

  const { CAPABILITY_STATES } = canonicalSchema || {
    CAPABILITY_STATES: {
      AVAILABLE: 'available',
      UNAVAILABLE: 'unavailable',
      DEGRADED: 'degraded',
      UNKNOWN: 'unknown'
    }
  };

  class ChatGPTCapabilityDetector {
    constructor(options = {}) {
      this.fetch = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
    }

    /**
     * Evalúa las capacidades observadas en la sesión activa y el DOM.
     */
    async detectCapabilities() {
      const report = {
        platform: 'chatgpt',
        evaluatedAt: new Date().toISOString(),
        capabilities: {
          structuredSession: CAPABILITY_STATES.UNKNOWN,
          conversationList: CAPABILITY_STATES.UNKNOWN,
          branches: CAPABILITY_STATES.UNKNOWN,
          attachments: CAPABILITY_STATES.UNKNOWN,
          modelSlug: CAPABILITY_STATES.UNKNOWN,
          realTimestamps: CAPABILITY_STATES.UNKNOWN,
          domFallback: CAPABILITY_STATES.AVAILABLE
        }
      };

      // 1. Evaluar si hay DOM activo de ChatGPT
      if (this.document) {
        report.capabilities.domFallback = CAPABILITY_STATES.AVAILABLE;

        // Verificar si hay selector de modelo visible
        const modelElem = this.document.querySelector('[data-testid="model-switcher-dropdown-button"]') ||
                          this.document.querySelector('button[aria-haspopup="menu"]');
        report.capabilities.modelSlug = modelElem ? CAPABILITY_STATES.AVAILABLE : CAPABILITY_STATES.DEGRADED;
      }

      // 2. Evaluar si la sesión web estructurada responde
      if (this.fetch) {
        try {
          const res = await this.fetch('/api/auth/session', {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });

          if (res.ok) {
            report.capabilities.structuredSession = CAPABILITY_STATES.AVAILABLE;
            report.capabilities.conversationList = CAPABILITY_STATES.AVAILABLE;
            report.capabilities.branches = CAPABILITY_STATES.AVAILABLE;
            report.capabilities.attachments = CAPABILITY_STATES.AVAILABLE;
            report.capabilities.realTimestamps = CAPABILITY_STATES.AVAILABLE;
          } else {
            report.capabilities.structuredSession = CAPABILITY_STATES.UNAVAILABLE;
            report.capabilities.conversationList = CAPABILITY_STATES.UNAVAILABLE;
          }
        } catch (_) {
          report.capabilities.structuredSession = CAPABILITY_STATES.UNAVAILABLE;
        }
      }

      return report;
    }
  }

  return {
    ChatGPTCapabilityDetector
  };
});
