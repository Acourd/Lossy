/**
 * Lossy — Multi-Platform Adapter (ChatGPT, Claude.ai, Gemini)
 * Detección unificada de plataforma y extracción DOM limpia (incluyendo tablas Markdown,
 * filtrado de trazas de pensamiento/UI chrome e imágenes) a Modelo Canónico Lossy.
 * 100% local-first, zero-dependencies. Dual Browser/Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Lossy = root.Lossy || {};
    root.Lossy.MultiPlatform = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function detectPlatform(url) {
    const raw = String(url || '');
    if (!raw) return null;
    if (/^https?:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(raw)) {
      const m = raw.match(/\/c\/([a-zA-Z0-9_-]+)/);
      return { platform: 'chatgpt', label: 'ChatGPT', conversationId: m ? m[1] : null };
    }
    if (/^https?:\/\/claude\.ai(?:\/|$)/i.test(raw)) {
      const m = raw.match(/\/chat\/([a-zA-Z0-9_-]+)/);
      return { platform: 'claude', label: 'Claude', conversationId: m ? m[1] : null };
    }
    if (/^https?:\/\/gemini\.google\.com(?:\/|$)/i.test(raw)) {
      const m = raw.match(/\/(?:app|gem\/[^/]+)\/([a-zA-Z0-9_-]+)/);
      return { platform: 'gemini', label: 'Gemini', conversationId: m ? m[1] : null };
    }
    return null;
  }

  function isIgnoredUiNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = (node.tagName || '').toLowerCase();
    if ([
      'button', 'nav', 'svg', 'style', 'script', 'mat-icon',
      'model-thoughts', 'thought-header', 'sources-carousel',
      'sources-carousel-inline', 'response-footer', 'message-actions',
      'tts-control', 'thumb-up-button', 'thumb-down-button', 'copy-button',
      'bard-avatar', 'user-profile-picture'
    ].includes(tag)) {
      return true;
    }
    const cls = typeof node.className === 'string' ? node.className : '';
    if (/(?:^|\s)(?:cdk-visually-hidden|sr-only|visually-hidden|thoughts-container|thoughts-header|thinking-container|thinking-panel|thought-summary|search-chip|grounding-attributions|response-container-footer|query-header|avatar-container)(?:\s|$)/i.test(cls)) {
      return true;
    }
    const ariaHidden = node.getAttribute ? node.getAttribute('aria-hidden') : null;
    if (ariaHidden === 'true' && tag !== 'div' && tag !== 'section') return true;
    return false;
  }

  function serializeTableToMarkdown(tableNode) {
    const rows = [];
    const trNodes = tableNode.querySelectorAll ? Array.from(tableNode.querySelectorAll('tr')) : [];
    if (!trNodes.length) return '';

    for (const tr of trNodes) {
      const cellNodes = tr.querySelectorAll ? Array.from(tr.querySelectorAll('th, td')) : [];
      if (!cellNodes.length) continue;
      const cells = cellNodes.map(cell => {
        const raw = serializeDomToMarkdown(cell)
          .replace(/\r?\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/\|/g, '\\|')
          .trim();
        return raw;
      });
      rows.push(cells);
    }

    if (!rows.length) return '';
    const colCount = Math.max(...rows.map(r => r.length));
    const padRow = r => {
      const out = r.slice();
      while (out.length < colCount) out.push('');
      return `| ${out.join(' | ')} |`;
    };
    const header = padRow(rows[0]);
    const sep = `| ${Array(colCount).fill('---').join(' | ')} |`;
    const body = rows.slice(1).map(padRow);
    return `\n\n${[header, sep, ...body].join('\n')}\n\n`;
  }

  function serializeDomToMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (isIgnoredUiNode(node)) return '';

    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'img') return '';
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'table') return serializeTableToMarkdown(node);

    if (tag === 'pre') {
      const code = node.querySelector ? node.querySelector('code') : null;
      const cls = code?.className || '';
      const lang = (cls.match(/language-([\w+-]+)/) || [])[1] || '';
      const rawCode = (code ? code.textContent : node.textContent) || '';
      return `\n\n\`\`\`${lang}\n${rawCode.trim()}\n\`\`\`\n\n`;
    }

    const inner = Array.from(node.childNodes || []).map(serializeDomToMarkdown).join('');
    if (tag === 'code') {
      const cleanCode = inner.trim();
      return cleanCode ? `\`${cleanCode}\`` : '';
    }
    if (/^h[1-6]$/.test(tag)) {
      const heading = inner.trim();
      if (!heading || /^(?:tú dijiste|you said|gemini dijo|gemini said|claude said|claude dijo)\b/i.test(heading)) {
        return '';
      }
      return `\n\n${'#'.repeat(Number(tag[1]))} ${heading}\n\n`;
    }
    if (tag === 'li') {
      const item = inner.trim();
      return item ? `\n- ${item}` : '';
    }
    if (tag === 'strong' || tag === 'b') {
      const bold = inner.trim();
      return bold ? ` **${bold}** ` : '';
    }
    if (tag === 'em' || tag === 'i') {
      const ital = inner.trim();
      return ital ? ` *${ital}* ` : '';
    }
    if (tag === 'a') {
      const href = node.getAttribute ? (node.getAttribute('href') || '') : '';
      const label = inner.trim() || href;
      if (/^https?:\/\//i.test(href)) return `[${label}](${href})`;
      return label;
    }
    if (['p', 'div', 'ul', 'ol', 'blockquote', 'section', 'article'].includes(tag)) {
      return `\n${inner}\n`;
    }
    return inner;
  }

  function normalizeText(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // Strip leftover Gemini sr-only prefixes if they appeared in plain text
      .replace(/^(?:Tú dijiste|You said)\s+[^\n]*…\s*\n+/i, '')
      .replace(/^(?:Tú dijiste|You said)\s+/i, '')
      .replace(/^(?:Gemini dijo|Gemini said)\s*\n+/i, '')
      .replace(/\n+Completado\s*$/i, '')
      .trim();
  }

  function extractCodeBlocks(text) {
    const blocks = [];
    const re = /```([a-zA-Z0-9_\-+.]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      blocks.push({ language: m[1] || 'plaintext', code: m[2].trim() });
    }
    return blocks;
  }

  function isContentImage(img) {
    if (!img) return false;
    const src = img.currentSrc || (img.getAttribute ? img.getAttribute('src') : null) || img.src || '';
    if (!src || /avatar|favicon|profile|googleusercontent\.com\/a\/|\/icons?\/|data:image\/svg/i.test(src)) return false;
    if (img.closest && img.closest('button, [role="button"], bard-avatar, user-profile-picture, .avatar-container')) return false;
    const w = Number(img.getAttribute?.('width')) || img.naturalWidth || img.width || 0;
    const h = Number(img.getAttribute?.('height')) || img.naturalHeight || img.height || 0;
    if ((w > 0 && w <= 36) || (h > 0 && h <= 36)) return false;
    return true;
  }

  function captureImgSyncDataUri(img) {
    const src = img.currentSrc || (img.getAttribute ? img.getAttribute('src') : null) || img.src || '';
    if (src.startsWith('data:image/')) return src;
    if (typeof document === 'undefined' || !img.complete || !(img.naturalWidth > 0)) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const uri = canvas.toDataURL('image/png');
        if (uri && uri.startsWith('data:image/')) return uri;
      }
    } catch (_) {}
    return null;
  }

  function extractImagesFromNode(node, platform, turnIdx) {
    if (!node || !node.querySelectorAll) return [];
    const imgs = Array.from(node.querySelectorAll('img')).filter(isContentImage);
    const seen = new Set();
    const out = [];
    imgs.forEach((img, iIdx) => {
      const src = img.currentSrc || (img.getAttribute ? img.getAttribute('src') : null) || img.src || '';
      if (!src || seen.has(src)) return;
      seen.add(src);
      const dataURI = captureImgSyncDataUri(img);
      const alt = (img.getAttribute ? img.getAttribute('alt') : '') || '';
      const filename = `${platform}_img_${turnIdx + 1}_${iIdx + 1}.png`;
      out.push({
        id: `att_${platform}_${turnIdx + 1}_${iIdx + 1}`,
        assetId: `att_${platform}_${turnIdx + 1}_${iIdx + 1}`,
        sourceMessageId: `msg_${platform}_${turnIdx + 1}`,
        name: alt || filename,
        filename,
        mimeType: 'image/png',
        kind: 'image',
        sourceType: `${platform}-dom-image`,
        sourceURL: src.startsWith('data:') ? null : src,
        url: src.startsWith('data:') ? null : src,
        dataURI: dataURI || (src.startsWith('data:image/') ? src : null),
        availability: dataURI || src.startsWith('data:image/') ? 'embedded' : 'referenced'
      });
    });
    return out;
  }

  function buildCanonical(platform, label, convId, url, title, turns) {
    const now = new Date().toISOString();
    const safeId = convId || `dom_${Date.now()}`;
    const allAttachments = [];
    const messages = turns.map((t, idx) => {
      const text = normalizeText(t.text);
      const codeBlocks = extractCodeBlocks(text);
      const attachments = Array.isArray(t.attachments) ? t.attachments : [];
      attachments.forEach(a => allAttachments.push(a));
      return {
        id: `msg_${platform}_${idx + 1}`,
        role: t.role,
        author: t.role === 'user' ? 'Usuario' : label,
        isConversational: true,
        nodeCategory: t.role,
        timestamp: now,
        createdAt: now,
        text,
        content: { text, codeBlocks, citations: [], attachments },
        codeBlocks,
        attachments,
        references: []
      };
    }).filter(m => m.text.length > 0 || m.attachments.length > 0);

    return {
      canonicalId: `conv_${platform}_${safeId}`,
      title: normalizeText(title) || `Conversación ${label}`,
      source: {
        platform,
        conversationId: safeId,
        url: url || '',
        acquisitionMethod: 'dom-harvest'
      },
      sourcePlatform: platform,
      model: null,
      createdAt: now,
      updatedAt: now,
      messages,
      conversationMessageCount: messages.length,
      visibleMessageCount: messages.length,
      integrity: { status: messages.length > 0 ? 'captured' : 'partial' },
      attachments: allAttachments,
      references: []
    };
  }

  function extractClaudeDom(doc, url) {
    const detected = detectPlatform(url) || { platform: 'claude', label: 'Claude', conversationId: null };
    const title = (doc.title || '').replace(/\s*[-–|]\s*Claude\s*$/i, '').trim() || 'Conversación Claude';
    const nodes = Array.from(doc.querySelectorAll(
      '[data-testid="user-message"], [data-testid="chat-message-content"], .font-user-message, .font-claude-message'
    ));

    const seen = new Set();
    const turns = [];
    for (const el of nodes) {
      if (seen.has(el) || nodes.some(other => other !== el && other.contains && other.contains(el))) continue;
      seen.add(el);
      const testId = (el.getAttribute && el.getAttribute('data-testid')) || '';
      const cls = el.className || '';
      const isUser = testId === 'user-message' || /\bfont-user-message\b/.test(cls);
      const attachments = extractImagesFromNode(el, 'claude', turns.length);
      const text = normalizeText(serializeDomToMarkdown(el) || el.textContent || '');
      if (text || attachments.length) turns.push({ role: isUser ? 'user' : 'assistant', text, attachments });
    }

    return buildCanonical('claude', 'Claude', detected.conversationId, url, title, turns);
  }

  function extractGeminiDom(doc, url) {
    const detected = detectPlatform(url) || { platform: 'gemini', label: 'Gemini', conversationId: null };
    const title = (doc.title || '').replace(/\s*[-–|]\s*(?:Google\s+)?Gemini\s*$/i, '').trim() || 'Conversación Gemini';
    const nodes = Array.from(doc.querySelectorAll(
      'user-query, model-response, .query-text, .model-response-text'
    ));

    const seen = new Set();
    const turns = [];
    for (const el of nodes) {
      if (seen.has(el) || nodes.some(other => other !== el && other.contains && other.contains(el))) continue;
      seen.add(el);
      const tag = (el.tagName || '').toLowerCase();
      const cls = el.className || '';
      const isUser = tag === 'user-query' || /\bquery-text\b/.test(cls);

      // Prefer the clean inner content container in Gemini to skip thinking traces & headers
      let contentRoot = el;
      if (!isUser && el.querySelector) {
        const innerMd = el.querySelector('message-content .markdown, .model-response-text .markdown, message-content, .model-response-text');
        if (innerMd) contentRoot = innerMd;
      } else if (isUser && el.querySelector) {
        const innerQuery = el.querySelector('.query-text, .user-query-container');
        if (innerQuery) contentRoot = innerQuery;
      }

      // Capture images from the full turn node (uploaded images sit in user-query sibling container)
      const attachments = extractImagesFromNode(el, 'gemini', turns.length);
      const text = normalizeText(serializeDomToMarkdown(contentRoot) || contentRoot.textContent || '');
      if (text || attachments.length) turns.push({ role: isUser ? 'user' : 'assistant', text, attachments });
    }

    return buildCanonical('gemini', 'Gemini', detected.conversationId, url, title, turns);
  }

  return {
    detectPlatform,
    serializeDomToMarkdown,
    extractClaudeDom,
    extractGeminiDom
  };
});
