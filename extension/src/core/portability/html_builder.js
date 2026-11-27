/**
 * Lossy — Standalone Self-Contained HTML Archive Builder (.html)
 * Genera un único archivo HTML offline navegable con tema claro/oscuro, búsqueda instantánea,
 * Markdown formateado, gráficas DIL de ChatGPT, citas clicables e imágenes incrustadas.
 * Zero-dependencies, dual Browser/Node.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../chatgpt_widgets.js'));
  } else {
    root.Lossy = root.Lossy || {};
    root.Lossy.HtmlBuilder = factory(root.Lossy.ChatGPTWidgets);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (widgets) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  const SAFE_RASTER_DATA_URI_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i;

  function makeSlotPrefix(text) {
    let tok = 'XLOSSYSLOT';
    const src = String(text || '');
    while (src.includes(tok)) tok += 'X';
    return tok;
  }

  function isEscapedInRaw(str, idx) {
    let bs = 0;
    for (let k = idx - 1; k >= 0 && str[k] === '\\'; k--) bs++;
    return (bs % 2) === 1;
  }

  function formatInlineCodeInnerFallback(rawSpan) {
    let ticks = 0;
    while (ticks < rawSpan.length && rawSpan[ticks] === '`') ticks++;
    let inner = rawSpan.slice(ticks, rawSpan.length - ticks).replace(/\r?\n/g, ' ');
    if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && /[^ ]/.test(inner)) {
      inner = inner.slice(1, -1);
    }
    return inner;
  }

  function renderInline(raw, opts = {}) {
    const src = String(raw || '');
    const tok = opts._tokPrefix || makeSlotPrefix(src);
    const localSlots = [];
    let work = src;
    if (!opts._inlinePreExtracted) {
      const ranges = (widgets && typeof widgets.findInlineCodeRanges === 'function')
        ? widgets.findInlineCodeRanges(work, opts._initialContainers)
        : [];
      if (ranges.length) {
        let rebuilt = '';
        let cursor = 0;
        for (const r of ranges) {
          rebuilt += work.slice(cursor, r.start);
          const inner = (widgets && typeof widgets.renderInlineCodeSpanPayload === 'function')
            ? widgets.renderInlineCodeSpanPayload(work, r.start, r.end, opts._initialContainers)
            : formatInlineCodeInnerFallback(work.slice(r.start, r.end));
          const idx = localSlots.length;
          localSlots.push(`<code>${escapeHtml(inner)}</code>`);
          rebuilt += `${tok}LIC${idx}END`;
          cursor = r.end;
        }
        rebuilt += work.slice(cursor);
        work = rebuilt;
      } else {
        // Fallback when widgets is unavailable: scan backtick spans respecting escapes and delimiter length
        let rebuilt = '';
        let i = 0;
        while (i < work.length) {
          if (work[i] === '`' && !isEscapedInRaw(work, i)) {
            let ticks = 0;
            while (i + ticks < work.length && work[i + ticks] === '`') ticks++;
            const delim = '`'.repeat(ticks);
            let searchFrom = i + ticks;
            let found = -1;
            while (searchFrom < work.length) {
              const pos = work.indexOf(delim, searchFrom);
              if (pos === -1) break;
              if (work[pos - 1] !== '`' && work[pos + ticks] !== '`') {
                found = pos;
                break;
              }
              searchFrom = pos + 1;
            }
            if (found !== -1) {
              const spanEnd = found + ticks;
              const inner = formatInlineCodeInnerFallback(work.slice(i, spanEnd));
              const idx = localSlots.length;
              localSlots.push(`<code>${escapeHtml(inner)}</code>`);
              rebuilt += `${tok}LIC${idx}END`;
              i = spanEnd;
              continue;
            }
            rebuilt += delim;
            i += ticks;
          } else {
            rebuilt += work[i];
            i++;
          }
        }
        work = rebuilt;
      }
    }
    let s = escapeHtml(work);
    // Images (strict raster data URI only; rejects svg+xml; strips completely when omitImages is true)
    if (opts.omitImages) {
      s = s.replace(/!\[([^\]]*)\]\((?:&lt;)?(?:data:image\/[^)\s]+|https?:\/\/[^)\s]+)(?:&gt;)?\)/gi, (m, _alt, offset, full) => (isEscapedInRaw(full, offset) ? m : ''));
    } else {
      s = s.replace(/!\[([^\]]*)\]\((?:&lt;)?(data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+)(?:&gt;)?\)/gi, (m, alt, uri, offset, full) => (isEscapedInRaw(full, offset) ? m : `<figure class="l-fig"><img src="${uri}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`));
    }
    // Links (preserves &amp; query parameters safely since escapeHtml already ran)
    s = s.replace(/\[([^\]]+)\]\((?:&lt;)?(https?:\/\/(?:&amp;|[^)\s"'<>])+)(?:&gt;)?\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold & italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    if (localSlots.length) {
      const licRe = new RegExp(`${tok}LIC(\\d+)END`, 'g');
      s = s.replace(licRe, (_, idx) => localSlots[Number(idx)] ?? '');
    }
    if (Array.isArray(opts._inlineSlots) && opts._inlineSlots.length) {
      const icRe = new RegExp(`${tok}IC(\\d+)END`, 'g');
      s = s.replace(icRe, (_, idx) => opts._inlineSlots[Number(idx)] ?? '');
    }
    return s;
  }

  function splitMarkdownTableRow(row) {
    const trimmed = String(row || '').trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
        cur += '|';
        i++;
      } else if (trimmed[i] === '|') {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += trimmed[i];
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  function renderSimpleMarkdownToHtml(text, opts = {}) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const tok = makeSlotPrefix(src);
    const blocks = [];
    const codeSlots = [];
    const widgetSlots = [];
    const inlineSlots = [];

    // 1. Unified CommonMark code-block + DIL visual widget + inline-code extraction
    let work;
    let inlinePreExtracted = false;
    if (widgets && typeof widgets.splitFencedCodeSegments === 'function') {
      const segs = widgets.splitFencedCodeSegments(src);
      work = segs.map(seg => {
        if (seg.isCode) {
          const idx = codeSlots.length;
          const cLines = seg.text.split('\n');
          const openM = cLines[0].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
          if (openM && !(openM[1][0] === '`' && openM[2].includes('`'))) {
            const fChar = openM[1][0];
            const fLen = openM[1].length;
            const fenceLang = (openM[2].trim().split(/\s+/)[0]) || 'text';
            const lastLine = cLines.length > 1 ? cLines[cLines.length - 1] : '';
            const closeM = lastLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
            const hasClose = Boolean(closeM && closeM[1][0] === fChar && closeM[1].length >= fLen);
            const body = cLines.slice(1, hasClose ? -1 : undefined).join('\n');
            codeSlots.push(
              `<div class="l-code-wrap"><div class="l-code-head"><span>${escapeHtml(fenceLang)}</span></div>` +
              `<pre><code>${escapeHtml(body)}</code></pre></div>`
            );
          } else {
            codeSlots.push(`<div class="l-code-wrap"><pre><code>${escapeHtml(seg.text)}</code></pre></div>`);
          }
          return `\n\n${tok}CODE${idx}END\n\n`;
        }
        let part = seg.text;
        if (typeof widgets.findTopLevelWidgetRanges === 'function') {
          const initContainers = seg.initialContainers;
          const widgetRanges = widgets.findTopLevelWidgetRanges(part, initContainers).map(r => ({ kind: 'widget', start: r.start, end: r.end, raw: r.raw }));
          const hasInlineFinder = typeof widgets.findInlineCodeRanges === 'function';
          if (hasInlineFinder) inlinePreExtracted = true;
          const inlineRanges = hasInlineFinder
            ? widgets.findInlineCodeRanges(part, initContainers).map(r => ({ kind: 'inline', start: r.start, end: r.end }))
            : [];
          const events = [...widgetRanges, ...inlineRanges].sort((a, b) => a.start - b.start);
          const stripPlain = typeof widgets.stripControlTokensPlain === 'function'
            ? widgets.stripControlTokensPlain
            : s => widgets.stripControlTokensOnly(s);
          let rebuilt = '';
          let cursor = 0;
          for (const ev of events) {
            if (ev.start < cursor) continue;
            rebuilt += stripPlain(part.slice(cursor, ev.start));
            if (ev.kind === 'inline') {
              const inner = typeof widgets.renderInlineCodeSpanPayload === 'function'
                ? widgets.renderInlineCodeSpanPayload(part, ev.start, ev.end, initContainers)
                : formatInlineCodeInnerFallback(part.slice(ev.start, ev.end));
              const icIdx = inlineSlots.length;
              inlineSlots.push(`<code>${escapeHtml(inner)}</code>`);
              rebuilt += `${tok}IC${icIdx}END`;
            } else {
              const idx = widgetSlots.length;
              widgetSlots.push(widgets.renderWidgetBlockToHtml(ev.raw));
              rebuilt += `\n\n${tok}WIDGET${idx}END\n\n`;
            }
            cursor = ev.end;
          }
          rebuilt += stripPlain(part.slice(cursor));
          part = rebuilt;
        }
        return part;
      }).join('\n');
    } else {
      work = src;
    }

    const inlineOpts = { ...opts, _tokPrefix: tok, _inlineSlots: inlineSlots, _inlinePreExtracted: inlinePreExtracted };
    const slotCodeRe = new RegExp(`^${tok}CODE(\\d+)END$`);
    const slotWidgetRe = new RegExp(`^${tok}WIDGET(\\d+)END$`);
    const slotAnyBlockRe = new RegExp(`^(?:${tok}CODE\\d+END|${tok}WIDGET\\d+END)$`);

    // 3. Parse lines into paragraphs, headings, lists, tables, blockquotes
    const lines = work.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }

      const codeM = trimmed.match(slotCodeRe);
      if (codeM) { blocks.push(codeSlots[Number(codeM[1])]); i++; continue; }

      const widM = trimmed.match(slotWidgetRe);
      if (widM) { blocks.push(widgetSlots[Number(widM[1])]); i++; continue; }

      if (/^---+$/.test(trimmed)) { blocks.push('<hr>'); i++; continue; }

      const headM = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headM) {
        const lvl = Math.min(4, headM[1].length + 1);
        blocks.push(`<h${lvl}>${renderInline(headM[2], inlineOpts)}</h${lvl}>`);
        i++;
        continue;
      }

      // Markdown table
      const isTableAt = idx => idx + 1 < lines.length && lines[idx].trim().startsWith('|') && /^\|[\s:|-]+\|/.test(lines[idx + 1].trim());
      if (isTableAt(i)) {
        const headers = splitMarkdownTableRow(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(splitMarkdownTableRow(lines[i]));
          i++;
        }
        const thead = `<thead><tr>${headers.map(h => `<th>${renderInline(h, inlineOpts)}</th>`).join('')}</tr></thead>`;
        const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${renderInline(c, inlineOpts)}</td>`).join('')}</tr>`).join('')}</tbody>`;
        blocks.push(`<div class="l-table-wrap"><table>${thead}${tbody}</table></div>`);
        continue;
      }

      // Unordered list
      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(`<li>${renderInline(lines[i].trim().replace(/^[-*]\s+/, ''), inlineOpts)}</li>`);
          i++;
        }
        blocks.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(`<li>${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''), inlineOpts)}</li>`);
          i++;
        }
        blocks.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // Blockquote (supports lazy paragraph continuations while stopping on block interrupts)
      if (trimmed.startsWith('>')) {
        const qLines = [];
        while (i < lines.length) {
          const qt = lines[i].trim();
          if (!qt) break;
          if (qt.startsWith('>')) {
            qLines.push(qt.replace(/^>\s?/, ''));
            i++;
            continue;
          }
          const prevQ = qLines.length ? qLines[qLines.length - 1].trim() : '';
          const prevAllowsLazy = Boolean(prevQ) && !/^(?:#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$|[-+*]\s|\d{1,9}[.)]\s)/.test(prevQ);
          const nextInterrupts =
            slotAnyBlockRe.test(qt) ||
            /^(?:#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/.test(qt) ||
            isTableAt(i);
          if (!prevAllowsLazy || nextInterrupts) break;
          qLines.push(qt);
          i++;
        }
        blocks.push(`<blockquote>${qLines.map(ql => renderInline(ql, inlineOpts)).join('<br>')}</blockquote>`);
        continue;
      }

      // Paragraph (only stops at '|' if it starts a real Markdown table, plus mandatory progress guard)
      const prevI = i;
      const pLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !slotAnyBlockRe.test(lines[i].trim()) &&
        !/^(#{1,4}\s+|[-*]\s+|\d+\.\s+|>|---+$)/.test(lines[i].trim()) &&
        !isTableAt(i)
      ) {
        pLines.push(renderInline(lines[i].trim(), inlineOpts));
        i++;
      }
      if (pLines.length) {
        blocks.push(`<p>${pLines.join('<br>')}</p>`);
      } else if (i === prevI) {
        blocks.push(`<p>${renderInline(trimmed, inlineOpts)}</p>`);
        i++;
      }
    }

    return blocks.join('\n');
  }

  function bytesToBase64(bytes) {
    if (!bytes || !bytes.length) return '';
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let out = '';
    for (let i = 0; i < bytes.length; i += 16384) {
      out += String.fromCharCode(...bytes.subarray(i, i + 16384));
    }
    return btoa(out);
  }

  function resolveSafeImageDataUri(asset, assetBinaryMap) {
    if (!asset) return null;
    if (asset.dataURI && SAFE_RASTER_DATA_URI_RE.test(asset.dataURI)) return asset.dataURI;
    const raw = (assetBinaryMap instanceof Map
      ? (assetBinaryMap.get(asset.assetId) || assetBinaryMap.get(asset.id) || assetBinaryMap.get(asset.filename))
      : null) || (asset.data instanceof Uint8Array ? asset.data : null);
    if (raw && raw.length) {
      const mime = /^image\/(?:png|jpe?g|gif|webp|avif)$/i.test(asset.mimeType || '') ? asset.mimeType : 'image/png';
      return `data:${mime};base64,${bytesToBase64(raw)}`;
    }
    return null;
  }

  function buildStandaloneHtml(entity, options = {}) {
    entity = entity && typeof entity === 'object' ? entity : {};
    const title = entity.title || 'Conversación Lossy';
    const platform = (entity.source?.platform || entity.sourcePlatform || 'ChatGPT').toUpperCase();
    const model = entity.model || entity.sourceModel || '';
    const sourceUrl = entity.source?.url || entity.sourceURL || '';
    const dateStr = new Date(entity.updatedAt || entity.createdAt || Date.now()).toLocaleString();
    const rawMessages = Array.isArray(entity.selectedMessages)
      ? entity.selectedMessages
      : (Array.isArray(entity.messages) ? entity.messages : []);
    const includeTechnical = Boolean(options.includeTechnicalEvents);
    const messages = rawMessages.filter(m => {
      if (!m) return false;
      if (includeTechnical) return true;
      return m.isConversational !== false && ['user', 'assistant'].includes(m.role);
    });

    const assetBinaryMap = options.assetBinaryMap || options.assetMap || new Map();
    const allAssets = Array.isArray(options.assets) ? options.assets : [];

    const turnsHtml = messages.map((msg, idx) => {
      const isUser = msg.role === 'user';
      const roleLabel = isUser ? 'USUARIO' : (msg.author || platform);
      const text = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
      let bodyHtml = renderSimpleMarkdownToHtml(text, { omitImages: options.imageStrategy === 'omit' });

      // Embedded images for this turn (prefer options.assets, fall back to msg.attachments)
      const fromOptions = allAssets.filter(a => (a.sourceMessageId === msg.id || a.messageIndex === idx) && (a.mimeType?.startsWith('image/') || a.kind === 'image'));
      const msgAssets = fromOptions.length ? fromOptions : (msg.attachments || msg.content?.attachments || []).filter(a => a && (a.mimeType?.startsWith('image/') || a.kind === 'image'));
      if (options.imageStrategy !== 'omit' && msgAssets.length) {
        const imgs = msgAssets.map(a => {
          const uri = resolveSafeImageDataUri(a, assetBinaryMap);
          if (!uri) {
            return `<div class="l-missing-img">[Imagen no disponible localmente: ${escapeHtml(a.filename || 'Imagen')}]</div>`;
          }
          return `<figure class="l-fig"><img src="${escapeHtml(uri)}" alt="${escapeHtml(a.filename || 'Imagen')}"><figcaption>${escapeHtml(a.filename || 'Imagen')}</figcaption></figure>`;
        }).filter(Boolean).join('');
        bodyHtml += imgs;
      }

      // Clickable citations
      const cits = (msg.content?.citations || msg.references || []).filter(c => c && /^https?:\/\//i.test(c.url || ''));
      if (cits.length) {
        const seen = new Set();
        const links = cits.filter(c => { if (seen.has(c.url)) return false; seen.add(c.url); return true; })
          .map((c, ci) => `<a class="l-cite" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">[${ci + 1}] ${escapeHtml(c.title || c.url)}</a>`)
          .join('');
        if (links) bodyHtml += `<div class="l-cites"><span class="l-cites-lbl">Fuentes:</span>${links}</div>`;
      }

      return `<article class="l-turn ${isUser ? 'is-user' : 'is-ai'}" data-turn="${idx + 1}">` +
        `<header class="l-turn-head"><span class="l-role">${escapeHtml(roleLabel)}</span><span class="l-num">Turno #${idx + 1}</span></header>` +
        `<div class="l-turn-body">${bodyHtml}</div></article>`;
    }).join('\n');

    const widgetCss = widgets?.WIDGET_PRINT_CSS || '';
    const css = [
      ':root{color-scheme:dark;--bg:#111719;--surface:#1a2427;--card:#202d31;--border:#2d3f45;--text:#f0f4f1;--sec:#b5c6c8;--muted:#8ea5a9;--accent:#a8dfcb;--accent-soft:#213630}',
      'body.light{color-scheme:light;--bg:#f3f3ee;--surface:#ffffff;--card:#f6f9f7;--border:#d4e0d8;--text:#1c3029;--sec:#4e665c;--muted:#61776e;--accent:#245f49;--accent-soft:#e1f0e7}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14.5px/1.7 "Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}',
      '.l-shell{max-width:900px;margin:0 auto;padding:28px 20px 64px}',
      '.l-top{position:sticky;top:12px;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:24px}',
      '.l-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px}.l-dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}',
      '.l-tools{display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;min-width:220px}',
      '.l-search{flex:1;max-width:260px;padding:7px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;font-size:12.5px}',
      '.l-btn{padding:7px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.l-btn:hover{border-color:var(--accent)}',
      '.l-hero{margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid var(--border)}',
      '.l-hero h1{margin:0 0 8px;font-size:28px;line-height:1.2;letter-spacing:-0.6px}',
      '.l-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--sec)}',
      '.l-meta a{color:var(--accent)}',
      '.l-stream{display:flex;flex-direction:column;gap:16px}',
      '.l-turn{border:1px solid var(--border);border-radius:16px;background:var(--surface);overflow:hidden}',
      '.l-turn.is-hidden{display:none}',
      '.l-turn-head{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--card);font-size:11px}',
      '.l-role{padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:700;letter-spacing:.5px}',
      '.l-turn.is-user .l-role{background:var(--bg);color:var(--text)}',
      '.l-num{color:var(--muted);font-family:ui-monospace,Consolas,monospace}',
      '.l-turn-body{padding:18px 22px;overflow-wrap:anywhere}',
      '.l-turn-body p{margin:0 0 12px}.l-turn-body p:last-child{margin-bottom:0}',
      '.l-turn-body a{color:var(--accent)}',
      '.l-turn-body ul{padding-left:20px;margin:8px 0 12px}.l-turn-body li{margin-bottom:5px}',
      '.l-turn-body blockquote{margin:10px 0;padding:8px 14px;border-left:3px solid var(--accent);color:var(--sec);background:var(--card);border-radius:0 8px 8px 0}',
      '.l-code-wrap{margin:12px 0;border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--bg)}',
      '.l-code-head{padding:5px 12px;font:600 11px ui-monospace,Consolas,monospace;color:var(--muted);border-bottom:1px solid var(--border)}',
      '.l-code-wrap pre{margin:0;padding:12px 14px;overflow-x:auto;font:12.5px/1.55 ui-monospace,Consolas,monospace}',
      '.l-table-wrap{overflow-x:auto;margin:12px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}th{background:var(--card)}',
      '.l-fig{margin:12px 0}.l-fig img{max-width:100%;border-radius:10px;display:block}.l-fig figcaption{font-size:11px;color:var(--muted);margin-top:4px}',
      '.l-cites{margin-top:14px;padding-top:10px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px}',
      '.l-cites-lbl{color:var(--muted);font-weight:600}.l-cite{padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);text-decoration:none}',
      widgetCss,
      'body:not(.light) .lossy-widget-card{background:var(--card);border-color:var(--border)}',
      'body:not(.light) .lossy-widget-title,body:not(.light) .lossy-widget-note,body:not(.light) .lossy-widget-value,body:not(.light) .lossy-widget-svg{color:var(--text)}',
      'body:not(.light) .lossy-widget-caption,body:not(.light) .lossy-widget-bar-head{color:var(--sec)}',
      'body:not(.light) .lossy-widget-pct{color:var(--accent)}'
    ].join('\n');

    const script = `(function(){const s=document.getElementById('l-search'),b=document.getElementById('l-theme'),turns=[...document.querySelectorAll('.l-turn')];b.onclick=()=>{document.body.classList.toggle('light');};s.oninput=()=>{const q=s.value.trim().toLowerCase();turns.forEach(t=>{t.classList.toggle('is-hidden',Boolean(q)&&!t.textContent.toLowerCase().includes(q));});};})();`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'">
<title>${escapeHtml(title)} · Lossy Archive</title>
<style>${css}</style>
</head>
<body>
<div class="l-shell">
  <nav class="l-top">
    <div class="l-brand"><span class="l-dot"></span><span>Lossy Archive</span></div>
    <div class="l-tools">
      <input id="l-search" class="l-search" type="search" placeholder="Buscar en esta conversación..." aria-label="Buscar">
      <button id="l-theme" class="l-btn" type="button">Claro / Oscuro</button>
    </div>
  </nav>
  <header class="l-hero">
    <h1>${escapeHtml(title)}</h1>
    <div class="l-meta">
      <span>${escapeHtml(platform)}${model ? ' · ' + escapeHtml(model) : ''}</span>
      <span>${messages.length} mensajes</span>
      <span>${escapeHtml(dateStr)}</span>
      ${/^https?:\/\//i.test(sourceUrl) ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Abrir origen</a>` : ''}
    </div>
  </header>
  <main class="l-stream">${turnsHtml}</main>
</div>
<script>${script}</script>
</body>
</html>`;
  }

  return { buildStandaloneHtml, renderSimpleMarkdownToHtml };
});
