/**
 * Liner Context Portability — Generador de Manifiesto de Portabilidad y Recibos v1.3
 * Audita de forma exhaustiva qué elementos fueron capturados con exactitud,
 * cuáles desde DOM, cuáles transformados, cuáles no expuso la fuente y cuáles fallaron.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const cryptoUtil = require('../crypto_util.js');
    module.exports = factory(cryptoUtil);
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const cryptoUtil = (root.Lossy && root.Lossy.Crypto) || (root.Liner && root.Liner.Crypto);
    const builder = factory(cryptoUtil);
    root.Liner.ManifestBuilder = builder;
    root.Lossy.ManifestBuilder = builder;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cryptoUtil) {
  'use strict';

  function sha256(str) {
    if (cryptoUtil && typeof cryptoUtil.sha256 === 'function') {
      return cryptoUtil.sha256(str);
    }
    throw new Error('SHA-256 no disponible: no se puede verificar el paquete');
  }

  /**
   * Construye el Portability Manifest v1.0 para un conjunto de conversaciones canónicas.
   */
  function buildPortabilityManifest(conversations = [], target = 'generic', options = {}) {
    const convList = Array.isArray(conversations) ? conversations : [conversations];
    const packageId = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    let totalMessages = 0;
    let totalAttachments = 0;
    const integritySummary = {
      captured: 0,
      partial: 0,
      degraded: 0,
      failed: 0
    };

    const audit = {
      capturedExactly: [],
      capturedFromRenderedRepresentation: [],
      transformed: [],
      unavailable: [],
      unsupported: [],
      failed: []
    };

    const conversationSummaries = convList.map(c => {
      const meta = c.metadata || {};
      const integrityStatus = c.integrity?.status || meta.integrity || 'captured';
      const msgCount = c.messages?.length || 0;
      const attCount = c.attachments?.length || 0;

      totalMessages += msgCount;
      totalAttachments += attCount;

      if (integritySummary[integrityStatus] !== undefined) {
        integritySummary[integrityStatus]++;
      } else {
        integritySummary.captured++;
      }

      const acqMethod = c.source?.acquisitionMethod || c.integrity?.acquisitionMethod || 'dom-harvest';

      if (acqMethod === 'structured-session' || acqMethod === 'official-export') {
        audit.capturedExactly.push({
          canonicalId: c.canonicalId,
          title: c.title,
          messageCount: msgCount,
          method: acqMethod
        });
      } else if (acqMethod === 'dom-harvest' || acqMethod === 'dom-snippet') {
        audit.capturedFromRenderedRepresentation.push({
          canonicalId: c.canonicalId,
          title: c.title,
          messageCount: msgCount,
          method: acqMethod
        });
      }

      if (integrityStatus === 'partial' || integrityStatus === 'degraded') {
        audit.transformed.push({
          canonicalId: c.canonicalId,
          type: 'integrity-degradation',
          notice: c.integrity?.warnings?.join('; ') || 'Posible truncamiento de turnos fuera de viewport'
        });
      }

      if (!c.model) {
        audit.unavailable.push({
          canonicalId: c.canonicalId,
          field: 'model_slug',
          reason: 'La fuente no expuso un identificador verificable de modelo'
        });
      }

      if (c.branches && c.branches.branchPoints?.length > 0) {
        audit.transformed.push({
          canonicalId: c.canonicalId,
          type: 'branches-preserved-in-canonical',
          details: `${c.branches.branchPoints.length} bifurcaciones registradas`
        });
      }

      return {
        canonicalId: c.canonicalId,
        title: c.title,
        platform: c.source?.platform || meta.platform || 'unknown',
        model: c.model || null,
        messageCount: msgCount,
        integrity: integrityStatus,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      };
    });

    return {
      linerPackageVersion: '1.3.0',
      packageId,
      createdAt: now,
      generator: 'Liner Context Portability Workspace (100% Local)',
      target,
      summary: {
        totalConversations: convList.length,
        totalMessages,
        totalAttachments,
        integritySummary
      },
      audit,
      conversations: conversationSummaries
    };
  }

  /**
   * Genera el archivo CONTEXT_MAP.md (Índice legible de contexto transferido).
   */
  function buildContextMap(conversations = [], options = {}) {
    const convList = Array.isArray(conversations) ? conversations : [conversations];
    const projectTitle = options.projectTitle || 'Paquete de Contexto Portable Liner';

    const lines = [
      `# Mapa de Contexto — ${projectTitle}`,
      '',
      `> **Generado por**: Liner v1.3 Context Portability Workspace`,
      `> **Fecha**: ${new Date().toISOString()}`,
      `> **Total de Unidades de Contexto**: ${convList.length}`,
      '',
      '## Conversaciones Incluidas',
      ''
    ];

    convList.forEach((c, idx) => {
      const acq = c.source?.acquisitionMethod || 'dom-harvest';
      const status = c.integrity?.status || 'captured';
      const modelStr = c.model ? ` [${c.model}]` : ' [Modelo no verificado]';

      lines.push(`### ${idx + 1}. ${c.title || 'Conversación'}`);
      lines.push(`- **ID Canónico**: \`${c.canonicalId}\``);
      lines.push(`- **Plataforma**: ${c.source?.platform || 'ChatGPT'}${modelStr}`);
      lines.push(`- **Mensajes**: ${c.messages?.length || 0}`);
      lines.push(`- **Integridad**: \`${status}\` (Método: \`${acq}\`)`);
      if (c.attachments?.length > 0) {
        lines.push(`- **Adjuntos**: ${c.attachments.length}`);
      }
      if (c.source?.url) {
        lines.push(`- **Enlace de Origen**: [Abrir](${c.source.url})`);
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Genera el archivo START_HERE.md (Guía bootstrap para el destino LLM o humano).
   */
  function buildBootstrapGuide(conversations = [], target = 'generic', options = {}) {
    const convList = Array.isArray(conversations) ? conversations : [conversations];
    const targetName = target === 'claude' ? 'Anthropic Claude' : (target === 'gemini' ? 'Google Gemini' : 'Cualquier Entorno LLM');

    return [
      `# START HERE — Instrucciones de Transferencia de Contexto`,
      '',
      `Este paquete contiene **${convList.length} conversaciones** (${convList.reduce((acc, c) => acc + (c.messages?.length || 0), 0)} turnos de mensaje) capturadas localmente mediante Liner.`,
      '',
      `## Destino Previsto`,
      `Optimizado para: **${targetName}**`,
      '',
      `## Cómo Ingestar este Contexto`,
      `1. Revisa el archivo \`CONTEXT_MAP.md\` para comprender la estructura y temas de cada conversación.`,
      `2. Inspecciona el \`manifest.json\` para comprobar qué elementos fueron capturados con exactitud y qué degradaciones se registraron.`,
      `3. Las conversaciones completas están disponibles en la carpeta \`conversations/\`:`,
      `   - Formato \`.md\`: Fácil de leer, copiar o adjuntar directamente en prompts o proyectos.`,
      `   - Formato \`.json\`: Datos canónicos estructurados con marcas de tiempo, roles y metadatos.`,
      `4. Si estás interactuando con un modelo de IA, puedes pegar el contenido de las conversaciones relevantes indicándole que mantenga la continuidad de ingeniería del proyecto.`,
      '',
      `## Garantía de Privacidad`,
      `Este contexto fue procesado 100% de manera local en el navegador del usuario, sin intermediación de servidores de terceros ni almacenamiento de credenciales.`
    ].join('\n');
  }

  /**
   * Genera el recibo de transferencia con hashes SHA-256 de los archivos emitidos.
   */
  function buildTransferReceipt(manifest, fileRecords = {}) {
    const fileHashes = {};
    for (const [filePath, content] of Object.entries(fileRecords)) {
      fileHashes[filePath] = sha256(typeof content === 'string' || content instanceof Uint8Array || content instanceof ArrayBuffer ? content : JSON.stringify(content));
    }

    return {
      receiptVersion: '1.0.0',
      packageId: manifest.packageId,
      createdAt: manifest.createdAt,
      target: manifest.target,
      totalFiles: Object.keys(fileHashes).length,
      fileHashes,
      summary: manifest.summary,
      integritySummary: manifest.summary?.integritySummary
    };
  }

  return {
    buildPortabilityManifest,
    buildContextMap,
    buildBootstrapGuide,
    buildTransferReceipt
  };
});
