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

  async function fetchAsDataUri(url) {
    if (!url || url.startsWith('data:image/')) return url;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type || !blob.type.startsWith('image/')) return null;
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  }

  async function hydrateConversationImages(conv) {
    if (!conv || !Array.isArray(conv.messages)) return conv;
    const allAtts = [];
    for (const msg of conv.messages) {
      const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
      for (const att of atts) {
        if (!att.dataURI && att.sourceURL) {
          const uri = await fetchAsDataUri(att.sourceURL);
          if (uri) {
            att.dataURI = uri;
            att.availability = 'embedded';
          }
        }
        allAtts.push(att);
      }
    }
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
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
        (async () => {
          try {
            const data = info.platform === 'claude'
              ? adapter.extractClaudeDom(document, url)
              : adapter.extractGeminiDom(document, url);
            await hydrateConversationImages(data);
            sendResponse({ success: true, data });
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
        })();
        return true;
      }

      if (message.action === 'CANCEL_ACQUISITION') {
        sendResponse({ success: true });
        return false;
      }

      return false;
    });
  }
})();
