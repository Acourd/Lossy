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
    const adapter = getAdapter();
    const url = window.location?.href || '';
    const info = adapter ? adapter.detectPlatform(url) : null;
    if (!info) return null;
    const extracted = info.platform === 'claude'
      ? adapter.extractClaudeDom(document, url)
      : adapter.extractGeminiDom(document, url);
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
        if (!adapter || !info) {
          sendResponse({ success: false, error: 'Plataforma no compatible' });
          return false;
        }
        if (activeAbortController) activeAbortController.abort();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeAbortController = controller;
        (async () => {
          try {
            const data = info.platform === 'claude'
              ? adapter.extractClaudeDom(document, url)
              : adapter.extractGeminiDom(document, url);
            await hydrateConversationImages(data, controller?.signal);
            if (controller?.signal?.aborted) {
              sendResponse({ success: false, error: 'Captura cancelada' });
              return;
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
