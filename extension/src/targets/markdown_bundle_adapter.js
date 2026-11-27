/**
 * Liner Context Portability — Adaptador de Destino Paquete Markdown
 * Genera un conjunto limpio de archivos Markdown con Frontmatter y un índice maestro.
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
    const adapter = factory(manifestBuilder, markdownSerializer, diagnosticsCenter, root.Lossy.TransferBundle).MarkdownBundleAdapter;
    root.Liner.MarkdownBundleAdapter = adapter;
    root.Lossy.MarkdownBundleAdapter = adapter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (manifestBuilder, markdownSerializer, diagnosticsCenter, transferBundle) {
  'use strict';

  const {
    buildPortabilityManifest,
    buildContextMap,
    buildTransferReceipt
  } = manifestBuilder;
  const { serializeToMarkdown } = markdownSerializer;
  const { sanitizeFilename } = diagnosticsCenter;

  class MarkdownBundleAdapter {
    constructor() {
      this.targetId = 'markdown';
      this.name = 'Markdown Bundle (Archivos .md con Frontmatter)';
    }

    generatePackage(conversations, options = {}) {
      const convList = Array.isArray(conversations) ? conversations : [conversations];
      const projectTitle = options.projectTitle || 'Colección de Conversaciones Markdown';

      const manifest = buildPortabilityManifest(convList, this.targetId, options);
      const contextMap = buildContextMap(convList, { projectTitle });

      const files = {
        'INDEX.md': contextMap,
        'manifest.json': JSON.stringify(manifest, null, 2)
      };

      convList.forEach((c, idx) => {
        const safeId = sanitizeFilename(c.canonicalId || `conversacion_${idx + 1}`);
        const mdPath = `conversations/${safeId}.md`;
        files[mdPath] = serializeToMarkdown(c);
      });

      const receipt = buildTransferReceipt(manifest, files);
      files['receipt.json'] = JSON.stringify(receipt, null, 2);

      return transferBundle.finalizePackage({
        target: this.targetId,
        packageId: manifest.packageId,
        manifest,
        receipt,
        files
      }, convList, options);
    }

    async generatePackageAsync(conversations, options = {}) {
      const convList = Array.isArray(conversations) ? conversations : [conversations];
      const materialized = typeof transferBundle.materializeBlobs === 'function'
        ? await Promise.all(convList.map(c => transferBundle.materializeBlobs(c)))
        : convList;
      return this.generatePackage(materialized, options);
    }
  }

  return {
    MarkdownBundleAdapter
  };
});
