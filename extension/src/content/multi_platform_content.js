/**
 * Lossy — Content Script para Claude.ai y Gemini
 * Pasivo, 100% local-first y aislado del script de ChatGPT.
 * Incluye resolución asíncrona de imágenes (fetch autenticado → DataURI) para que
 * las imágenes subidas o generadas en Gemini/Claude se incrusten en PDF, HTML y ZIP.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined') {
    if (window.__LOSSY_MULTI_CS_INIT__) return;
    window.__LOSSY_MULTI_CS_INIT__ = true;
  }

  function getAdapter() {
    return globalThis.Lossy?.MultiPlatform || null;
  }

  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const FETCH_TIMEOUT_MS = 10000;
  const MAX_CONCURRENCY = 4;
  const SAFE_RASTER_MIME = /^image\/(?:png|jpe?g|gif|webp|avif)$/i;
  let activeAbortController = null;
  let navGeneration = 0;
  let lastObservedHref = (typeof window !== 'undefined' && window.location) ? window.location.href : '';
  let lastObservedUrlConvId = null;
  let lastDomState = null;
  let pendingNavTransition = false;
  let domObserverInitialized = false;
  const foreignSignaturesByConv = new Map(); // convId -> Set<string>
  const foreignTurnsByConv = new Map();      // convId -> Set<string>

  function extractTurnEntries(data) {
    return (data?.messages || [])
      .map(m => `${m.role || ''}:${String(m.content?.text || m.text || '').trim()}`)
      .filter(Boolean);
  }

  function computeDomTurnSignature(data) {
    return extractTurnEntries(data).join('\n---\n');
  }

  function recordForeignDom(convId, snap) {
    const key = convId || '__unknown__';
    if (!snap || !snap.signature) return;
    if (!foreignSignaturesByConv.has(key)) foreignSignaturesByConv.set(key, new Set());
    foreignSignaturesByConv.get(key).add(snap.signature);
    if (!foreignTurnsByConv.has(key)) foreignTurnsByConv.set(key, new Set());
    const tSet = foreignTurnsByConv.get(key);
    for (const entry of (snap.turns || [])) {
      if (entry) tSet.add(entry);
    }
    if (foreignSignaturesByConv.size > 25) {
      const oldestKey = foreignSignaturesByConv.keys().next().value;
      foreignSignaturesByConv.delete(oldestKey);
      foreignTurnsByConv.delete(oldestKey);
    }
  }

  function extractSnapshotForHref(href) {
    const adapter = getAdapter();
    if (!adapter || !href) return null;
    const info = adapter.detectPlatform(href);
    if (!info) return null;
    const data = info.platform === 'claude'
      ? adapter.extractClaudeDom(document, href)
      : adapter.extractGeminiDom(document, href);
    const turns = extractTurnEntries(data);
    const sig = turns.join('\n---\n');
    if (!sig) return null;
    return {
      url: href,
      platform: info.platform,
      convId: info.conversationId,
      signature: sig,
      turns
    };
  }

  function detectDomDeclaredConversationId() {
    if (typeof document === 'undefined' || !document.querySelector) return null;
    const scoped = document.querySelector('main [data-conversation-id], [role="main"] [data-conversation-id]');
    const el = scoped || document.querySelector('[data-conversation-id]');
    const val = el?.getAttribute?.('data-conversation-id');
    return val ? String(val).trim() : null;
  }

  function matchesAnyForeignDom(targetConvId, sig, turns) {
    const domCid = detectDomDeclaredConversationId();
    if (domCid && targetConvId && domCid === targetConvId) {
      return false;
    }
    for (const [cid, sigSet] of foreignSignaturesByConv.entries()) {
      if (targetConvId && cid === targetConvId) continue;
      if (sig && sigSet.has(sig)) return true;
    }
    if (!turns || turns.length === 0) return false;
    const parseEntry = (entry) => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { role: '', body: entry.trim() };
      return { role: entry.slice(0, idx), body: entry.slice(idx + 1).trim() };
    };
    const isStaleTurnAgainst = (curParsed, prevSet) => {
      if (!curParsed.body) return true;
      for (const prevRaw of prevSet) {
        const prevParsed = parseEntry(prevRaw);
        if (curParsed.role && prevParsed.role && curParsed.role !== prevParsed.role) continue;
        if (curParsed.body === prevParsed.body && curParsed.body.length >= 6) return true;
        if (curParsed.body.length >= 10 && prevParsed.body.length >= 10 &&
            (prevParsed.body.includes(curParsed.body) || curParsed.body.includes(prevParsed.body))) {
          return true;
        }
      }
      return false;
    };
    const parsedTurns = turns.map(parseEntry);
    for (const [cid, tSet] of foreignTurnsByConv.entries()) {
      if (targetConvId && cid === targetConvId) continue;
      if (!tSet || tSet.size === 0) continue;
      const staleFlags = parsedTurns.map(pt => isStaleTurnAgainst(pt, tSet));
      if (!staleFlags.some(Boolean)) continue;
      // Un turno de usuario repetido con nueva respuesta es válido, pero cualquier respuesta de asistente previa sigue siendo obsoleta.
      const hasStaleAiResponse = parsedTurns.some((pt, i) => staleFlags[i] && pt.role !== 'user' && pt.body.length >= 6);
      if (hasStaleAiResponse) {
        return true;
      }
      const hasDistinctFreshTurn = parsedTurns.some((pt, i) => !staleFlags[i] && pt.body.length >= 8);
      if (!hasDistinctFreshTurn) {
        return true;
      }
    }
    return false;
  }

  function recordCurrentDomBaseline() {
    if (typeof window === 'undefined' || !window.location) return;
    const href = window.location.href || '';
    if (href !== lastObservedHref) return;
    const snap = extractSnapshotForHref(href);
    if (!snap || !snap.convId) return;
    lastObservedUrlConvId = snap.convId;
    if (pendingNavTransition && matchesAnyForeignDom(snap.convId, snap.signature, snap.turns)) {
      return;
    }
    lastDomState = snap;
    recordForeignDom(snap.convId, snap);
  }

  function bumpNavigation(preNavSnap = null) {
    const prevCid = preNavSnap?.convId || lastObservedUrlConvId || lastDomState?.convId || '__unknown__';
    if (preNavSnap && preNavSnap.signature) {
      recordForeignDom(prevCid, preNavSnap);
      if (preNavSnap.convId) lastDomState = preNavSnap;
    } else if (lastObservedHref) {
      const fallbackSnap = extractSnapshotForHref(lastObservedHref);
      if (fallbackSnap && fallbackSnap.signature) {
        recordForeignDom(prevCid, fallbackSnap);
        lastDomState = fallbackSnap;
      }
    }
    navGeneration++;
    pendingNavTransition = true;
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.location) {
      lastObservedHref = window.location.href || '';
      const nextInfo = getAdapter()?.detectPlatform?.(lastObservedHref);
      lastObservedUrlConvId = nextInfo?.conversationId || null;
    }
  }

  function checkRouteChanged(preNavSnap = null) {
    if (typeof window === 'undefined' || !window.location) return false;
    const href = window.location.href || '';
    if (href !== lastObservedHref) {
      bumpNavigation(preNavSnap);
      return true;
    }
    return false;
  }

  function initNavigationTracking() {
    if (typeof window === 'undefined') return;
    recordCurrentDomBaseline();
    window.addEventListener('popstate', () => { bumpNavigation(); });
    window.addEventListener('hashchange', () => { bumpNavigation(); });
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', () => { bumpNavigation(); });
    }
    if (typeof history !== 'undefined') {
      for (const method of ['pushState', 'replaceState']) {
        if (typeof history[method] === 'function') {
          try {
            const orig = history[method].bind(history);
            history[method] = function (...args) {
              const prevHref = window.location?.href || '';
              const preSnap = prevHref === lastObservedHref
                ? extractSnapshotForHref(prevHref)
                : null;
              const prevCid = preSnap?.convId || lastObservedUrlConvId || lastDomState?.convId || '__unknown__';
              if (preSnap && preSnap.signature) {
                recordForeignDom(prevCid, preSnap);
                lastDomState = { ...preSnap, convId: prevCid };
              }
              const res = orig(...args);
              checkRouteChanged(preSnap ? { ...preSnap, convId: prevCid } : null);
              return res;
            };
          } catch (_) {}
        }
      }
    }
    if (!domObserverInitialized && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      domObserverInitialized = true;
      try {
        const rootNode = document.body || document.documentElement;
        if (rootNode) {
          const observer = new MutationObserver(() => {
            if (checkRouteChanged()) return;
            recordCurrentDomBaseline();
          });
          observer.observe(rootNode, { childList: true, subtree: true, characterData: true });
        }
      } catch (_) {}
    }
  }

  initNavigationTracking();

  async function fetchAsDataUri(url, externalSignal) {
    if (!url) return null;
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(url)) return { dataURI: url, mimeType: url.slice(5, url.indexOf(';')) };
    if (!/^https?:\/\//i.test(url)) return null;
    const perReq = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onExternalAbort = () => perReq?.abort();
    if (externalSignal) {
      if (externalSignal.aborted) return null;
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = perReq ? setTimeout(() => perReq.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, { credentials: 'include', signal: perReq?.signal });
      if (!res.ok) return null;
      const contentLen = Number(res.headers?.get('content-length') || 0);
      if (contentLen > MAX_IMAGE_BYTES) return null;
      const blob = await res.blob();
      if (!blob || !blob.size || blob.size > MAX_IMAGE_BYTES) return null;
      const mimeType = String(blob.type || '').split(';')[0].trim().toLowerCase();
      if (!SAFE_RASTER_MIME.test(mimeType)) return null;
      const dataURI = await new Promise((resolve) => {
        const reader = new FileReader();
        const readTimer = setTimeout(() => resolve(null), 5000);
        reader.onloadend = () => {
          clearTimeout(readTimer);
          resolve(typeof reader.result === 'string' && SAFE_RASTER_MIME.test(mimeType) ? reader.result : null);
        };
        reader.onerror = () => { clearTimeout(readTimer); resolve(null); };
        reader.readAsDataURL(blob);
      });
      return dataURI ? { dataURI, mimeType } : null;
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function hydrateConversationImages(conv, signal) {
    if (!conv || !Array.isArray(conv.messages)) return conv;
    const allAtts = [];
    const pending = [];
    for (const msg of conv.messages) {
      const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
      for (const att of atts) {
        allAtts.push(att);
        if (!att.dataURI && att.sourceURL) pending.push(att);
      }
    }
    let cursor = 0;
    const workers = Math.min(MAX_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (cursor < pending.length) {
        if (signal?.aborted) break;
        const att = pending[cursor++];
        const hydrated = await fetchAsDataUri(att.sourceURL, signal);
        if (hydrated && hydrated.dataURI) {
          att.dataURI = hydrated.dataURI;
          att.mimeType = hydrated.mimeType || att.mimeType || 'image/png';
          const ext = att.mimeType.includes('jpeg') || att.mimeType.includes('jpg') ? 'jpg'
            : att.mimeType.includes('webp') ? 'webp'
            : att.mimeType.includes('gif') ? 'gif' : 'png';
          if (att.filename && /\.png$/i.test(att.filename) && ext !== 'png') {
            att.filename = att.filename.replace(/\.png$/i, `.${ext}`);
          }
          att.availability = 'embedded';
        }
      }
    }));
    conv.attachments = allAtts;
    return conv;
  }

  function getPageStatus() {
    checkRouteChanged();
    const adapter = getAdapter();
    const url = window.location?.href || '';
    const info = adapter ? adapter.detectPlatform(url) : null;
    if (!info) return null;
    const extracted = info.platform === 'claude'
      ? adapter.extractClaudeDom(document, url)
      : adapter.extractGeminiDom(document, url);
    if (!pendingNavTransition && info.conversationId) {
      const sig = computeDomTurnSignature(extracted);
      if (sig) lastDomState = { url, platform: info.platform, convId: info.conversationId, signature: sig };
    }
    return {
      platform: info.platform,
      conversationId: info.conversationId,
      title: extracted.title,
      model: null,
      visibleTurnsCount: extracted.messages.length
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      if (!message || !message.action) return false;
      const adapter = getAdapter();
      const url = window.location?.href || '';
      const info = adapter ? adapter.detectPlatform(url) : null;

      if (message.action === 'GET_PAGE_STATUS') {
        const status = getPageStatus();
        sendResponse({ success: Boolean(status), status });
        return false;
      }

      if (message.action === 'ACQUIRE_CONVERSATION') {
        checkRouteChanged();
        const startHref = window.location?.href || '';
        const infoAtStart = adapter ? adapter.detectPlatform(startHref) : null;
        if (!adapter || !infoAtStart) {
          sendResponse({ success: false, error: 'Plataforma no compatible' });
          return false;
        }
        if (message.conversationId && infoAtStart.conversationId !== message.conversationId) {
          sendResponse({
            success: false,
            error: `SOURCE_IDENTITY_MISMATCH: La conversación activa (${infoAtStart.conversationId || 'inicio'}) no coincide con la solicitada (${message.conversationId}).`
          });
          return false;
        }
        const startNavGen = navGeneration;
        const startConvId = infoAtStart.conversationId;
        if (activeAbortController) activeAbortController.abort();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeAbortController = controller;
        (async () => {
          try {
            const extractNow = (curUrl, plat) => (plat === 'claude'
              ? adapter.extractClaudeDom(document, curUrl)
              : adapter.extractGeminiDom(document, curUrl));

            let data = extractNow(startHref, infoAtStart.platform);
            let turns = extractTurnEntries(data);
            let sig = turns.join('\n---\n');
            const domDeclMismatch = () => {
              const domCid = detectDomDeclaredConversationId();
              return Boolean(domCid && startConvId && domCid !== startConvId);
            };
            const isStaleFromOtherConv = () => {
              if (domDeclMismatch()) return true;
              if (lastDomState && startConvId && lastDomState.convId && lastDomState.convId !== startConvId) {
                if (lastDomState.signature && sig && sig === lastDomState.signature) return true;
              }
              if (matchesAnyForeignDom(startConvId, sig, turns)) return true;
              return false;
            };
            const needsPostNavRenderWait = () => pendingNavTransition && !sig;

            if (isStaleFromOtherConv() || needsPostNavRenderWait()) {
              for (let waitStep = 0; waitStep < 8; waitStep++) {
                await new Promise(r => setTimeout(r, 80));
                if (controller?.signal?.aborted || checkRouteChanged() || navGeneration !== startNavGen || (window.location?.href || '') !== startHref) {
                  sendResponse({ success: false, error: 'NAVIGATION_ABORT: La conversación cambió durante la espera de convergencia DOM.' });
                  return;
                }
                data = extractNow(startHref, infoAtStart.platform);
                turns = extractTurnEntries(data);
                sig = turns.join('\n---\n');
                if (!isStaleFromOtherConv() && !needsPostNavRenderWait()) break;
              }
              if (isStaleFromOtherConv()) {
                sendResponse({
                  success: false,
                  error: 'SOURCE_IDENTITY_STALE_DOM: El DOM aún refleja una conversación anterior tras navegación SPA.'
                });
                return;
              }
            }

            if (controller?.signal?.aborted || checkRouteChanged() || navGeneration !== startNavGen || (window.location?.href || '') !== startHref) {
              sendResponse({ success: false, error: 'NAVIGATION_ABORT: La conversación cambió antes de hidratar recursos.' });
              return;
            }

            await hydrateConversationImages(data, controller?.signal);

            const afterHref = window.location?.href || '';
            const afterInfo = adapter.detectPlatform(afterHref);
            if (
              controller?.signal?.aborted ||
              checkRouteChanged() ||
              navGeneration !== startNavGen ||
              afterHref !== startHref ||
              !afterInfo ||
              afterInfo.platform !== infoAtStart.platform ||
              afterInfo.conversationId !== startConvId ||
              (message.conversationId && afterInfo.conversationId !== message.conversationId) ||
              domDeclMismatch()
            ) {
              sendResponse({ success: false, error: 'NAVIGATION_ABORT: La conversación cambió durante la captura.' });
              return;
            }

            pendingNavTransition = false;
            if (startConvId && sig) {
              const snap = { url: startHref, platform: infoAtStart.platform, convId: startConvId, signature: sig, turns };
              lastDomState = snap;
              recordForeignDom(startConvId, snap);
            }
            sendResponse({ success: true, data });
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          } finally {
            if (activeAbortController === controller) activeAbortController = null;
          }
        })();
        return true;
      }

      if (message.action === 'CANCEL_ACQUISITION') {
        if (activeAbortController) {
          activeAbortController.abort();
          activeAbortController = null;
        }
        sendResponse({ success: true });
        return false;
      }

      return false;
    });
  }
})();
