/**
 * AI Conversation Portability (AICP / Liner) — Serializador a Markdown v1.3
 * Genera Markdown estándar con Frontmatter YAML estructurado, referencias,
 * adjuntos y delimitación limpia de turnos. Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const serializer = factory();
    root.Liner.MarkdownSerializer = serializer;
    root.Lossy.MarkdownSerializer = serializer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeYamlString(str) {
    if (typeof str !== 'string') return '""';
    return JSON.stringify(str);
  }

  /**
   * Serializa una conversación canónica AICP/Liner v1.3 a formato Markdown.
   */
  function serializeToMarkdown(conv, options = {}) {
    if (!conv || typeof conv !== 'object') return '';
    if (conv.entityType === 'clip' || Array.isArray(conv.selectedMessages)) {
      return serializeClipToMarkdown(conv, options);
    }
    const meta = conv.metadata || {};
    const messages = conv.messages || [];

    const title = conv.title || meta.title || 'Conversación';
    const platform = conv.source?.platform || meta.platform || 'unknown';
    const model = conv.model !== undefined ? conv.model : meta.model;
    const hasModel = model && model !== 'unspecified' && model !== 'unknown';
    const platformHeader = hasModel ? `${platform} (${model})` : platform;

    // Integridad
    let integrityStatus = meta.integrity || (typeof conv.integrity === 'string' ? conv.integrity : (conv.integrity?.status || 'harvested'));
    let integrityNotice = meta.integrityNotice || (Array.isArray(conv.integrity?.warnings) ? conv.integrity.warnings.join('; ') : null);

    const exportedAt = conv.createdAt || meta.exportedAt || new Date().toISOString();
    const sourceUrl = conv.source?.url || meta.url || '';

    const frontmatterLines = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `platform: ${escapeYamlString(platform)}`,
      `model: ${hasModel ? escapeYamlString(model) : 'null'}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      `source: ${escapeYamlString(sourceUrl)}`,
      `total_messages: ${messages.length}`,
      `integrity: ${escapeYamlString(integrityStatus)}`
    ];

    if ((integrityStatus === 'partial' || integrityStatus === 'degraded') && integrityNotice) {
      frontmatterLines.push(`capture_notice: ${escapeYamlString(integrityNotice)}`);
    }

    frontmatterLines.push('schema: "AICP v1.0.0"', '---', '');
    const frontmatter = frontmatterLines.join('\n');

    let integrityText = '> **Integridad**: Recorrido de scroll (harvested)';
    if (integrityStatus === 'partial') {
      integrityText = '> **Integridad**: Captura parcial (turnos visibles en DOM)';
    } else if (integrityStatus === 'degraded') {
      integrityText = '> **Integridad**: Captura degradada con advertencias';
    } else if (integrityStatus === 'failed') {
      integrityText = '> **Integridad**: Captura fallida';
    } else if (integrityStatus === 'captured' && conv.source?.acquisitionMethod === 'structured-session') {
      integrityText = '> **Integridad**: Captura estructurada verificada';
    }

    const header = [
      `# ${title}`,
      '',
      `> **Exportador**: Liner Context Portability Layer (100% Local-First)`,
      `> **Plataforma Original**: ${platformHeader}`,
      integrityText,
      `> **Fecha**: ${new Date(exportedAt).toLocaleString()}`,
      sourceUrl ? `> **Enlace Original**: [Abrir conversación](${sourceUrl})` : '',
      '',
      '---',
      ''
    ].filter(line => line !== null && line !== '').join('\n');

    const bodyParts = [];

    messages.forEach((msg, index) => {
      const isUser = msg.role === 'user';
      const roleIcon = isUser ? '👤' : (msg.role === 'system' ? '⚙️' : (msg.role === 'tool' ? '🔧' : '🤖'));
      const authorName = msg.author || (isUser ? 'Usuario' : 'Asistente');
      const msgModel = msg.model || (hasModel ? model : null);
      const modelTag = !isUser && msgModel ? ` (${msgModel})` : '';
      const timeStr = msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString()}` : '';

      const turnHeader = `### ${roleIcon} ${authorName}${modelTag}${timeStr}\n`;
      let contentText = msg.content?.text || '';

      // Bloques de código
      const codeBlocks = msg.content?.codeBlocks || [];
      if (codeBlocks.length > 0 && !contentText.includes('```')) {
        const codeMd = codeBlocks.map(cb => {
          const lang = cb.language || '';
          const body = String(cb.code || '');
          let maxRun = 0;
          let run = 0;
          for (let i = 0; i < body.length; i++) {
            if (body.charCodeAt(i) === 96) { run++; if (run > maxRun) maxRun = run; }
            else run = 0;
          }
          const fence = '`'.repeat(Math.max(3, maxRun + 1));
          return `\n${fence}${lang}\n${body}\n${fence}`;
        }).join('\n');
        contentText += `\n${codeMd}`;
      }

      // Adjuntos
      const attachments = msg.attachments || msg.content?.attachments || [];
      if (attachments.length > 0) {
        const attMd = attachments.map(att => `- 📎 **${att.name || 'Adjunto'}** (${att.mimeType || 'archivo'})`).join('\n');
        contentText += `\n\n**Adjuntos:**\n${attMd}`;
      }

      // Referencias / Citas
      const citations = msg.references || msg.content?.citations || [];
      if (citations.length > 0) {
        const citMd = citations.map((c, i) => `[${i + 1}] [${c.title || c.url}](${c.url})`).join('\n');
        contentText += `\n\n**Fuentes y Referencias:**\n${citMd}`;
      }

      bodyParts.push(`${turnHeader}\n${contentText.trim()}\n\n---`);
    });

    return `${frontmatter}${header}${bodyParts.join('\n\n')}\n`;
  }

  /**
   * Serializa un Clip canónico de Lossy a formato Markdown estructurado según especificación de producto.
   */
  function serializeClipToMarkdown(clip, options = {}) {
    if (!clip || typeof clip !== 'object') return '';

    const title = clip.title || 'Clip de Contexto';
    const clipId = clip.canonicalId || clip.id || '';
    const platform = (clip.sourcePlatform || 'ChatGPT').toUpperCase();
    const convId = clip.sourceConversationCanonicalId || clip.sourceConversationId || '';
    const convTitle = clip.sourceConversationTitle || 'Conversación ChatGPT';
    const messages = Array.isArray(clip.selectedMessages) ? clip.selectedMessages : (Array.isArray(clip.messages) ? clip.messages : []);
    const captureTime = clip.provenance?.captureTimestamp || '';
    const clipCreated = clip.createdAt || clip.provenance?.clipCreationTimestamp || new Date().toISOString();
    const selectionType = clip.selectionType || 'multi-message';
    const sourceStatus = clip.provenance?.sourceStatus || clip.sourceStatus || 'source_available_locally';

    const frontmatterLines = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `clipId: ${escapeYamlString(clipId)}`,
      `sourceConversationId: ${escapeYamlString(convId)}`,
      `sourceConversationTitle: ${escapeYamlString(convTitle)}`,
      `platform: ${escapeYamlString(platform)}`,
      `selectionType: ${escapeYamlString(selectionType)}`,
      `sourceStatus: ${escapeYamlString(sourceStatus)}`,
      `totalMessages: ${messages.length}`,
      captureTime ? `capturedAt: ${escapeYamlString(captureTime)}` : null,
      `createdAt: ${escapeYamlString(clipCreated)}`,
      '---'
    ].filter(Boolean);

    const headerLines = [
      ...frontmatterLines,
      '',
      `# ${title}`,
      '',
      `Source: ${platform}`,
      `Conversation: ${convTitle}`,
      `Conversation ID: ${convId}`,
      `Clip ID: ${clipId}`,
      `Messages: ${messages.length}`,
      `Selection: ${selectionType}`,
      `Source status: ${sourceStatus}`,
      captureTime ? `Captured: ${captureTime}` : '',
      `Clip created: ${clipCreated}`,
      '',
      '---',
      ''
    ].filter(l => l !== '');

    const bodyParts = [];
    messages.forEach((m, idx) => {
      const roleName = m.role === 'user' ? 'User' : (m.role === 'assistant' ? 'Assistant' : (m.role || 'Mensaje'));
      const authorText = m.author ? ` (${m.author})` : '';
      const turnHeader = `## ${roleName}`;
      let contentText = (m.content && typeof m.content === 'object') ? (m.content.text || '') : (m.text || '');

      // Bloques de código embebidos si están presentes por separado
      const codeBlocks = (m.content && Array.isArray(m.content.codeBlocks)) ? m.content.codeBlocks : (Array.isArray(m.codeBlocks) ? m.codeBlocks : []);
      if (codeBlocks.length > 0 && !contentText.includes('```')) {
        const cbText = codeBlocks.map(cb => {
          const body = String(cb.code || '');
          let maxRun = 0;
          let run = 0;
          for (let i = 0; i < body.length; i++) {
            if (body.charCodeAt(i) === 96) { run++; if (run > maxRun) maxRun = run; }
            else run = 0;
          }
          const fence = '`'.repeat(Math.max(3, maxRun + 1));
          return `${fence}${cb.language || 'plaintext'}\n${body}\n${fence}`;
        }).join('\n\n');
        contentText += `\n\n${cbText}`;
      }

      bodyParts.push(`${turnHeader}\n${contentText.trim()}`);
    });

    return `${headerLines.join('\n')}\n${bodyParts.join('\n\n')}\n`;
  }

  return {
    serializeToMarkdown,
    serializeClipToMarkdown
  };
});
