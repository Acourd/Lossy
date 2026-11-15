/**
 * AI Conversation Portability (AICP) — Adaptador Clean-Room para ChatGPT
 * Extrae conversaciones directamente desde el DOM de ChatGPT sin acceder a APIs privadas
 * ni almacenar credenciales. Funciona tanto en el navegador como en tests de Node.
 */

const { createCanonicalConversation } = require('../core/canonical_model.js');

/**
 * Limpia y normaliza texto extraído de nodos DOM.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * Parser de fragmento HTML para entornos Node / Test o headless.
 */
function parseChatGPTDomSnippet(htmlString, options = {}) {
  const title = options.title || 'Conversación de ChatGPT';
  const url = options.url || 'https://chatgpt.com';
  const messages = [];

  // Enfoque 1 (Estructura viva de ChatGPT 2025-2026): Encabezados semánticos de turno <h4 ...>Tú dijiste:|ChatGPT dijo:|...</h4>
  const h4Regex = /<h4[^>]*class=["'][^"']*sr-only[^"']*["'][^>]*>(.*?)<\/h4>([\s\S]*?)(?=(?:<h4[^>]*class=["'][^"']*sr-only|<div class="footer|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>|$))/gi;
  let h4Match;

  while ((h4Match = h4Regex.exec(htmlString)) !== null) {
    const marker = h4Match[1].toLowerCase();
    const innerHtml = h4Match[2];
    const role = (marker.includes('dijiste') || marker.includes('said') || marker.includes('user')) ? 'user' : 'assistant';

    // Extraer bloques de código <pre><code class="language-(.*?)">(.*?)</code></pre>
    const codeBlocks = [];
    const codeRegex = /<pre><code(?:\s+class=["']language-([^"']+)["'])?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let codeMatch;
    while ((codeMatch = codeRegex.exec(innerHtml)) !== null) {
      codeBlocks.push({
        language: codeMatch[1] || 'plaintext',
        code: cleanText(codeMatch[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      });
    }

    const cleanContent = cleanText(innerHtml.replace(/<[^>]+>/g, ' '));
    if (cleanContent.length > 0) {
      messages.push({
        role,
        author: role === 'user' ? 'Usuario' : 'ChatGPT',
        text: cleanContent,
        codeBlocks
      });
    }
  }

  // Enfoque 2 (Fallback): data-message-author-role="user|assistant|system"
  if (messages.length === 0) {
    const turnRegex = /data-message-author-role=["'](user|assistant|system)["'][^>]*>([\s\S]*?)(?=(?:data-message-author-role=|<\/article>|$))/gi;
    let match;

    while ((match = turnRegex.exec(htmlString)) !== null) {
      const role = match[1].toLowerCase();
      const innerHtml = match[2];

      const codeBlocks = [];
      const codeRegex = /<pre><code(?:\s+class=["']language-([^"']+)["'])?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
      let codeMatch;
      while ((codeMatch = codeRegex.exec(innerHtml)) !== null) {
        codeBlocks.push({
          language: codeMatch[1] || 'plaintext',
          code: cleanText(codeMatch[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
        });
      }

      const cleanContent = cleanText(innerHtml.replace(/<[^>]+>/g, ' '));
      messages.push({
        role,
        author: role === 'user' ? 'Usuario' : 'ChatGPT',
        text: cleanContent,
        codeBlocks
      });
    }
  }

  // Enfoque 3 (Fallback): Contenedores <article>
  if (messages.length === 0) {
    const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let articleMatch;
    let turnCount = 0;
    while ((articleMatch = articleRegex.exec(htmlString)) !== null) {
      const artHtml = articleMatch[1];
      const role = turnCount % 2 === 0 ? 'user' : 'assistant';
      const cleanContent = cleanText(artHtml.replace(/<[^>]+>/g, ' '));
      if (cleanContent.length > 0) {
        messages.push({
          role,
          author: role === 'user' ? 'Usuario' : 'ChatGPT',
          text: cleanContent,
          codeBlocks: []
        });
        turnCount++;
      }
    }
  }

  return createCanonicalConversation({
    title,
    platform: 'chatgpt',
    model: options.model || null,
    integrity: options.integrity || 'harvested',
    integrityNotice: options.integrityNotice || null,
    url,
    messages
  });
}

/**
 * Extractor nativo del navegador (se ejecuta dentro de la página de ChatGPT).
 */
function extractFromLiveChatGPTDom(documentRef, options = {}) {
  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('No se detectó entorno DOM (document no disponible)');

  const titleElem = doc.querySelector('title');
  const title = titleElem ? titleElem.textContent.replace(' - ChatGPT', '').trim() : 'Conversación de ChatGPT';
  const url = typeof location !== 'undefined' ? location.href : 'https://chatgpt.com';

  const rawMessages = [];

  // Enfoque 1 (Estructura viva de ChatGPT 2025-2026): Marcadores h4 semánticos
  const h4Nodes = Array.from(doc.querySelectorAll('h4')).filter(h => {
    const t = (h.textContent || h.innerText || '').toLowerCase().trim();
    return t.includes('dijiste') || t.includes('said') || t.includes('dijo') || t.includes('chatgpt') || t.includes('you');
  });

  if (h4Nodes && h4Nodes.length > 0) {
    h4Nodes.forEach((h4, idx) => {
      const markerText = (h4.textContent || h4.innerText || '').toLowerCase();
      const isUser = markerText.includes('dijiste') || markerText.includes('said') || markerText.includes('you') || markerText.includes('user');
      const role = isUser ? 'user' : 'assistant';
      const author = isUser ? 'Usuario' : 'ChatGPT';

      const container = h4.parentElement;
      if (!container) return;

      // Clonar nodo para limpiar el encabezado y botones sin mutar la página viva
      const clone = container.cloneNode(true);
      const h4InClone = clone.querySelector('h4');
      if (h4InClone) h4InClone.remove();

      // Extraer bloques de código estructurados y formatearlos en línea
      const codeBlocks = [];
      const preNodes = clone.querySelectorAll('pre');
      preNodes.forEach((pre) => {
        const codeElem = pre.querySelector('code');
        const code = cleanText(codeElem ? codeElem.textContent : pre.textContent);
        const langClass = codeElem ? Array.from(codeElem.classList).find(c => c.startsWith('language-')) : null;
        const language = langClass ? langClass.replace('language-', '') : 'plaintext';
        codeBlocks.push({
          language,
          code
        });

        if (doc.createTextNode) {
          const mdNode = doc.createTextNode(`\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`);
          if (pre.parentNode) {
            pre.parentNode.replaceChild(mdNode, pre);
          }
        }
      });

      const text = cleanText(clone.textContent);
      if (text.length > 0) {
        rawMessages.push({
          role,
          author,
          text,
          codeBlocks
        });
      }
    });
  }

  // Enfoque 2 (Fallback): Elementos con data-message-author-role
  if (rawMessages.length === 0) {
    const messageNodes = doc.querySelectorAll('[data-message-author-role]');
    if (messageNodes && messageNodes.length > 0) {
      messageNodes.forEach((node, idx) => {
        const role = node.getAttribute('data-message-author-role') || 'assistant';
        const textContainer = node.querySelector('.markdown') || node.querySelector('.whitespace-pre-wrap') || node;
        const text = textContainer ? cleanText(textContainer.textContent) : '';

        const codeBlocks = [];
        const codeNodes = node.querySelectorAll('pre code');
        codeNodes.forEach((cn) => {
          const langClass = Array.from(cn.classList).find(c => c.startsWith('language-'));
          const language = langClass ? langClass.replace('language-', '') : 'plaintext';
          codeBlocks.push({
            language,
            code: cn.textContent.trim()
          });
        });

        rawMessages.push({
          role,
          author: role === 'user' ? 'Usuario' : 'ChatGPT',
          text,
          codeBlocks
        });
      });
    }
  }

  // Enfoque 3 (Fallback): Artículos
  if (rawMessages.length === 0) {
    const articles = doc.querySelectorAll('article');
    articles.forEach((art, idx) => {
      const isAssistant = art.querySelector('.markdown') !== null;
      const role = isAssistant ? 'assistant' : 'user';
      const text = cleanText(art.textContent);

      if (text.length > 0) {
        rawMessages.push({
          role,
          author: role === 'user' ? 'Usuario' : 'ChatGPT',
          text,
          codeBlocks: []
        });
      }
    });
  }

  return createCanonicalConversation({
    title,
    platform: 'chatgpt',
    model: options.model || null,
    integrity: options.integrity || 'harvested',
    integrityNotice: options.integrityNotice || null,
    url,
    messages: rawMessages
  });
}

const { parseChatGPTConversationTree } = require('../platforms/chatgpt/structured/chatgpt_structured_acquisition.js');

module.exports = {
  cleanText,
  parseChatGPTDomSnippet,
  extractFromLiveChatGPTDom,
  parseChatGPTConversationTree
};
