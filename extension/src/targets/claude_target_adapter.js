/**
 * Liner Context Portability — Adaptador de Destino Optimizado para Anthropic Claude
 * Genera un paquete semántico preparado para Claude Code, Claude Web y Claude Projects.
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
    const adapter = factory(manifestBuilder, markdownSerializer, diagnosticsCenter, root.Lossy.TransferBundle).ClaudeTargetAdapter;
    root.Liner.ClaudeTargetAdapter = adapter;
    root.Lossy.ClaudeTargetAdapter = adapter;
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

  class ClaudeTargetAdapter {
    constructor() {
      this.targetId = 'claude';
      this.name = 'Anthropic Claude (Claude Code / Projects / Web)';
    }

    generatePackage(conversations, options = {}) {
      const convList = Array.isArray(conversations) ? conversations : [conversations];
      const projectTitle = options.projectTitle || 'Migración de Proyecto IA';
      const summaryGoal = options.summaryGoal || 'Continuación de contexto de ingeniería entre modelos.';

      const manifest = buildPortabilityManifest(convList, this.targetId, options);
      const contextMap = buildContextMap(convList, { projectTitle });
      const startHere = buildBootstrapGuide(convList, this.targetId, options);

      const files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'START_HERE.md': startHere,
        'CONTEXT_MAP.md': contextMap
      };

      // 1. PROJECT_CONTEXT.md
      const contextLines = [
        `# Contexto de Proyecto: ${projectTitle}`,
        '',
        `> **Propósito**: ${summaryGoal}`,
        `> **Total de Conversaciones Migradas**: ${convList.length}`,
        `> **Fecha de Exportación**: ${new Date().toISOString()}`,
        '',
        '## Índice de Conversaciones Incluidas',
        ''
      ];

      convList.forEach((c, idx) => {
        const safeId = sanitizeFilename(c.canonicalId || `conversacion_${idx + 1}`);
        const filename = `CONVERSATIONS/conversacion_${idx + 1}.json`;
        const mdFilename = `CONVERSATIONS/conversacion_${idx + 1}.md`;
        const modelStr = c.model ? c.model : (c.metadata?.model || 'no verificado');
        const platformStr = c.source?.platform || c.metadata?.platform || 'chatgpt';
        const titleStr = c.title || c.metadata?.title || 'Sin Título';

        contextLines.push(`- **${titleStr}** (${platformStr} - ${modelStr}): [\`JSON\`](${filename}) | [\`Markdown\`](${mdFilename})`);

        files[filename] = JSON.stringify(c, null, 2);
        files[mdFilename] = serializeToMarkdown(c);
      });

      files['PROJECT_CONTEXT.md'] = contextLines.join('\n');

      // 2. IMPORT_PROMPT.md
      const allConversationsText = convList.map((c, idx) => {
        const titleStr = c.title || c.metadata?.title || 'Sin Título';
        const platformStr = c.source?.platform || c.metadata?.platform || 'chatgpt';
        const modelStr = c.model ? c.model : (c.metadata?.model || 'no verificado');
        const messages = c.messages || [];

        return [
          `### [Conversación ${idx + 1}] ${titleStr} (${platformStr} / ${modelStr})`,
          messages.map(m => `**${m.author || (m.role === 'user' ? 'Usuario' : 'Asistente')} (${m.role}):**\n${m.content?.text || ''}`).join('\n\n')
        ].join('\n\n');
      }).join('\n\n---\n\n');

      const importPrompt = [
        '# PAQUETE DE MIGRACIÓN DE CONTEXTO SEMÁNTICO',
        '',
        `Hola Claude. A continuación te proporciono el historial y decisiones clave del proyecto "${projectTitle}".`,
        'Este contexto fue exportado de forma íntegra desde mi plataforma previa mediante el estándar local-first AICP.',
        '',
        '## Objetivo de la Sesión',
        summaryGoal,
        '',
        '## Historial Consolidado de Conversaciones',
        '',
        allConversationsText,
        '',
        '---',
        'Por favor asimila este historial y confírmame que estás listo para continuar con el trabajo a partir de estos puntos acordados.'
      ].join('\n');

      files['IMPORT_PROMPT.md'] = importPrompt;

      const receipt = buildTransferReceipt(manifest, files);
      files['portability/receipt.json'] = JSON.stringify(receipt, null, 2);

      return transferBundle.finalizePackage({
        projectTitle,
        target: this.targetId,
        packageId: manifest.packageId,
        manifest,
        receipt,
        importPrompt,
        files
      }, convList, options);
    }
  }

  return {
    ClaudeTargetAdapter
  };
});
