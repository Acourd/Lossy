/**
 * AI Conversation Portability (AICP) — Content Script para ChatGPT
 * Versión 1.2.1 — Extracción Resiliente con Alineación Secuencial por Solapamiento
 * Corre en el Isolated World de ChatGPT. 100% local, pasivo y sin interferir en la sesión.
 */

(function () {
  'use strict';

  // Idioma de la interfaz: inglés por defecto; español si la persona lo eligió en Configuración.
  if (typeof LossyI18n !== 'undefined') {
    LossyI18n.setLanguage('en');
    try {
      chrome.storage.local.get('lossy.uiLanguage').then(stored => {
        LossyI18n.setLanguage(stored['lossy.uiLanguage'] === 'es' ? 'es' : 'en');
      }).catch(() => {});
    } catch (_) { /* sin API de extensión */ }
  }

  // Guard de idempotencia para prevenir colisión de listeners ante re-inyección dinámica
  if (typeof window !== 'undefined') {
    if (window.__LOSSY_CS_INITIALIZED__ || window.__LINER_CS_INITIALIZED__) {
      return;
    }
    window.__LOSSY_CS_INITIALIZED__ = true;
    window.__LINER_CS_INITIALIZED__ = true;
  }

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
  }


  const UI_SELECTOR = '.lossy-action-wrapper, .lossy-message-action-btn, .lossy-popover-menu, .lossy-toast-notice, button, [role="button"], [role="toolbar"], [data-testid="tool-header"], [data-testid="plugin-header"], [data-testid="app-header"], [data-testid="connector-header"], .sr-only';
  function cleanMessageDom(clone) {
    clone.querySelectorAll?.(UI_SELECTOR).forEach(el => el.remove());
    clone.querySelectorAll?.('img').forEach(img => { if (!isContentImage(img)) img.remove(); });
    return clone;
  }
  function serializeTableDom(tableNode) {
    const trNodes = tableNode.querySelectorAll ? Array.from(tableNode.querySelectorAll('tr')) : [];
    if (!trNodes.length) return '';
    const rows = [];
    for (const tr of trNodes) {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(c =>
        messageDomText(c).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
      );
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const fmt = r => `| ${r.concat(Array(Math.max(0, cols - r.length)).fill('')).join(' | ')} |`;
    return `\n\n${fmt(rows[0])}\n| ${Array(cols).fill('---').join(' | ')} |\n${rows.slice(1).map(fmt).join('\n')}\n\n`;
  }
  function messageDomText(node) {
    if (node.nodeType === 3) return node.textContent || '';
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'img') return '';
    if (tag === 'br') return '\n';
    if (tag === 'table') return serializeTableDom(node);
    if (tag === 'pre') {
      const code=node.querySelector('code');
      const lang=code?.className?.match(/language-([\w+-]+)/)?.[1] || '';
      const rawCode = (code?.textContent || node.textContent || '').replace(/^\n+|\n+$/g, '');
      const fence = rawCode.includes('```') ? '````' : '```';
      return '\n\n' + fence + lang + '\n' + rawCode + '\n' + fence + '\n\n';
    }
    const text = Array.from(node.childNodes || []).map(messageDomText).join('');
    if (tag === 'code') return '`' + text + '`';
    if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + text + '\n\n';
    if (tag === 'li') return '\n- ' + text;
    if (['p','div','ul','ol','blockquote'].includes(tag)) return '\n' + text + '\n';
    if (tag === 'strong' || tag === 'b') return '**' + text + '**';
    if (tag === 'a' && /^https?:/i.test(node.getAttribute('href') || '')) return '[' + text + '](<' + node.getAttribute('href').replace(/>/g,'%3E') + '>)';
    return text || node.textContent || '';
  }
  function isContentImage(img) {
    const src = img.currentSrc || img.getAttribute?.('src') || img.src || '';
    if (!src || /avatar|favicon|\/icons?\/|data:image\/svg/i.test(src)) return false;
    if (img.closest?.('button, [role="button"], [role="toolbar"], [data-testid="tool-header"], [data-testid="plugin-header"], [data-testid="app-header"], [data-testid="connector-header"]')) return false;
    const w = Number(img.getAttribute?.('width')) || img.naturalWidth || 0;
    const h = Number(img.getAttribute?.('height')) || img.naturalHeight || 0;
    return !((w > 0 && w <= 32) || (h > 0 && h <= 32));
  }

  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Identifica el elemento y selector del contenedor de scroll.
   */
  function detectScrollContainer() {
    const candidates = [
      { selector: '.thread-scroll-container', elem: document.querySelector('.thread-scroll-container') },
      { selector: '[class*="thread-scroll-container"]', elem: document.querySelector('[class*="thread-scroll-container"]') },
      { selector: 'main div[class*="overflow-y-auto"]', elem: document.querySelector('main div[class*="overflow-y-auto"]') },
      { selector: 'div[class*="react-scroll-to-bottom"]', elem: document.querySelector('div[class*="react-scroll-to-bottom"]') },
      { selector: 'document.scrollingElement', elem: document.scrollingElement },
      { selector: 'document.documentElement', elem: document.documentElement }
    ];
    // Prefer a candidate that actually overflows vertically so a non-scrollable wrapper never hides a scrollable child
    for (const c of candidates) {
      if (c.elem && (c.elem.scrollHeight || 0) > (c.elem.clientHeight || 0) + 16) {
        return { element: c.elem, matchedSelector: c.selector };
      }
    }
    for (const c of candidates) {
      if (c.elem) return { element: c.elem, matchedSelector: c.selector };
    }
    return { element: document.documentElement, matchedSelector: 'document.documentElement' };
  }

  /**
   * Localiza el contenedor de scroll principal de la conversación.
   */
  function findScrollContainer() {
    return detectScrollContainer().element;
  }

  /**
   * Intenta observar el modelo de IA utilizado exclusivamente si existe evidencia explícita en el DOM.
   * Si no se puede verificar con certeza demostrable (por ejemplo, en Custom GPTs o interfaces limpias),
   * retorna null en cumplimiento estricto del principio de veracidad epistémica.
   */
  function detectModelFromDom() {
    if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return null;
    const modelBtn = document.querySelector('[data-testid="model-switcher-dropdown-button"]') ||
                     document.querySelector('button[aria-haspopup="menu"][class*="text-token-text-secondary"]');
    if (!modelBtn) return null;

    const rawText = (modelBtn.textContent || modelBtn.innerText || '').trim();
    if (!rawText) return null;

    const lower = rawText.toLowerCase();
    if (lower.includes('4o') && !lower.includes('mini')) return 'gpt-4o';
    if (lower.includes('4o-mini') || lower.includes('mini')) return 'gpt-4o-mini';
    if (lower.includes('o1')) return 'o1';
    if (lower.includes('o3')) return 'o3';
    if (lower.includes('gpt-4')) return 'gpt-4';
    if (rawText.length > 0 && rawText.length < 25 && /^[a-zA-Z0-9.\-_ ]+$/.test(rawText)) {
      return rawText;
    }

    return null;
  }

  function stableHash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function attachmentSignature(att) {
    if (!att) return '';
    return att.sourceURL || att.url || (att.dataURI ? att.dataURI.slice(0, 96) + ':' + att.dataURI.length : '') || att.assetId || att.id || '';
  }

  /**
   * Compara dos turnos individuales de forma estricta por identidad, rol, texto, código y adjuntos.
   */
  function areTurnsEqual(t1, t2) {
    if (!t1 || !t2) return false;
    if (t1.id && t2.id && t1.id !== t2.id) return false;
    if (t1.role !== t2.role) return false;
    if (t1.text !== t2.text) return false;
    const cb1 = t1.codeBlocks || [];
    const cb2 = t2.codeBlocks || [];
    if (cb1.length !== cb2.length) return false;
    for (let i = 0; i < cb1.length; i++) {
      if (cb1[i].code !== cb2[i].code || cb1[i].language !== cb2[i].language) {
        return false;
      }
    }
    const a1 = t1.attachments || [];
    const a2 = t2.attachments || [];
    if (a1.length !== a2.length) return false;
    for (let i = 0; i < a1.length; i++) {
      if (attachmentSignature(a1[i]) !== attachmentSignature(a2[i])) return false;
    }
    return true;
  }

  function isTurnCompatibleForOverlap(accItem, snapItem) {
    if (areTurnsEqual(accItem, snapItem)) return true;
    if (!accItem || !snapItem || accItem.role !== snapItem.role) return false;
    if (accItem.id && snapItem.id) return accItem.id === snapItem.id;
    if (!accItem.id && !snapItem.id && accItem.text && snapItem.text) {
      return snapItem.text.startsWith(accItem.text) || accItem.text.startsWith(snapItem.text);
    }
    return false;
  }

  function mergeMonotonicCodeBlocks(existingBlocks, incomingBlocks) {
    const a = Array.isArray(existingBlocks) ? existingBlocks : [];
    const b = Array.isArray(incomingBlocks) ? incomingBlocks : [];
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    const result = a.slice();
    const matchedOld = new Set();
    const matchedNew = new Set();
    const enrichLang = (picked, prev, next) => {
      const bestLang = String(picked?.language || '') || String(next?.language || '') || String(prev?.language || '');
      return bestLang && picked?.language !== bestLang ? { ...picked, language: bestLang } : picked;
    };
    for (let j = 0; j < b.length; j++) {
      const nextCode = String(b[j]?.code || '');
      const nextLang = String(b[j]?.language || '');
      let exactIdx = -1;
      for (let i = 0; i < a.length; i++) {
        if (matchedOld.has(i)) continue;
        if (String(a[i]?.code || '') !== nextCode) continue;
        if (String(a[i]?.language || '') === nextLang) { exactIdx = i; break; }
        if (exactIdx === -1) exactIdx = i;
      }
      if (exactIdx !== -1) {
        matchedOld.add(exactIdx);
        matchedNew.add(j);
        result[exactIdx] = enrichLang(a[exactIdx], a[exactIdx], b[j]);
      }
    }
    const edgesByNew = new Map();
    const degOld = new Map();
    for (let j = 0; j < b.length; j++) {
      if (matchedNew.has(j)) continue;
      const nextCode = String(b[j]?.code || '');
      const nextLang = String(b[j]?.language || '');
      if (!nextCode.length) continue;
      const cands = [];
      for (let i = 0; i < a.length; i++) {
        if (matchedOld.has(i)) continue;
        const prevCode = String(a[i]?.code || '');
        const prevLang = String(a[i]?.language || '');
        if (prevLang && nextLang && prevLang !== nextLang) continue;
        if (prevCode.length > 0 && (prevCode.includes(nextCode) || nextCode.includes(prevCode))) {
          cands.push(i);
          degOld.set(i, (degOld.get(i) || 0) + 1);
        }
      }
      edgesByNew.set(j, cands);
    }
    const unmatchedNew = [];
    for (let j = 0; j < b.length; j++) {
      if (matchedNew.has(j)) continue;
      const cands = edgesByNew.get(j) || [];
      const nextCode = String(b[j]?.code || '');
      if (cands.length === 1 && degOld.get(cands[0]) === 1) {
        const idx = cands[0];
        matchedOld.add(idx);
        matchedNew.add(j);
        const prevCode = String(a[idx]?.code || '');
        result[idx] = enrichLang(nextCode.length >= prevCode.length ? b[j] : a[idx], a[idx], b[j]);
      } else if (cands.length > 0 && cands.every(i => String(a[i]?.code || '').length > nextCode.length)) {
        continue;
      } else {
        unmatchedNew.push(b[j]);
      }
    }
    return result.concat(unmatchedNew);
  }

  function mergeMonotonicTurn(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const oldText = String(existing.text || '');
    const newText = String(incoming.text || '');
    const bestText = newText.length >= oldText.length ? newText : oldText;
    const bestCode = mergeMonotonicCodeBlocks(existing.codeBlocks, incoming.codeBlocks);
    const bestAtts = (incoming.attachments?.length || 0) >= (existing.attachments?.length || 0)
      ? (incoming.attachments || existing.attachments || [])
      : (existing.attachments || []);
    return { ...existing, ...incoming, text: bestText, codeBlocks: bestCode, attachments: bestAtts };
  }

  /**
   * Calcula el grado de solapamiento contiguo exacto (o monotónico por ID/crecimiento) entre dos secuencias de turnos.
   */
  function computeOverlap(accumulator, newSnapshot) {
    if (!accumulator || accumulator.length === 0 || !newSnapshot || newSnapshot.length === 0) {
      return 0;
    }
    const maxK = Math.min(accumulator.length, newSnapshot.length);
    for (let k = maxK; k >= 1; k--) {
      let match = true;
      for (let i = 0; i < k; i++) {
        const accItem = accumulator[accumulator.length - k + i];
        const snapItem = newSnapshot[i];
        if (!isTurnCompatibleForOverlap(accItem, snapItem)) {
          match = false;
          break;
        }
      }
      if (match) {
        return k;
      }
    }
    if (isTurnCompatibleForOverlap(accumulator[accumulator.length - 1], newSnapshot[0])) {
      return 1;
    }
    return 0;
  }

  /**
   * Alinea dos secuencias contiguas de turnos mediante su solapamiento posicional máximo (cola de accumulator vs cabeza de newSnapshot).
   * Preserva turnos legítimos repetidos y actualiza de forma monotónica turnos en crecimiento sin duplicar ni truncar texto.
   */
  function alignAndAppendTurns(accumulator, newSnapshot) {
    if (!accumulator || accumulator.length === 0) {
      return (newSnapshot || []).slice();
    }
    if (!newSnapshot || newSnapshot.length === 0) {
      return accumulator;
    }

    const overlap = computeOverlap(accumulator, newSnapshot);
    if (overlap > 0) {
      const merged = accumulator.slice(0, accumulator.length - overlap);
      for (let i = 0; i < overlap; i++) {
        merged.push(mergeMonotonicTurn(accumulator[accumulator.length - overlap + i], newSnapshot[i]));
      }
      return merged.concat(newSnapshot.slice(overlap));
    }

    return accumulator.concat(newSnapshot);
  }

  /**
   * Extrae la representación Base64 DataURI de un elemento img del DOM mediante Canvas síncrono.
   */
  function extractImageDataUri(img) {
    if (!img) return null;
    const src = (typeof img.getAttribute === 'function' ? img.getAttribute('src') : null) || img.src || '';
    if (src.startsWith('data:image/')) return src;
    if (typeof document === 'undefined') return null;
    try {
      const targetImg = (img.complete && img.naturalWidth > 0) ? img : (document.querySelector(`img[src="${CSS.escape ? CSS.escape(src) : src}"]`) || img);
      if (targetImg && targetImg.complete && (targetImg.naturalWidth || targetImg.width) > 0) {
        const canvas = document.createElement('canvas');
        const w = targetImg.naturalWidth || targetImg.width || 300;
        const h = targetImg.naturalHeight || targetImg.height || 300;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(targetImg, 0, 0, w, h);
          const isJpeg = src.includes('.jpg') || src.includes('.jpeg');
          const dataUri = canvas.toDataURL(isJpeg ? 'image/jpeg' : 'image/png');
          if (dataUri && dataUri.startsWith('data:image/')) {
            return dataUri;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Resuelve asincrónicamente el DataURI de una imagen mediante Canvas o Fetch local autenticado.
   */
  async function resolveImageAsDataUri(imgOrUrl, externalSignal = null) {
    if (!imgOrUrl) return null;
    if (externalSignal?.aborted) return null;
    let src = '';
    let imgElem = null;
    if (typeof imgOrUrl === 'string') {
      src = imgOrUrl;
    } else if (imgOrUrl && typeof imgOrUrl === 'object') {
      imgElem = imgOrUrl;
      src = (typeof imgElem.getAttribute === 'function' ? imgElem.getAttribute('src') : null) || imgElem.src || '';
    }
    if (!src) return null;
    if (src.startsWith('data:image/')) return src;

    // 1. Intento sincrónico vía canvas
    const syncDataUri = extractImageDataUri(imgElem || { src, getAttribute: () => src });
    if (syncDataUri) return syncDataUri;

    // 2. Intento por fetch autenticado en la página de ChatGPT con timeout y señal compartida
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onExternalAbort = () => controller?.abort();
    if (externalSignal && controller) externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    const timer = controller ? setTimeout(() => controller.abort(), 1200) : null;
    try {
      if (typeof fetch === 'function' && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/'))) {
        const resp = await fetch(src, { credentials: 'include', signal: controller?.signal });
        if (resp && resp.ok && !controller?.signal?.aborted) {
          const blob = await resp.blob();
          if (controller?.signal?.aborted) return null;
          if (typeof FileReader !== 'undefined') {
            return await new Promise((resolve) => {
              const reader = new FileReader();
              const readTimer = setTimeout(() => { try { reader.abort(); } catch (_) {} resolve(null); }, 1000);
              const onAbort = () => { clearTimeout(readTimer); try { reader.abort(); } catch (_) {} resolve(null); };
              controller?.signal?.addEventListener('abort', onAbort, { once: true });
              reader.onloadend = () => { clearTimeout(readTimer); controller?.signal?.removeEventListener('abort', onAbort); resolve(controller?.signal?.aborted ? null : reader.result); };
              reader.onerror = () => { clearTimeout(readTimer); controller?.signal?.removeEventListener('abort', onAbort); resolve(null); };
              reader.readAsDataURL(blob);
            });
          }
        }
      }
    } catch (_) {
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
    return null;
  }

  /**
   * Enriquece un objeto canónico con los recursos de imagen observados físicamente en el DOM de la página.
   * Concurrencia paralela acotada y límite de tiempo estricto con cancelación real de descargas en vuelo.
   */
  async function enrichConversationWithLiveDomAssets(canonicalConv, externalSignal = null) {
    if (!canonicalConv || typeof document === 'undefined') return canonicalConv;

    const original = canonicalConv;
    canonicalConv = structuredClone(canonicalConv);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onExternalAbort = () => controller?.abort();
    if (externalSignal && controller) {
      if (externalSignal.aborted) return original;
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    if (controller) activeAssetControllers.add(controller);
    const task = (async () => {
      const messages = canonicalConv.messages || [];
      const nodes = Array.from(document.querySelectorAll('[data-message-id]'));
      for (const msg of messages) {
        if (controller?.signal?.aborted) return original;
        const node = nodes.find(n => n.getAttribute('data-message-id') === msg.id);
        if (!node) continue;
        const images = Array.from(node.querySelectorAll('img')).filter(isContentImage);
        const atts = msg.attachments || msg.content?.attachments || [];
        for (let i = 0; i < images.length; i++) {
          if (controller?.signal?.aborted) return original;
          const img = images[i];
          const src = img.currentSrc || img.getAttribute('src') || img.src;
          let att = atts.find(a => a.sourceURL === src || a.url === src);
          const identity=getChatGPTAssets()?.fileId({url:src});
          if(!att && identity)att=atts.find(a=>getChatGPTAssets().fileId(a)===identity);
          if (!att && !identity) att = atts.filter(a => a.kind === 'image' && !a.dataURI && !a.sourceURL && !a.url)[0];
          if (!att) {
            att = { id: 'dom_' + msg.id + '_' + i, assetId: 'dom_' + msg.id + '_' + i, kind: 'image', filename: 'imagen_' + i + '.png', mimeType: 'image/png', sourceType: 'dom-image' };
            atts.push(att);
          }
          att.sourceURL = src;
          att.url = src;
          att.dataURI = att.dataURI || await resolveImageAsDataUri(img, controller?.signal);
          att.availability = att.dataURI ? 'embedded' : 'referenced';
        }
        msg.attachments = atts;
        msg.content = { ...msg.content, attachments: atts };
      }
      canonicalConv.attachments = messages.flatMap(m => m.attachments || []);
      return canonicalConv;
    })();
    let timer;
    try {
      return await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => { controller?.abort(); resolve(original); }, 8000); })]);
    } finally {
      clearTimeout(timer);
      if (controller) activeAssetControllers.delete(controller);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * Extrae los turnos de conversación materializados en el DOM en el momento de la llamada.
   * Prioriza atributos estructurales ([data-message-author-role]) sobre heurísticas de encabezados.
   */
  function extractVisibleTurns(root = document) {
    const turns = [];

    const extractTurnAttachments = (clone, msgIdSeed) => {
      const attachments = [];
      const imgNodes = clone && typeof clone.querySelectorAll === 'function' ? clone.querySelectorAll('img') : [];
      let imgIdx = 0;
      imgNodes.forEach(img => {
        const src = img.getAttribute('src');
        if (!isContentImage(img)) return;
        const widthAttr = parseInt(img.getAttribute('width') || '0', 10);
        const heightAttr = parseInt(img.getAttribute('height') || '0', 10);
        if ((widthAttr > 0 && widthAttr < 32) || (heightAttr > 0 && heightAttr < 32) || src.includes('avatar')) return;

        const alt = img.getAttribute('alt') || 'imagen';
        const ext = src.startsWith('data:image/jpeg') ? 'jpg' : 'png';
        const dataUri = (typeof extractImageDataUri === 'function' ? extractImageDataUri(img) : null) || (src.startsWith('data:') ? src : null);
        const attId = `dom_att_img_${stableHash(`${msgIdSeed || ''}|${src}|${imgIdx}`)}`;
        imgIdx++;
        attachments.push({
          id: attId,
          assetId: attId,
          name: `${alt.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24)}.${ext}`,
          filename: `${alt.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24)}.${ext}`,
          mimeType: src.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
          kind: 'image',
          sourceType: 'dom-image',
          sourceURL: src,
          url: src,
          dataURI: dataUri,
          availability: dataUri ? 'embedded' : 'referenced'
        });

        if (img.parentNode && typeof document !== 'undefined') {
          const mdImgNode = document.createTextNode('');
          img.parentNode.replaceChild(mdImgNode, img);
        }
      });
      return attachments;
    };

    // Enfoque 1 (Prioridad estructural): data-message-author-role
    const messageNodes = root.querySelectorAll('[data-message-author-role]');
    if (messageNodes && messageNodes.length > 0) {
      messageNodes.forEach((node) => {
        const rawRole = (node.getAttribute('data-message-author-role') || 'assistant').toLowerCase();
        const role = rawRole === 'user' ? 'user' : 'assistant';
        const msgId = node.getAttribute('data-message-id') || undefined;
        const textContainer = node.querySelector('.markdown') || node.querySelector('.whitespace-pre-wrap') || node;

        // Extract images from the FULL turn node so sibling <img> elements outside .markdown are never lost
        const fullTurnClone = cleanMessageDom(node.cloneNode(true));
        const attachments = extractTurnAttachments(fullTurnClone, msgId);

        const clone = cleanMessageDom((textContainer || node).cloneNode(true));
        if (clone.querySelectorAll) {
          clone.querySelectorAll('.lossy-action-wrapper, .lossy-message-action-btn, .lossy-popover-menu, .lossy-toast-notice').forEach(el => el.remove());
        }
        const codeBlocks = [];
        const preNodes = clone.querySelectorAll('pre');
        preNodes.forEach((pre) => {
          const codeElem = pre.querySelector('code');
          const code = (codeElem ? codeElem.textContent : pre.textContent || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
          const langClass = codeElem ? Array.from(codeElem.classList).find(c => c.startsWith('language-')) : null;
          const language = langClass ? langClass.replace('language-', '') : 'plaintext';

          codeBlocks.push({ language, code });

          const fence = code.includes('```') ? '````' : '```';
          const mdNode = document.createTextNode(`\n\n${fence}${language}\n${code}\n${fence}\n\n`);
          if (pre.parentNode) {
            pre.parentNode.replaceChild(mdNode, pre);
          }
        });

        let text = cleanText(messageDomText(clone));
        text = text.replace(/File\s+([a-zA-Z0-9_\-]{8,})/g, '[Archivo adjunto: $1]');

        if (text.length > 0 || attachments.length > 0) {
          turns.push({
            id: msgId,
            role,
            author: role === 'user' ? 'Usuario' : 'ChatGPT',
            text,
            codeBlocks,
            attachments
          });
        }
      });
    }

    // Enfoque 2 (Fallback estricto para DOM con encabezados sr-only): solo marcadores exactos de turno
    if (turns.length === 0) {
      const USER_MARKER_RE = /^(?:you said|tú dijiste|tu dijiste|dijiste|usuario dijo|user said)\s*:?$/i;
      const ASSISTANT_MARKER_RE = /^(?:chatgpt said|chatgpt dijo|el asistente dijo|assistant said)\s*:?$/i;
      const h4Nodes = Array.from(root.querySelectorAll('h4')).filter(h => {
        const t = (h.textContent || h.innerText || '').trim();
        return USER_MARKER_RE.test(t) || ASSISTANT_MARKER_RE.test(t);
      });

      if (h4Nodes && h4Nodes.length > 0) {
        h4Nodes.forEach((h4) => {
          const markerText = (h4.textContent || h4.innerText || '').trim();
          const isUser = USER_MARKER_RE.test(markerText);
          const role = isUser ? 'user' : 'assistant';
          const author = isUser ? 'Usuario' : 'ChatGPT';

          const container = h4.parentElement;
          if (!container) return;

          const msgId = container.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') || container.getAttribute?.('data-message-id') || undefined;
          const clone = cleanMessageDom(container.cloneNode(true));
          const h4InClone = clone.querySelector('h4');
          if (h4InClone) h4InClone.remove();
          if (clone.querySelectorAll) {
            clone.querySelectorAll('.lossy-action-wrapper, .lossy-message-action-btn, .lossy-popover-menu, .lossy-toast-notice').forEach(el => el.remove());
          }

          const codeBlocks = [];
          const preNodes = clone.querySelectorAll('pre');
          preNodes.forEach((pre) => {
            const codeElem = pre.querySelector('code');
            const code = (codeElem ? codeElem.textContent : pre.textContent || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
            const langClass = codeElem ? Array.from(codeElem.classList).find(c => c.startsWith('language-')) : null;
            const language = langClass ? langClass.replace('language-', '') : 'plaintext';

            codeBlocks.push({ language, code });

            const fence = code.includes('```') ? '````' : '```';
            const mdNode = document.createTextNode(`\n\n${fence}${language}\n${code}\n${fence}\n\n`);
            if (pre.parentNode) {
              pre.parentNode.replaceChild(mdNode, pre);
            }
          });

          const attachments = extractTurnAttachments(clone, msgId);

          let text = cleanText(messageDomText(clone));
          text = text.replace(/File\s+([a-zA-Z0-9_\-]{8,})/g, '[Archivo adjunto: $1]');

          if (text.length > 0 || attachments.length > 0) {
            turns.push({
              id: msgId,
              role,
              author,
              text,
              codeBlocks,
              attachments
            });
          }
        });
      }
    }

    // Enfoque 3 (Fallback): Artículos semánticos
    if (turns.length === 0) {
      const articles = root.querySelectorAll('article');
      articles.forEach((art) => {
        const clone = cleanMessageDom(typeof art.cloneNode === 'function' ? art.cloneNode(true) : art);
        if (clone.querySelectorAll) {
          clone.querySelectorAll('.lossy-action-wrapper, .lossy-message-action-btn, .lossy-popover-menu, .lossy-toast-notice').forEach(el => el.remove && el.remove());
        }
        const msgId = art.getAttribute?.('data-message-id') || undefined;
        const attachments = extractTurnAttachments(clone, msgId);
        const isAssistant = clone.querySelector ? clone.querySelector('.markdown') !== null : false;
        const role = isAssistant ? 'assistant' : 'user';
        const text = cleanText(messageDomText(clone));

        if (text.length > 0 || attachments.length > 0) {
          turns.push({
            id: msgId,
            role,
            author: role === 'user' ? 'Usuario' : 'ChatGPT',
            text,
            codeBlocks: [],
            attachments
          });
        }
      });
    }

    return turns;
  }

  let activeHarvestCancelled = false;
  let navigationEpoch = 0;
  let lastObservedUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
  let lastObservedConvId = null;
  let lastHarvestedConversationId = null;
  let lastHarvestedSignatures = [];

  function checkNavigationEpoch() {
    if (typeof window === 'undefined' || !window.location) return navigationEpoch;
    const currentUrl = window.location.href;
    const currentConvId = detectActiveConversationId();
    const baseCurrentUrl = currentUrl.split('?')[0].split('#')[0];
    const baseLastUrl = lastObservedUrl ? lastObservedUrl.split('?')[0].split('#')[0] : '';
    if (lastObservedConvId === null) {
      lastObservedConvId = currentConvId;
      lastObservedUrl = currentUrl;
    } else if (
      (currentConvId !== lastObservedConvId) ||
      (baseCurrentUrl !== baseLastUrl && !currentConvId)
    ) {
      navigationEpoch++;
      lastObservedUrl = currentUrl;
      lastObservedConvId = currentConvId;
      activeHarvestCancelled = true;
    }
    return navigationEpoch;
  }

  function getNavigationEpoch() {
    return navigationEpoch;
  }

  function setLastHarvestedStateForTest(convId, signatures = []) {
    lastHarvestedConversationId = convId;
    lastHarvestedSignatures = signatures;
  }

  function resetNavigationEpochForTest() {
    navigationEpoch = 0;
    lastObservedUrl = '';
    lastObservedConvId = null;
    activeHarvestCancelled = false;
    lastHarvestedConversationId = null;
    lastHarvestedSignatures = [];
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => { checkNavigationEpoch(); });
    window.addEventListener('hashchange', () => { checkNavigationEpoch(); });
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', () => { checkNavigationEpoch(); });
    }
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      try {
        const titleObserver = new MutationObserver(() => { checkNavigationEpoch(); });
        const titleEl = document.querySelector('title');
        if (titleEl) {
          titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
      } catch (_) {}
    }
  }

  /**
   * Recolector de conversación mediante barrido de scroll y alineación por solapamiento.
   * Recorre la ventana desde el inicio acumulando turnos sin riesgo de colisiones entre mensajes repetidos,
   * y restaura la posición original del usuario.
   * Incorpora telemetría causal profunda para aislar la causa raíz de RED-C1-003 en conversaciones largas.
   * Invariante Fail-Closed: Si la navegación cambia de URL o ID durante el barrido, aborta inmediatamente.
   */
  async function harvestAllConversationTurns(expectedConvId = null, startEpoch = null) {
    activeHarvestCancelled = false;
    const containerDetection = detectScrollContainer();
    const container = containerDetection.element;
    const isScrollable = container && (container.scrollHeight > container.clientHeight + 50);
    const initialScrollTop = container ? container.scrollTop : 0;
    const initialVisible = extractVisibleTurns(document);

    const startTime = Date.now();
    const diagnostics = {
      incidentId: 'RED-C1-003',
      timestamp: new Date().toISOString(),
      container: {
        matchedSelector: containerDetection.matchedSelector,
        tagName: container ? container.tagName : null,
        className: container ? (container.className || '') : null,
        id: container ? (container.id || '') : null,
        initialScrollTop,
        initialScrollHeight: container ? container.scrollHeight : 0,
        initialClientHeight: container ? container.clientHeight : 0,
        isScrollable: Boolean(isScrollable)
      },
      initialVisibleCount: initialVisible.length,
      initialHead: initialVisible[0] ? `[${initialVisible[0].role}] ${initialVisible[0].text.slice(0, 50).replace(/\s+/g, ' ')}` : null,
      initialTail: initialVisible[initialVisible.length - 1] ? `[${initialVisible[initialVisible.length - 1].role}] ${initialVisible[initialVisible.length - 1].text.slice(0, 50).replace(/\s+/g, ' ')}` : null,
      steps: [],
      terminationReason: null,
      durationMs: 0,
      finalAccumulatedCount: 0,
      firstTurnExtracted: null,
      lastTurnExtracted: null,
      restoredScrollTop: 0
    };

    function formatSnippet(turn) {
      if (!turn) return '(vacio)';
      const clean = (turn.text || '').slice(0, 45).replace(/\s+/g, ' ');
      return `[${turn.role}] ${clean}`;
    }

    function publishDiagnostics(diag) {
      if (typeof window !== 'undefined') {
        window.__LINER_HARVEST_LOG__ = diag;
      }
      try {
        if (typeof document !== 'undefined' && document.documentElement) {
          document.documentElement.dataset.linerHarvestLog = JSON.stringify(diag);
        }
      } catch (_) {}

      try {
        console.group('[AICP/Liner Telemetry] Causal Harvest Diagnostics - RED-C1-003');
        console.log('Motivo de Terminacion:', diag.terminationReason);
        console.log('Contenedor:', diag.container);
        console.log('Turnos: Acumulados=' + diag.finalAccumulatedCount + ' | Inicio=' + diag.firstTurnExtracted + ' | Fin=' + diag.lastTurnExtracted);
        console.table(diag.steps.map(s => ({
          iter: s.iteration,
          phase: s.phase,
          scrollTop: s.scrollTop,
          targetPos: s.targetPos,
          scrollHeight: s.scrollHeight,
          windowTurns: s.turnsInWindow,
          overlap: s.overlap,
          added: s.turnsAdded,
          totalAcc: s.accumulatedAfter,
          domChanged: s.domChanged,
          head: s.windowHeadSnippet,
          tail: s.windowTailSnippet
        })));
        console.groupEnd();
      } catch (_) {}
    }

    // Caso 1: Solo salir anticipadamente si el contenedor NO es desplazable (sin virtualización pendiente)
    if (!isScrollable) {
      diagnostics.terminationReason = 'EARLY_EXIT_NOT_SCROLLABLE';
      diagnostics.finalAccumulatedCount = initialVisible.length;
      diagnostics.durationMs = Date.now() - startTime;
      diagnostics.firstTurnExtracted = formatSnippet(initialVisible[0]);
      diagnostics.lastTurnExtracted = formatSnippet(initialVisible[initialVisible.length - 1]);
      diagnostics.restoredScrollTop = initialScrollTop;

      publishDiagnostics(diagnostics);

      return {
        turns: initialVisible,
        integrity: 'harvested',
        integrityNotice: null,
        diagnostics
      };
    }

    try {
      let previousSnapshotSignatures = initialVisible.map(t => `${t.role}:::${t.text}`);

      // 1. Desplazamiento inicial al techo para forzar montaje de los primeros turnos
      let stepStartTime = Date.now();
      if (container.scrollTop > 0) {
        container.scrollTop = 0;
        await waitMs(140);
      }
      let accumulated = extractVisibleTurns(document);
      const topSnapshot = accumulated;
      const topSnapshotSignatures = topSnapshot.map(t => `${t.role}:::${t.text}`);
      const topDomChanged = topSnapshotSignatures.length !== previousSnapshotSignatures.length ||
                            topSnapshotSignatures.some((sig, i) => sig !== previousSnapshotSignatures[i]);
      previousSnapshotSignatures = topSnapshotSignatures;

      diagnostics.steps.push({
        iteration: 0,
        phase: 'TOP_INIT',
        scrollTop: container.scrollTop,
        targetPos: 0,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        maxScroll: Math.max(container.scrollHeight - container.clientHeight, 0),
        turnsInWindow: topSnapshot.length,
        accumulatedBefore: 0,
        accumulatedAfter: accumulated.length,
        overlap: 0,
        turnsAdded: accumulated.length,
        windowHeadSnippet: formatSnippet(topSnapshot[0]),
        windowTailSnippet: formatSnippet(topSnapshot[topSnapshot.length - 1]),
        domChanged: topDomChanged,
        stepDurationMs: Date.now() - stepStartTime
      });

      // 2. Descenso progresivo con solapamiento abundante (50% de la altura de la ventana)
      const clientHeight = container.clientHeight || 800;
      const step = Math.max(Math.floor(clientHeight * 0.5), 300);
      let currentPos = 0;
      let sweeps = 0;
      const MAX_SWEEPS = 120; // Soporta conversaciones extensas de 100+ turnos sin truncamiento prematuro
      let consecutiveZeroNewTurns = 0;

      while (sweeps < MAX_SWEEPS) {
        stepStartTime = Date.now();
        const dynamicMaxScroll = Math.max(container.scrollHeight - clientHeight, 0);
        currentPos = Math.min(currentPos + step, dynamicMaxScroll);
        container.scrollTop = currentPos;
        await waitMs(100);

        // Verificar cancelación o navegación ANTES de leer e incorporar snapshots (evita mezcla A→inicio / A→B→A)
        if (activeHarvestCancelled) {
          break;
        }
        if (startEpoch !== null && checkNavigationEpoch() !== startEpoch) {
          diagnostics.terminationReason = 'ABORT_NAVIGATION_EPOCH_CHANGED';
          activeHarvestCancelled = true;
          break;
        }
        if (expectedConvId && detectActiveConversationId() !== expectedConvId) {
          diagnostics.terminationReason = 'ABORT_CONVERSATION_ID_CHANGED';
          activeHarvestCancelled = true;
          break;
        }

        const currentSnapshot = extractVisibleTurns(document);
        const currentSnapshotSignatures = currentSnapshot.map(t => `${t.role}:::${t.text}`);
        const domChanged = currentSnapshotSignatures.length !== previousSnapshotSignatures.length ||
                           currentSnapshotSignatures.some((sig, i) => sig !== previousSnapshotSignatures[i]);
        previousSnapshotSignatures = currentSnapshotSignatures;

        const overlap = computeOverlap(accumulated, currentSnapshot);
        const accumulatedBefore = accumulated.length;
        accumulated = alignAndAppendTurns(accumulated, currentSnapshot);
        const accumulatedAfter = accumulated.length;
        const turnsAdded = accumulatedAfter - accumulatedBefore;

        if (turnsAdded === 0 && currentPos >= dynamicMaxScroll) {
          consecutiveZeroNewTurns++;
        } else {
          consecutiveZeroNewTurns = 0;
        }

        sweeps++;

        diagnostics.steps.push({
          iteration: sweeps,
          phase: 'SWEEP',
          scrollTop: container.scrollTop,
          targetPos: currentPos,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          maxScroll: dynamicMaxScroll,
          turnsInWindow: currentSnapshot.length,
          accumulatedBefore,
          accumulatedAfter,
          overlap,
          turnsAdded,
          windowHeadSnippet: formatSnippet(currentSnapshot[0]),
          windowTailSnippet: formatSnippet(currentSnapshot[currentSnapshot.length - 1]),
          domChanged,
          stepDurationMs: Date.now() - stepStartTime
        });

        // Si se solicitó cancelación explícita o se detectó navegación entre conversaciones, salir inmediatamente
        if (activeHarvestCancelled) {
          break;
        }

        if (startEpoch !== null && checkNavigationEpoch() !== startEpoch) {
          diagnostics.terminationReason = 'ABORT_NAVIGATION_EPOCH_CHANGED';
          activeHarvestCancelled = true;
          break;
        }

        if (expectedConvId && detectActiveConversationId() !== expectedConvId) {
          diagnostics.terminationReason = 'ABORT_CONVERSATION_ID_CHANGED';
          activeHarvestCancelled = true;
          break;
        }

        // Si alcanzamos el final del scroll dinámico y no hay más turnos tras 2 comprobaciones, finalizar
        if (currentPos >= dynamicMaxScroll && consecutiveZeroNewTurns >= 2) {
          break;
        }
      }

      // Evaluar condicion exacta de finalizacion del barrido
      const finalMaxScroll = Math.max(container.scrollHeight - clientHeight, 0);
      let detectedIntegrity = 'harvested';
      let integrityNotice = null;
      let aborted = false;

      if (diagnostics.terminationReason === 'ABORT_NAVIGATION_EPOCH_CHANGED' || diagnostics.terminationReason === 'ABORT_CONVERSATION_ID_CHANGED') {
        detectedIntegrity = 'aborted';
        integrityNotice = 'Captura abortada por cambio de conversación durante el barrido DOM.';
        aborted = true;
      } else if (activeHarvestCancelled) {
        diagnostics.terminationReason = 'CANCELLED_BY_USER';
        detectedIntegrity = 'partial';
        integrityNotice = 'Captura cancelada por el usuario (se preservaron los turnos acumulados hasta la interrupción).';
      } else if (sweeps >= MAX_SWEEPS) {
        diagnostics.terminationReason = `LOOP_LIMIT_EXCEEDED_${MAX_SWEEPS}_SWEEPS`;
        detectedIntegrity = 'partial';
        integrityNotice = 'Captura posiblemente parcial: la conversación superó el límite de barrido de 120 ventanas.';
      } else if (currentPos >= finalMaxScroll) {
        diagnostics.terminationReason = `MAX_SCROLL_REACHED (currentPos=${currentPos} >= dynamicMaxScroll=${finalMaxScroll})`;
      } else {
        diagnostics.terminationReason = 'LOOP_CONDITION_FALSE';
      }

      // 3. Restaurar posición original del usuario
      container.scrollTop = initialScrollTop;

      diagnostics.durationMs = Date.now() - startTime;
      diagnostics.finalAccumulatedCount = accumulated.length;
      diagnostics.firstTurnExtracted = formatSnippet(accumulated[0]);
      diagnostics.lastTurnExtracted = formatSnippet(accumulated[accumulated.length - 1]);
      diagnostics.restoredScrollTop = container ? container.scrollTop : 0;

      publishDiagnostics(diagnostics);

      return {
        turns: aborted ? [] : accumulated,
        integrity: detectedIntegrity,
        integrityNotice,
        diagnostics,
        aborted: Boolean(aborted)
      };
    } catch (err) {
      if (container) container.scrollTop = initialScrollTop;

      diagnostics.terminationReason = `EXCEPTION: ${err.message}`;
      diagnostics.durationMs = Date.now() - startTime;
      diagnostics.finalAccumulatedCount = initialVisible.length;
      diagnostics.restoredScrollTop = container ? container.scrollTop : 0;

      publishDiagnostics(diagnostics);

      return {
        turns: initialVisible,
        integrity: 'partial',
        integrityNotice: 'Captura parcial: los turnos anteriores no pudieron ser materializados en el DOM.',
        diagnostics
      };
    }
  }

  /**
   * Obtiene token de sesión efímero en memoria desde ChatGPT.
   */
  let ephemeralSessionToken = null;
  let ephemeralTokenExpiry = 0;

  async function getEphemeralSessionToken() {
    if (ephemeralSessionToken && Date.now() < ephemeralTokenExpiry) {
      return ephemeralSessionToken;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        signal: controller?.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} al verificar sesión`);
      const data = await res.json();
      if (!data || !data.accessToken) throw new Error('Sesión de ChatGPT no autenticada');
      ephemeralSessionToken = data.accessToken;
      ephemeralTokenExpiry = Date.now() + 10 * 60 * 1000;
      return ephemeralSessionToken;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Extrae identificador de conversación de la URL activa.
   */
  function detectActiveConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Extrae la conversación canónica actual evaluando integridad y metadatos reales.
   * Jerarquía Híbrida: Preferencia 1 Estructurada -> Preferencia 2 Recolección DOM por Scroll.
   * INVARIANTE DE IDENTIDAD DE FUENTE: Prohibido atribuir DOM de chat A a la identidad de chat B.
   */
  function parseChatGPTConversationTreeDirect(rawJson, options = {}) {
    if (typeof Liner !== 'undefined' && typeof Liner.parseChatGPTConversationTree === 'function') {
      return Liner.parseChatGPTConversationTree(rawJson, options);
    }
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error('El objeto de conversación no es válido');
    }

    const title = (rawJson.title || options.title || 'Conversación ChatGPT').trim();
    const conversationId = rawJson.id || rawJson.conversation_id || options.conversationId || null;
    const mapping = rawJson.mapping || {};
    const currentNode = rawJson.current_node;

    const activePath = [];
    let curr = currentNode;
    const visited = new Set();
    while (curr && mapping[curr] && !visited.has(curr)) {
      visited.add(curr);
      activePath.push(mapping[curr]);
      curr = mapping[curr].parent;
    }
    activePath.reverse();

    const nodesToProcess = activePath.length > 0
      ? activePath
      : Object.values(mapping).sort((a, b) => {
          const tA = (a.message && a.message.create_time) ? a.message.create_time : 0;
          const tB = (b.message && b.message.create_time) ? b.message.create_time : 0;
          return tA - tB;
        });

    let observedModel = null;
    const messages = [];
    const now = new Date().toISOString();
    let turnIndex = 0;

    for (const node of nodesToProcess) {
      const msg = node.message;
      if (!msg) continue;

      const rawRole = (msg.author && msg.author.role) ? msg.author.role.toLowerCase() : 'user';
      let role = 'user';
      if (rawRole === 'assistant') role = 'assistant';
      else if (rawRole === 'system') role = 'system';
      else if (rawRole === 'tool') role = 'tool';

      let textContent = '';
      const content = msg.content || {};
      if (Array.isArray(content.parts)) {
        textContent = content.parts
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
              if (part.text) return part.text;
              if (part.content_type === 'image_asset_pointer') return '';
              return ''; // Non-text parts stay in typed attachments, never in the transcript.
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (typeof content.text === 'string') {
        textContent = content.text;
      }

      if (role === 'system' && !textContent.trim()) continue;

      if (role === 'assistant' && msg.metadata && msg.metadata.model_slug) {
        observedModel = msg.metadata.model_slug;
      }

      const createTime = msg.create_time ? new Date(msg.create_time * 1000).toISOString() : now;
      const codeBlocks = [];
      const codeRegex = /```([a-zA-Z0-9_\-+.]*)\n([\s\S]*?)```/g;
      let match;
      while ((match = codeRegex.exec(textContent)) !== null) {
        codeBlocks.push({
          language: match[1] || 'plaintext',
          code: match[2].trim()
        });
      }

      const msgAttachments = [];
      if (Array.isArray(content.parts)) {
        content.parts.forEach((part, pIdx) => {
          if (part && typeof part === 'object' && (part.content_type === 'image_asset_pointer' || part.asset_pointer)) {
            const ptr = part.asset_pointer || part.id || `img_ptr_${turnIndex}_${pIdx}`;
            msgAttachments.push({
              id: `att_ptr_${turnIndex}_${pIdx}`,
              assetId: `att_ptr_${turnIndex}_${pIdx}`,
              name: `chatgpt_asset_${ptr.substring(0, 16)}.png`,
              filename: `chatgpt_asset_${ptr.substring(0, 16)}.png`,
              mimeType: 'image/png',
              sizeBytes: typeof part.size_bytes === 'number' ? part.size_bytes : null,
              size: typeof part.size_bytes === 'number' ? part.size_bytes : null,
              kind: 'image',
              sourceType: 'image_asset_pointer',
              assetPointer: ptr,
              fileId: ptr.replace(/^(?:sediment|file-service):\/\//, ''),
              width: typeof part.width === 'number' ? part.width : null,
              height: typeof part.height === 'number' ? part.height : null,
              sourceRelationship: 'generated',
              downloadable: false,
              availability: 'referenced',
              sourceURL: null,
              url: null,
              dataURI: null,
              checksumSha256: null
            });
          }
        });
      }
      if (msg.metadata && Array.isArray(msg.metadata.attachments)) {
        msg.metadata.attachments.forEach((att, aIdx) => {
          const kind = att.mime_type && att.mime_type.startsWith('image/') ? 'image' : 'file';
          const downloadUrl = att.download_url || att.url || null;
          msgAttachments.push({
            id: att.id || att.file_id || `att_${turnIndex}_${aIdx}`,
            assetId: att.id || att.file_id || `att_${turnIndex}_${aIdx}`,
            name: att.name || (kind === 'image' ? `image_${turnIndex}_${aIdx}.png` : 'archivo_adjunto'),
            filename: att.name || (kind === 'image' ? `image_${turnIndex}_${aIdx}.png` : 'archivo_adjunto'),
            mimeType: att.mime_type || (kind === 'image' ? 'image/png' : 'application/octet-stream'),
            sizeBytes: typeof att.size === 'number' ? att.size : null,
            size: typeof att.size === 'number' ? att.size : null,
            kind,
            sourceType: 'attachment',
            sourceRelationship: 'uploaded',
            sourceURL: downloadUrl,
            url: downloadUrl,
            downloadable: Boolean(downloadUrl),
            availability: downloadUrl ? 'referenced' : 'unavailable',
            dataURI: null,
            checksumSha256: null
          });
        });
      }

      messages.push({
        id: msg.id || node.id || `msg_${turnIndex + 1}_${Date.now()}`,
        role,
        author: role === 'user' ? 'Usuario' : (role === 'assistant' ? 'ChatGPT' : role),
        timestamp: createTime,
        createdAt: createTime,
        model: role === 'assistant' ? (msg.metadata?.model_slug || observedModel) : null,
        sourceOrdinal: turnIndex,
        content: {
          text: textContent,
          codeBlocks,
          citations: [],
          attachments: msgAttachments
        },
        attachments: msgAttachments,
        references: [],
        metadata: {
          turnIndex,
          nodeId: node.id,
          originalPlatform: 'chatgpt'
        },
        provenance: {
          originalPlatform: 'chatgpt',
          nodeId: node.id
        }
      });
      turnIndex++;
    }

    const canonicalId = `conv_chatgpt_${conversationId || Date.now()}`;
    const convCreatedAt = rawJson.create_time ? new Date(rawJson.create_time * 1000).toISOString() : now;
    const convUpdatedAt = rawJson.update_time ? new Date(rawJson.update_time * 1000).toISOString() : convCreatedAt;

    const conversationalMsgs = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && Boolean(m.content?.text && m.content.text.trim()));
    const conversationMessageCount = conversationalMsgs.length;
    const visibleMessageCount = conversationMessageCount;
    const sourceNodeCount = (rawJson.mapping && Object.keys(rawJson.mapping).length) || messages.length;

    const nodeMetrics = {
      sourceNodeCount,
      conversationMessageCount,
      visibleMessageCount,
      userMessageCount: messages.filter(m => m.role === 'user').length,
      userNodes: messages.filter(m => m.role === 'user').length,
      assistantMessageCount: messages.filter(m => m.role === 'assistant' && (m.content?.text && m.content.text.trim())).length,
      assistantNodes: messages.filter(m => m.role === 'assistant').length,
      toolEventCount: messages.filter(m => m.role === 'tool').length,
      toolNodes: messages.filter(m => m.role === 'tool').length,
      systemNodeCount: messages.filter(m => m.role === 'system').length,
      systemNodes: messages.filter(m => m.role === 'system').length,
      otherNodeCount: messages.filter(m => !['user', 'assistant', 'tool', 'system'].includes(m.role)).length,
      otherNodes: messages.filter(m => !['user', 'assistant', 'tool', 'system'].includes(m.role)).length
    };

    return {
      $schema: 'https://aicp.dev/v1.3/canonical-context.schema.json',
      specVersion: '1.0.0',
      canonicalVersion: '1.3.0',
      canonicalId,
      source: {
        platform: 'chatgpt',
        conversationId,
        url: conversationId ? `https://chatgpt.com/c/${conversationId}` : (typeof window !== 'undefined' && window.location ? window.location.href : 'https://chatgpt.com'),
        workspace: null,
        project: null,
        acquisitionMethod: 'structured-session'
      },
      title,
      createdAt: convCreatedAt,
      updatedAt: convUpdatedAt,
      model: observedModel,
      conversationMessageCount,
      visibleMessageCount,
      sourceNodeCount,
      nodeMetrics,
      messages,
      branches: null,
      attachments: messages.flatMap(m => m.attachments || []),
      references: [],
      integrity: {
        status: 'captured',
        acquisitionMethod: 'structured-session',
        messageCount: conversationMessageCount,
        conversationMessageCount,
        visibleMessageCount,
        sourceNodeCount,
        nodeMetrics,
        warnings: [],
        missingItems: [],
        browserVerified: true
      },
      capabilities: {
        structuredMapping: 'available',
        domFallback: 'available',
        modelSlug: observedModel ? 'available' : 'unavailable'
      },
      provenance: {
        generator: 'Liner Context Portability Layer (Clean-Room / 100% Local)',
        version: '1.3.0',
        capturedAt: now,
        transformations: ['structured-dag-normalization-v1.3'],
        license: 'Apache-2.0'
      },
      metadata: {
        id: canonicalId,
        title,
        platform: 'chatgpt',
        model: observedModel,
        integrity: 'captured',
        url: conversationId ? `https://chatgpt.com/c/${conversationId}` : '',
        exportedAt: now,
        totalMessages: messages.length,
        provenance: {
          generator: 'Liner Chrome Extension (Clean-Room / 100% Local)',
          license: 'Apache-2.0'
        }
      },
      projectContext: {
        instructions: '',
        customInstructions: null
      }
    };
  }

  function getChatGPTAssets() {
    return globalThis.Lossy?.ChatGPTAssets || globalThis.Liner?.ChatGPTAssets || (typeof require === 'function' ? require('../platforms/chatgpt/chatgpt_assets.js') : undefined);
  }
  const activeAssetControllers = new Set();
  let cancellationEpoch=0;
  async function resolveCapturedAssets(conv, options = {}) {
    const assets = getChatGPTAssets();
    if (!assets) throw new Error('Recarga la pestaña para activar la resolución de imágenes');
    const capturedEpoch=cancellationEpoch;
    const enriched = await enrichConversationWithLiveDomAssets(conv);
    if(capturedEpoch!==cancellationEpoch)throw new Error('Captura cancelada');
    const controller=new AbortController();activeAssetControllers.add(controller);
    try {
      const resolved=await assets.resolveConversationAssets(enriched, {...options, signal:controller.signal, getToken:getEphemeralSessionToken});
      if(controller.signal.aborted)throw new Error('Captura cancelada');
      return resolved;
    }
    finally {activeAssetControllers.delete(controller);}
  }

  async function extractCurrentChatGPTConversation(targetConversationId = null, options = {}) {
    const captureCancellationEpoch=cancellationEpoch;
    const assertCaptureCurrent=()=>{
      if(captureCancellationEpoch!==cancellationEpoch)throw new Error('Captura cancelada');
      if(!options.structuredOnly && checkNavigationEpoch()!==startEpoch)throw new Error('NAVIGATION_ABORT: La conversación cambió durante la captura');
    };
    const startEpoch = checkNavigationEpoch();
    const activeConvId = detectActiveConversationId();
    const convId = targetConversationId || activeConvId;
    const titleElem = document.querySelector('title');
    const title = titleElem ? titleElem.textContent.replace(' - ChatGPT', '').trim() : 'Conversación ChatGPT';
    const url = window.location.href;
    const now = new Date().toISOString();

    // 1. Preferencia A: Intento de Adquisición Estructurada
    if (convId) {
      try {
        const token = await getEphemeralSessionToken();
        assertCaptureCurrent();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
        if(controller)activeAssetControllers.add(controller);
        let rawTree = null;
        try {
          const res = await fetch(`/backend-api/conversation/${convId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            },
            signal: controller?.signal
          });
          assertCaptureCurrent();
          if (res.ok) {
            rawTree = await new Promise((resolve, reject) => {
              const onAbort = () => reject(new Error('Captura cancelada'));
              if (controller?.signal?.aborted) return onAbort();
              controller?.signal?.addEventListener('abort', onAbort, { once: true });
              res.json().then(
                data => { controller?.signal?.removeEventListener('abort', onAbort); resolve(data); },
                err => { controller?.signal?.removeEventListener('abort', onAbort); reject(err); }
              );
            });
          }
        } finally {
          if (timer) clearTimeout(timer);
          if(controller)activeAssetControllers.delete(controller);
        }
        assertCaptureCurrent();

        if (rawTree) {
          let parsed = parseChatGPTConversationTreeDirect(rawTree, { conversationId: convId, title: rawTree.title || title });
          if (parsed && parsed.source && parsed.source.conversationId === convId) {
            parsed = await resolveCapturedAssets(parsed, options);
            assertCaptureCurrent();
            lastHarvestedConversationId = convId;
            lastHarvestedSignatures = (parsed.messages || []).map(m => `${m.role}:::${(m.content?.text || '').slice(0, 100)}`);
            return parsed;
          }
        }
      } catch (error) {
        assertCaptureCurrent();
        if(error.message==='Captura cancelada')throw error;
        // Fallback transparente a DOM sin romper el flujo
      }
    }

    // Modo estructurado estricto (ej. desde Workspace cuando la pestaña no coincide)
    if (options && options.structuredOnly) {
      throw new Error(`STRUCTURED_ACQUISITION_UNAVAILABLE: No se pudo obtener la conversación ${convId} por vía estructurada.`);
    }

    // SOURCE IDENTITY INVARIANT: Si la conversación solicitada difiere de la activa en DOM, RECHAZAR
    if (targetConversationId && activeConvId && activeConvId !== targetConversationId) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: La conversación activa en pantalla (${activeConvId}) no coincide con la solicitada (${targetConversationId}). Se rechaza la captura por salvaguarda de atribución.`);
    }

    // Comprobación anti-stale DOM: si se solicita un chat distinto al último cosechado pero el DOM aún exhibe turnos del chat previo:
    if (convId && lastHarvestedConversationId && lastHarvestedConversationId !== convId && lastHarvestedSignatures.length > 0) {
      const currentSnapshot = extractVisibleTurns(document);
      const currentSigs = currentSnapshot.map(t => `${t.role}:::${(t.text || '').slice(0, 100)}`);
      const hasLingeringPreviousTurns = currentSigs.length > 0 && (
        (currentSigs.length === lastHarvestedSignatures.length && currentSigs.every((sig, idx) => sig === lastHarvestedSignatures[idx])) ||
        currentSigs.some(sig => lastHarvestedSignatures.includes(sig))
      );
      if (hasLingeringPreviousTurns) {
        throw new Error(`SOURCE_IDENTITY_STALE_DOM: El contenido del DOM aún corresponde a la conversación previa (${lastHarvestedConversationId}). La navegación SPA no ha convergido.`);
      }
    }

    // 2. Preferencia B: Adquisición por barrido DOM con solapamiento
    const { turns, integrity, integrityNotice, diagnostics, aborted } = await harvestAllConversationTurns(convId, startEpoch);
    if (aborted) {
      throw new Error('NAVIGATION_ABORT: Se detectó navegación entre conversaciones durante el barrido DOM.');
    }

    // Verificación posterior al barrido: cualquier navegación (incluyendo A→inicio o A→B→A) descarta el resultado
    assertCaptureCurrent();
    const postHarvestConvId = detectActiveConversationId();
    if (convId && postHarvestConvId !== convId) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: La conversación cambió durante la recolección DOM (de ${convId} a ${postHarvestConvId || 'inicio'}). Resultado descartado.`);
    }

    lastHarvestedConversationId = convId;
    lastHarvestedSignatures = turns.map(t => `${t.role}:::${(t.text || '').slice(0, 100)}`);

    const model = detectModelFromDom();

    const messages = turns.map((t, idx) => {
      const msgAttachments = Array.isArray(t.attachments) ? t.attachments.map((att, aIdx) => {
        if (typeof createCanonicalAsset === 'function') {
          return createCanonicalAsset({
            ...att,
            sourceMessageId: t.id || `msg_${idx + 1}_${now}`,
            messageIndex: idx
          });
        }
        return {
          id: att.id || `att_${idx}_${aIdx}`,
          assetId: att.assetId || att.id || `att_${idx}_${aIdx}`,
          name: att.name || `attachment_${aIdx}`,
          filename: att.filename || att.name || `attachment_${aIdx}`,
          kind: att.kind || 'image',
          mimeType: att.mimeType || 'image/jpeg',
          sourceType: att.sourceType || 'chatgpt-dom',
          url: att.url || null,
          sourceURL: att.sourceURL || att.url || null,
          dataURI: att.dataURI || null,
          availability: (att.dataURI || att.availability === 'embedded') ? 'embedded' : (att.url ? 'referenced' : 'unavailable'),
          sourceMessageId: t.id || `msg_${idx + 1}_${now}`,
          messageIndex: idx
        };
      }) : [];

      return {
        id: t.id || `msg_${idx + 1}_${now}`,
        role: t.role,
        author: t.author,
        timestamp: now,
        createdAt: now,
        model: t.role === 'assistant' ? model : null,
        sourceOrdinal: idx,
        content: {
          text: t.text,
          codeBlocks: t.codeBlocks,
          citations: [],
          attachments: msgAttachments
        },
        attachments: msgAttachments,
        references: [],
        metadata: {
          turnIndex: idx,
          originalPlatform: 'chatgpt'
        },
        provenance: {
          originalPlatform: 'chatgpt',
          turnIndex: idx
        }
      };
    });

    const canonicalId = `conv_chatgpt_${convId || Date.now()}`;
    const status = integrity === 'partial' ? 'partial' : 'captured';

    const conversationalMsgs = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && Boolean(m.content?.text && m.content.text.trim()));
    const conversationMessageCount = conversationalMsgs.length;
    const visibleMessageCount = conversationMessageCount;
    const sourceNodeCount = messages.length;

    const nodeMetrics = {
      sourceNodeCount,
      conversationMessageCount,
      visibleMessageCount,
      userMessageCount: messages.filter(m => m.role === 'user').length,
      userNodes: messages.filter(m => m.role === 'user').length,
      assistantMessageCount: messages.filter(m => m.role === 'assistant').length,
      assistantNodes: messages.filter(m => m.role === 'assistant').length,
      toolEventCount: 0,
      toolNodes: 0,
      systemNodeCount: 0,
      systemNodes: 0,
      otherNodeCount: 0,
      otherNodes: 0
    };

    const convResult = {
      $schema: 'https://aicp.dev/v1.3/canonical-context.schema.json',
      specVersion: '1.0.0',
      canonicalVersion: '1.3.0',
      canonicalId,
      source: {
        platform: 'chatgpt',
        conversationId: convId,
        url,
        workspace: null,
        project: null,
        acquisitionMethod: 'dom-harvest'
      },
      title,
      createdAt: now,
      updatedAt: now,
      model,
      conversationMessageCount,
      visibleMessageCount,
      sourceNodeCount,
      nodeMetrics,
      messages,
      branches: null,
      attachments: messages.flatMap(m => m.attachments || []),
      references: [],
      integrity: {
        status,
        acquisitionMethod: 'dom-harvest',
        messageCount: conversationMessageCount,
        conversationMessageCount,
        visibleMessageCount,
        sourceNodeCount,
        nodeMetrics,
        warnings: integrityNotice ? [integrityNotice] : [],
        missingItems: [],
        browserVerified: true
      },
      capabilities: {
        structuredMapping: 'unavailable',
        domFallback: 'available',
        modelSlug: model ? 'available' : 'unavailable'
      },
      provenance: {
        generator: 'Liner Context Portability Layer (Clean-Room / 100% Local)',
        version: '1.3.0',
        capturedAt: now,
        transformations: ['dom-harvest-normalization-v1.3'],
        license: 'Apache-2.0'
      },
      metadata: {
        id: canonicalId,
        title,
        platform: 'chatgpt',
        model,
        integrity,
        ...(integrityNotice ? { integrityNotice } : {}),
        url,
        exportedAt: now,
        totalMessages: messages.length,
        provenance: {
          generator: 'Liner Chrome Extension (Clean-Room / 100% Local)',
          license: 'Apache-2.0'
        },
        harvestDiagnostics: diagnostics || null
      },
      projectContext: {
        instructions: '',
        customInstructions: null
      }
    };

    const resolvedDomResult = await resolveCapturedAssets(convResult, options);
    assertCaptureCurrent();
    const finalConvId = detectActiveConversationId();
    if (convId && finalConvId !== convId) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: La conversación cambió durante la resolución de recursos (de ${convId} a ${finalConvId || 'inicio'}). Resultado descartado.`);
    }
    return resolvedDomResult;
  }

  // Responder a peticiones del Popup y Workspace con gestión estricta de ciclo de vida
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (chrome.runtime?.id && (!sender || sender.id !== chrome.runtime.id)) return false;
      if (!request || typeof request !== 'object') return false;
      const action = request.action;

      if (action === 'RESOLVE_CONVERSATION_ASSETS') {
      const conv = request.conversation;
      if (!conv?.source?.conversationId || conv.source.conversationId !== request.conversationId) {
        sendResponse({success:false,error:'Identidad de conversación no válida'});
        return false;
      }
      resolveCapturedAssets(conv).then(data => sendResponse({success:true,data})).catch(error => sendResponse({success:false,error:error.message}));
      return true;
    }
      if (action === 'EXTRACT_CONVERSATION' || action === 'ACQUIRE_CONVERSATION') {
        extractCurrentChatGPTConversation(request.conversationId)
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Conserva el canal de mensajería abierto para resolución asíncrona
      }

      if (action === 'ACQUIRE_STRUCTURED_ONLY') {
        extractCurrentChatGPTConversation(request.conversationId, { structuredOnly: true })
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Conserva el canal de mensajería abierto para resolución asíncrona
      }

      if (action === 'LIST_CONVERSATIONS') {
        getEphemeralSessionToken()
          .then(token => {
            const offset = request.offset || 0;
            const limit = request.limit || 28;
            return fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
              }
            });
          })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Conserva el canal de mensajería abierto para resolución asíncrona
      }

      if (action === 'DETECT_CAPABILITIES') {
        getEphemeralSessionToken()
          .then(() => {
            sendResponse({
              success: true,
              capabilities: {
                structuredSession: 'available',
                conversationList: 'available',
                domFallback: 'available',
                branches: 'available',
                attachments: 'available'
              }
            });
          })
          .catch(() => {
            sendResponse({
              success: true,
              capabilities: {
                structuredSession: 'unavailable',
                conversationList: 'unavailable',
                domFallback: 'available',
                branches: 'unknown',
                attachments: 'unknown'
              }
            });
          });
        return true; // Conserva el canal de mensajería abierto para resolución asíncrona
      }

      if (action === 'CANCEL_ACQUISITION') {
        cancellationEpoch++;
        activeAssetControllers.forEach(controller=>controller.abort());
        activeHarvestCancelled = true;
        sendResponse({ success: true, cancelled: true });
        return false;
      }

      if (action === 'GET_PAGE_STATUS') {
        checkNavigationEpoch();
        const convId = detectActiveConversationId();
        const model = detectModelFromDom();
        const titleElem = document.querySelector('title');
        const title = titleElem ? titleElem.textContent.replace(' - ChatGPT', '').trim() : 'Conversación ChatGPT';
        const visibleTurns = extractVisibleTurns(document);
        sendResponse({
          success: true,
          status: {
            conversationId: convId,
            title,
            model,
            visibleTurnsCount: visibleTurns.length,
            url: window.location.href,
            epoch: navigationEpoch
          }
        });
        return false;
      }

      // Prohibido retornar true si el mensaje no es manejado
      return false;
    });
  }

  // =========================================================================
  // Lossy Inline Message Actions Adapter (v1.5)
  // =========================================================================
  const ChatGPTMessageActionsAdapter = {
    observer: null,
    injectedStyleId: 'lossy-message-action-styles',

    injectStyles(doc = (typeof document !== 'undefined' ? document : null)) {
      if (!doc || !doc.head || doc.getElementById(this.injectedStyleId)) return;
      const style = doc.createElement('style');
      style.id = this.injectedStyleId;
      style.textContent = `
        .lossy-action-wrapper {
          display: inline-flex;
          align-items: center;
          position: relative;
          margin-left: 4px;
        }
        .lossy-message-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 6px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 4px;
          color: inherit;
          opacity: 0.65;
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          transition: all 0.15s ease;
        }
        .lossy-message-action-btn:hover {
          opacity: 1;
          background: rgba(128, 128, 128, 0.15);
          border-color: rgba(128, 128, 128, 0.25);
        }
        .lossy-message-action-btn.active {
          opacity: 1;
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.4);
        }
        .lossy-popover-menu {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 6px;
          min-width: 190px;
          background: #18181b;
          color: #f4f4f5;
          border: 1px solid #3f3f46;
          border-radius: 8px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
          padding: 4px;
          z-index: 10000;
          font-size: 12px;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .lossy-popover-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.12s;
          user-select: none;
        }
        .lossy-popover-item:hover {
          background: #27272a;
          color: #ffffff;
        }
        .lossy-popover-divider {
          height: 1px;
          background: #27272a;
          margin: 4px 0;
        }
        .lossy-popover-submenu {
          position: absolute;
          left: 100%;
          bottom: 0;
          margin-left: 4px;
          min-width: 150px;
          background: #18181b;
          color: #f4f4f5;
          border: 1px solid #3f3f46;
          border-radius: 8px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
          padding: 4px;
          display: none;
        }
        .lossy-popover-item-parent:hover .lossy-popover-submenu {
          display: block;
        }
        .lossy-toast-notice {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: #10b981;
          color: #ffffff;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          z-index: 100000;
        }
      `;
      doc.head.appendChild(style);
    },

    extractTurnData(container, turnIndex = 0) {
      const role = container.getAttribute('data-message-author-role') ||
        (container.querySelector?.('[data-message-author-role="user"]') ? 'user' :
        (container.querySelector?.('[data-message-author-role="assistant"]') ? 'assistant' : 'assistant'));
      
      const textElem = container.querySelector?.('.markdown, [data-message-id], .whitespace-pre-wrap') || container;
      const clone = cleanMessageDom(textElem.cloneNode ? textElem.cloneNode(true) : textElem);
      if (clone.querySelectorAll) {
        const lossyElements = clone.querySelectorAll('.lossy-action-wrapper, .lossy-message-action-btn, .lossy-popover-menu');
        lossyElements.forEach(el => el.remove && el.remove());
      }
      
      const text = cleanText(messageDomText(clone));
      const codeBlocks = [];
      if (clone.querySelectorAll) {
        const codeElements = clone.querySelectorAll('pre code');
        codeElements.forEach((c) => {
          const langMatch = (c.className || '').match(/language-(\w+)/);
          codeBlocks.push({
            language: langMatch ? langMatch[1] : '',
            code: c.textContent || ''
          });
        });
      }

      const attachments = [];
      if (clone.querySelectorAll) {
        const imgs = clone.querySelectorAll('img');
        imgs.forEach((img, i) => {
          const src = img.getAttribute('src');
          if (isContentImage(img)) {
            attachments.push({
              id: `att_${turnIndex}_${i}`,
              name: img.getAttribute('alt') || `img_${i + 1}`,
              kind: 'image',
              mimeType: src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
              sourceType: 'chatgpt-dom',
              url: src,
              sourceURL: src,
              dataURI: extractImageDataUri(img),
              availability: src.startsWith('data:') ? 'embedded' : 'referenced'
            });
          }
        });
      }

      return {
        role,
        text,
        codeBlocks,
        attachments,
        turnIndex
      };
    },

    createClipObject(turnData, convMeta = {}) {
      const convId = convMeta.conversationId || detectActiveConversationId() || 'conv_active';
      const convTitle = convMeta.title || (typeof document !== 'undefined' ? (document.querySelector('title')?.textContent.replace(' - ChatGPT', '').trim() || 'ChatGPT') : 'ChatGPT');
      const now = new Date().toISOString();
      const clipId = `clip_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      const canonicalMsg = {
        id: `msg_clip_${Date.now()}`,
        role: turnData.role || 'user',
        author: turnData.role === 'user' ? 'Usuario' : 'ChatGPT',
        createdAt: now,
        timestamp: now,
        sourceOrdinal: turnData.turnIndex || 0,
        content: {
          text: turnData.text || '',
          codeBlocks: turnData.codeBlocks || [],
          citations: [],
          attachments: turnData.attachments || []
        },
        attachments: turnData.attachments || [],
        metadata: {
          turnIndex: turnData.turnIndex || 0,
          originalPlatform: 'chatgpt'
        }
      };

      return {
        clipId,
        id: clipId,
        canonicalId: clipId,
        entityType: 'clip',
        title: (turnData.text || 'Mensaje de conversación').slice(0, 48).trim() + ((turnData.text || '').length > 48 ? '...' : ''),
        type: 'single-message',
        selectionMode: 'single-message',
        sourceConversationId: convId,
        sourceConversationTitle: convTitle,
        sourceConversationUrl: typeof window !== 'undefined' && window.location ? window.location.href : '',
        sourcePlatform: 'chatgpt',
        sourceModel: convMeta.model || (typeof document !== 'undefined' && document && typeof detectModelFromDom === 'function' ? detectModelFromDom() : null),
        createdAt: now,
        updatedAt: now,
        range: {
          startMessageIndex: turnData.turnIndex || 0,
          endMessageIndex: turnData.turnIndex || 0,
          messageCount: 1
        },
        messages: [canonicalMsg],
        selectedMessages: [canonicalMsg],
        attachments: turnData.attachments || [],
        messageCount: 1,
        visibleMessageCount: 1,
        sourceNodeCount: 1,
        provenance: {
          capturedAt: now,
          generator: 'Lossy Context Portability Layer',
          version: '1.5.0-CANDIDATE'
        }
      };
    },

    async saveClip(clip) {
      if(typeof chrome==='undefined' || !chrome.runtime?.sendMessage)throw new Error('Conexión con Lossy no disponible. Recarga la pestaña.');
      return new Promise((resolve,reject)=>chrome.runtime.sendMessage({action:'SAVE_CLIP',clip},response=>{
        const error=chrome.runtime.lastError;
        if(error || !response?.success)reject(new Error(response?.error || 'No se pudo guardar el clip'));
        else resolve(response);
      }));
    },

    downloadText(filename, content, mime = 'text/plain') {
      if (typeof document === 'undefined') return;
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    },

    downloadBinary(filename, uint8Bytes, mime = 'application/octet-stream') {
      if (typeof document === 'undefined') return;
      const blob = new Blob([uint8Bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    },

    showToast(message, doc = (typeof document !== 'undefined' ? document : null)) {
      if (!doc || !doc.body) return;
      const existing = doc.querySelector('.lossy-toast-notice');
      if (existing) existing.remove();
      const toast = doc.createElement('div');
      toast.className = 'lossy-toast-notice';
      toast.textContent = typeof LossyI18n !== 'undefined' ? LossyI18n.translateText(message) : message;
      doc.body.appendChild(toast);
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 3000);
    },

    mount(rootDoc = (typeof document !== 'undefined' ? document : null)) {
      if (!rootDoc || !rootDoc.querySelectorAll) return;
      this.injectStyles(rootDoc);

      const roleContainers=rootDoc.querySelectorAll('[data-message-author-role]');
      const messageContainers=roleContainers.length ? roleContainers : rootDoc.querySelectorAll('article, [data-testid^="conversation-turn-"]');

      messageContainers.forEach((container, idx) => {
        if (container.getAttribute('data-lossy-mounted') === 'true') return;
        container.setAttribute('data-lossy-mounted', 'true');

        let actionBar = container.querySelector('.items-center.gap-1, .flex.justify-end, .text-gray-400.flex');
        if (!actionBar) {
          actionBar = container.querySelector('div:last-child');
        }

        const wrapper = rootDoc.createElement('div');
        wrapper.className = 'lossy-action-wrapper';

        const btn = rootDoc.createElement('button');
        btn.type = 'button';
        btn.className = 'lossy-message-action-btn';
        btn.title = 'Lossy: Acciones de contexto';
        btn.setAttribute('aria-label', 'Acciones de contexto Lossy');
        btn.innerHTML = `
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2.5"/>
            <path d="M5 8h6M5 11h4M5 5h3"/>
          </svg>
          <span>Lossy</span>
        `;

        if (typeof LossyI18n !== 'undefined') LossyI18n.translateNode(btn);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePopover(wrapper, container, idx, rootDoc);
        });

        wrapper.appendChild(btn);

        if (actionBar && actionBar !== container) {
          actionBar.appendChild(wrapper);
        } else {
          container.appendChild(wrapper);
        }
      });
    },

    togglePopover(wrapper, container, turnIndex, doc = (typeof document !== 'undefined' ? document : null)) {
      if (!doc) return;
      const existing = wrapper.querySelector('.lossy-popover-menu');
      if (existing) {
        existing.remove();
        wrapper.querySelector('.lossy-message-action-btn')?.classList.remove('active');
        return;
      }

      doc.querySelectorAll('.lossy-popover-menu').forEach(el => el.remove());
      doc.querySelectorAll('.lossy-message-action-btn').forEach(el => el.classList.remove('active'));

      wrapper.querySelector('.lossy-message-action-btn')?.classList.add('active');

      const popover = doc.createElement('div');
      popover.className = 'lossy-popover-menu';
      popover.innerHTML = `
        <div class="lossy-popover-item" data-action="save-clip">
          <span>Guardar como Clip</span>
          <span style="opacity:0.5;font-size:10px;">⌘C</span>
        </div>
        <div class="lossy-popover-divider"></div>
        <div class="lossy-popover-item lossy-popover-item-parent" data-action="export-menu">
          <span>Exportar mensaje</span>
          <span style="opacity:0.6;font-size:11px;">▸</span>
          <div class="lossy-popover-submenu">
            <div class="lossy-popover-item" data-format="md">Markdown (.md)</div>
            <div class="lossy-popover-item" data-format="txt">Texto plano (.txt)</div>
            <div class="lossy-popover-item" data-format="json">JSON canónico (.json)</div>
            <div class="lossy-popover-item" data-format="pdf">Documento PDF (.pdf)</div>
            <div class="lossy-popover-item" data-format="docx">Documento Word (.docx)</div>
          </div>
        </div>
        <div class="lossy-popover-divider"></div>
        <div class="lossy-popover-item" data-action="add-collection">
          <span>Añadir a colección...</span>
        </div>
      `;

      if (typeof LossyI18n !== 'undefined') LossyI18n.translateNode(popover);
      popover.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.target.closest('[data-action], [data-format]');
        if (!target) return;

        const action = target.getAttribute('data-action');
        const format = target.getAttribute('data-format');
        const turnData = this.extractTurnData(container, turnIndex);
        let clip = this.createClipObject(turnData);
        clip = await resolveCapturedAssets(clip);

        if (action === 'save-clip') {
          await this.saveClip(clip);
          this.showToast('Clip guardado en biblioteca local', doc);
          popover.remove();
          wrapper.querySelector('.lossy-message-action-btn')?.classList.remove('active');
        } else if (action === 'add-collection') {
          await this.saveClip(clip);
          this.showToast('Clip guardado. Abre Workspace para asignarlo a colecciones.', doc);
          popover.remove();
          wrapper.querySelector('.lossy-message-action-btn')?.classList.remove('active');
        } else if (format) {
          await this.exportMessageFormat(clip, format, doc);
          popover.remove();
          wrapper.querySelector('.lossy-message-action-btn')?.classList.remove('active');
        }
      });

      wrapper.appendChild(popover);

      const anchor=wrapper.querySelector('.lossy-message-action-btn').getBoundingClientRect();
      popover.style.position='fixed';popover.style.bottom='auto';popover.style.marginBottom='0';
      const bounds=popover.getBoundingClientRect();
      popover.style.left=Math.max(8,Math.min(anchor.right-bounds.width,window.innerWidth-bounds.width-8))+'px';
      popover.style.right='auto';
      popover.style.top=Math.max(8,Math.min(anchor.bottom+6,window.innerHeight-bounds.height-8))+'px';
      popover.querySelectorAll('.lossy-popover-item-parent').forEach(parent=>parent.addEventListener('mouseenter',()=>{
        const submenu=parent.querySelector('.lossy-popover-submenu');if(!submenu)return;
        const leftward=parent.getBoundingClientRect().right+190>window.innerWidth-8;
        submenu.style.left=leftward?'auto':'100%';submenu.style.right=leftward?'100%':'auto';
      }));

      const onDocClick = (evt) => {
        if (!wrapper.contains(evt.target)) {
          popover.remove();
          wrapper.querySelector('.lossy-message-action-btn')?.classList.remove('active');
          doc.removeEventListener('click', onDocClick);
        }
      };
      setTimeout(() => doc.addEventListener('click', onDocClick), 10);
    },

    async exportMessageFormat(clip, format, doc = (typeof document !== 'undefined' ? document : null)) {
      const titleSafe = (clip.title || 'mensaje').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const filename = `lossy_${titleSafe}_${Date.now()}`;

      const module = globalThis.Lossy?.ExportCenter || globalThis.Liner?.ExportCenter;
      if (module?.ExportCenter) {
        const center = new module.ExportCenter();
        const result = await center.exportSingle(clip, format, 'human', { imageStrategy: 'embed' });
        if (result.isBinary) this.downloadBinary(result.filename, result.data, result.mimeType);
        else this.downloadText(result.filename, result.data, result.mimeType);
        this.showToast('Mensaje exportado en .' + format, doc);
        return;
      }

      const text = clip.messages[0]?.content?.text || '';
      if (format === 'md') {
        const md = `# ${clip.title}\n\n**Rol**: ${clip.messages[0]?.role}\n\n${text}\n`;
        this.downloadText(`${filename}.md`, md, 'text/markdown');
        this.showToast('Mensaje exportado en Markdown', doc);
      } else if (format === 'txt') {
        this.downloadText(`${filename}.txt`, text, 'text/plain');
        this.showToast('Mensaje exportado en Texto plano', doc);
      } else if (format === 'json') {
        this.downloadText(`${filename}.json`, JSON.stringify(clip, null, 2), 'application/json');
        this.showToast('Mensaje exportado en JSON', doc);
      } else if (format === 'pdf' && typeof PdfBuilder !== 'undefined') {
        const pdfBytes = PdfBuilder.buildPdf(clip, { profile: 'human' });
        this.downloadBinary(`${filename}.pdf`, pdfBytes, 'application/pdf');
        this.showToast('Mensaje exportado en PDF', doc);
      } else if (format === 'docx' && typeof DocxBuilder !== 'undefined') {
        const docxBytes = DocxBuilder.buildDocx(clip, { profile: 'human' });
        this.downloadBinary(`${filename}.docx`, docxBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        this.showToast('Mensaje exportado en Word', doc);
      } else {
        this.showToast(`Formato .${format} preparado`, doc);
      }
    },

    init(rootDoc = (typeof document !== 'undefined' ? document : null)) {
      if (typeof window === 'undefined' || !rootDoc) return;
      this.mount(rootDoc);

      if (typeof MutationObserver !== 'undefined' && rootDoc.body) {
        if (this.observer) this.observer.disconnect();
        this.observer = new MutationObserver(() => {
          this.mount(rootDoc);
        });
        this.observer.observe(rootDoc.body, { childList: true, subtree: true });
      }
    },

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ChatGPTMessageActionsAdapter.init(document));
    } else {
      ChatGPTMessageActionsAdapter.init(document);
    }
  }

  // Exportar funciones puras para entornos de pruebas en Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      cleanText,
      cleanMessageDom,
      isContentImage,
      extractVisibleTurns,
      enrichConversationWithLiveDomAssets,
      areTurnsEqual,
      computeOverlap,
      alignAndAppendTurns,
      detectModelFromDom,
      detectScrollContainer,
      harvestAllConversationTurns,
      detectActiveConversationId,
      checkNavigationEpoch,
      getNavigationEpoch,
      resetNavigationEpochForTest,
      setLastHarvestedStateForTest,
      parseChatGPTConversationTreeDirect,
      extractCurrentChatGPTConversation,
      resolveCapturedAssets,
      ChatGPTMessageActionsAdapter
    };
  }

  console.log('[AICP] Content script v1.2.1 activo (Alineacion por Solapamiento + Telemetria Diagnostica).');
})();
