/**
 * Liner Context Portability — Adaptador de Destino Genérico (Liner Package v1)
 * Genera el paquete estándar independiente de plataforma con manifiesto,
 * mapa de contexto, guía de inicio, recibo con hashes y representaciones duales (JSON + MD).
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const manifestBuilder = require('../core/portability/manifest_builder.js');
    const markdownSerializer = require('../core/markdown_serializer.js');
    const diagnosticsCenter = require('../core/diagnostics/diagnostics_center.js');
    module.exports = factory(manifestBuilder, markdownSerializer, diagnosticsCenter, require('../core/portability/transfer_bundle.js'));
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const manifestBuilder = (root.Lossy && root.Lossy.ManifestBuilder) || (root.Liner && root.Liner.ManifestBuilder);
    const markdownSerializer = (root.Lossy && root.Lossy.MarkdownSerializer) || (root.Liner && root.Liner.MarkdownSerializer);
    const diagnosticsCenter = (root.Lossy && root.Lossy.Diagnostics) || (root.Liner && root.Liner.Diagnostics);
    const adapter = factory(manifestBuilder, markdownSerializer, diagnosticsCenter, root.Lossy.TransferBundle).GenericTargetAdapter;
    root.Liner.GenericTargetAdapter = adapter;
    root.Lossy.GenericTargetAdapter = adapter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (manifestBuilder, markdownSerializer, diagnosticsCenter, transferBundle) {
  'use strict';

  const {
    buildPortabilityManifest,
    buildContextMap,
    buildBootstrapGuide,
    buildTransferReceipt
  } = manifestBuilder;
  const { serializeToMarkdown } = markdownSerializer;
  const { sanitizeFilename } = diagnosticsCenter;

  class GenericTargetAdapter {
    constructor(options = {}) {
      this.targetId = 'generic';
      this.name = 'Liner Package v1 (Estándar Neutral)';
    }

    generatePackage(conversations, options = {}) {
      const convList = Array.isArray(conversations) ? conversations : [conversations];
      const projectTitle = options.projectTitle || 'Paquete de Contexto Portable';

      const manifest = buildPortabilityManifest(convList, this.targetId, options);
      const contextMap = buildContextMap(convList, { projectTitle });
      const startHere = buildBootstrapGuide(convList, this.targetId, options);

      const files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'START_HERE.md': startHere,
        'CONTEXT_MAP.md': contextMap
      };

      const errorsLog = [];

      // Almacenar conversaciones individuales
      convList.forEach((c, idx) => {
        const safeId = sanitizeFilename(c.canonicalId || `conv_${idx + 1}`);
        const jsonPath = `conversations/${safeId}.json`;
        const mdPath = `conversations/${safeId}.md`;

        files[jsonPath] = JSON.stringify(c, null, 2);
        files[mdPath] = serializeToMarkdown(c);

        if (c.integrity?.warnings && c.integrity.warnings.length > 0) {
          errorsLog.push({
            canonicalId: c.canonicalId,
            warnings: c.integrity.warnings
          });
        }
      });

      files['diagnostics/errors.json'] = JSON.stringify({
        packageId: manifest.packageId,
        timestamp: manifest.createdAt,
        errors: errorsLog
      }, null, 2);

      // Capacidades observadas
      const allCapabilities = {};
      convList.forEach(c => {
        if (c.capabilities) {
          Object.assign(allCapabilities, c.capabilities);
        }
      });
      files['portability/capabilities.json'] = JSON.stringify(allCapabilities, null, 2);

      // Recibo final con hashes criptográficos de cada archivo
      const receipt = buildTransferReceipt(manifest, files);
      files['portability/receipt.json'] = JSON.stringify(receipt, null, 2);

      return transferBundle.finalizePackage({
        target: this.targetId,
        packageId: manifest.packageId,
        manifest,
        receipt,
        files
      }, convList, options);
    }
  }

  return {
    GenericTargetAdapter
  };
});
