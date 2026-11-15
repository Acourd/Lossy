/**
 * Liner Context Portability — Especificación de Esquema Canónico v1.3
 * Define tipos, constantes y reglas de validación para la representación intermedia de contexto.
 * 100% Local-first, sin dependencias externas.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Liner = root.Liner || {};
    root.Liner.CanonicalSchema = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LINER_CANONICAL_VERSION = '1.3.0';
  const SCHEMA_URI = 'https://aicp.dev/v1.3/canonical-context.schema.json';

  const INTEGRITY_STATUS = Object.freeze({
    CAPTURED: 'captured',
    PARTIAL: 'partial',
    DEGRADED: 'degraded',
    FAILED: 'failed'
  });

  const ACQUISITION_METHODS = Object.freeze({
    STRUCTURED_SESSION: 'structured-session',
    DOM_HARVEST: 'dom-harvest',
    DOM_SNIPPET: 'dom-snippet',
    OFFICIAL_EXPORT: 'official-export'
  });

  const MESSAGE_ROLES = Object.freeze([
    'user',
    'assistant',
    'system',
    'tool',
    'developer',
    'agent',
    'reasoning',
    'structural',
    'unknown'
  ]);

  const NODE_TAXONOMY = Object.freeze({
    USER: 'user',
    ASSISTANT: 'assistant',
    TOOL: 'tool',
    SYSTEM: 'system',
    DEVELOPER: 'developer',
    AGENT: 'agent',
    REASONING: 'reasoning',
    STRUCTURAL: 'structural',
    UNKNOWN: 'unknown'
  });

  const CAPABILITY_STATES = Object.freeze({
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable',
    DEGRADED: 'degraded',
    UNKNOWN: 'unknown'
  });

  const ASSET_SOURCE_TYPES = Object.freeze({
    ATTACHMENT: 'attachment',
    IMAGE_ASSET_POINTER: 'image_asset_pointer',
    MARKDOWN_IMAGE: 'markdown-image',
    DOM_IMAGE: 'dom-image',
    DATA_URI: 'data-uri',
    GENERATED_IMAGE: 'generated-image',
    UPLOADED_FILE: 'uploaded-file',
    UNKNOWN: 'unknown'
  });

  const ASSET_AVAILABILITY = Object.freeze({
    EMBEDDED: 'embedded',
    DOWNLOADED: 'downloaded',
    REFERENCED: 'referenced',
    UNAVAILABLE: 'unavailable'
  });

  return {
    LINER_CANONICAL_VERSION,
    SCHEMA_URI,
    INTEGRITY_STATUS,
    ACQUISITION_METHODS,
    MESSAGE_ROLES,
    NODE_TAXONOMY,
    CAPABILITY_STATES,
    ASSET_SOURCE_TYPES,
    ASSET_AVAILABILITY
  };
});
