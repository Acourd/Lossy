/**
 * Lossy Context Portability — Centro de Exportación Unificado (Export Center)
 * Arquitectura desacoplada: Entidad Canónica -> Preparación -> Asset Resolver -> Perfil -> Formateador -> Artefacto.
 * Soporta entidades heterogéneas (Conversaciones y Clips individuales, colecciones y selecciones masivas).
 * Formatos: Markdown (.md), Texto plano (.txt), JSON canónico (.json), PDF (.pdf), Word (.docx) e Imagen (.png).
 * Perfiles: AI (para otros LLMs), Human (legibilidad y diseño), Compact (máxima densidad).
 * Dual Browser/Node. Zero-Dependencies.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const zipBuilder = require('./zip_builder.js');
    const pdfBuilder = require('./pdf_builder.js');
    const docxBuilder = require('./docx_builder.js');
    const canonicalModel = require('../canonical_model.js');
    const serializer = require('../markdown_serializer.js');
    const chatgptWidgets = require('../chatgpt_widgets.js');
    const htmlBuilder = require('./html_builder.js');
    module.exports = factory({ zipBuilder, pdfBuilder, docxBuilder, canonicalModel, serializer, chatgptWidgets, htmlBuilder });
  } else {
    root.Lossy = root.Lossy || root.Liner || {};
    const deps = {
      zipBuilder: root.Lossy.ZipBuilder || root.Liner?.ZipBuilder,
      pdfBuilder: root.Lossy.PdfBuilder || root.Liner?.PdfBuilder,
      docxBuilder: root.Lossy.DocxBuilder || root.Liner?.DocxBuilder,
      canonicalModel: root.Lossy.CanonicalModel || root.Liner?.CanonicalModel,
      serializer: root.Lossy.MarkdownSerializer || root.Liner?.MarkdownSerializer,
      chatgptWidgets: root.Lossy.ChatGPTWidgets,
      htmlBuilder: root.Lossy.HtmlBuilder
    };
    root.Lossy.ExportCenter = factory(deps);
    if (root.Liner) root.Liner.ExportCenter = root.Lossy.ExportCenter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const EXPORT_FORMATS = {
    MARKDOWN: 'md',
    TXT: 'txt',
    JSON: 'json',
    PDF: 'pdf',
    DOCX: 'docx',
    PNG: 'png',
    HTML: 'html'
  };

  const EXPORT_PROFILES = {
    AI: 'ai',
    HUMAN: 'human',
    COMPACT: 'compact',
    OBSIDIAN: 'obsidian'
  };

  const DEFAULT_PROFILE_BY_FORMAT = {
    [EXPORT_FORMATS.MARKDOWN]: EXPORT_PROFILES.AI,
    [EXPORT_FORMATS.TXT]: EXPORT_PROFILES.AI,
    [EXPORT_FORMATS.JSON]: 'canonical',
    [EXPORT_FORMATS.PDF]: EXPORT_PROFILES.HUMAN,
    [EXPORT_FORMATS.DOCX]: EXPORT_PROFILES.HUMAN,
    [EXPORT_FORMATS.PNG]: EXPORT_PROFILES.HUMAN,
    [EXPORT_FORMATS.HTML]: EXPORT_PROFILES.HUMAN
  };

  const ASSET_AVAILABILITY = {
    EMBEDDED: 'embedded',
    DOWNLOADED: 'downloaded',
    REFERENCED: 'referenced',
    UNAVAILABLE: 'unavailable'
  };

  function getSafeFilename(rawTitle, extension) {
    const base = (rawTitle || 'conversacion')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50)
      .toLowerCase();
    const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)?'safe_'+base:(base||'conversacion');
    return `${safeBase}.${extension}`;
  }

  // --- 1. RESOLVER DE ASSETS (IMÁGENES Y ADJUNTOS) ---

  function dataUriToUint8Array(dataUri) {
    if (!dataUri || !dataUri.includes(',')) return new Uint8Array(0);
    const base64 = dataUri.split(',')[1];
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  function uint8ArrayToBase64(bytes) {
    if (!bytes || bytes.length === 0) return '';
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function resolveDataUriForAsset(att, assetBinaryMap) {
    if (!att) return null;
    if (att.dataURI) return att.dataURI;
    const rawBinary = (assetBinaryMap instanceof Map ? (assetBinaryMap.get(att.assetId) || assetBinaryMap.get(att.id) || assetBinaryMap.get(att.filename) || assetBinaryMap.get(att.name)) : null) ||
                      (att.data instanceof Uint8Array ? att.data : (att.bytes || null));
    if (rawBinary && rawBinary.length > 0) {
      const mime = att.mimeType || (att.filename?.endsWith('.jpg') || att.filename?.endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
      return `data:${mime};base64,${uint8ArrayToBase64(rawBinary)}`;
    }
    return null;
  }

  function buildAssetManifest(entity, assets = []) {
    const assetList = Array.isArray(assets) ? assets : [];
    return {
      version: '1.0.0',
      title: entity.title || 'Conversación',
      exportedAt: new Date().toISOString(),
      assets: {
        total: assetList.length,
        embedded: assetList.filter(a => a.availability === ASSET_AVAILABILITY.EMBEDDED).length,
        downloaded: assetList.filter(a => a.availability === ASSET_AVAILABILITY.DOWNLOADED).length,
        referenced: assetList.filter(a => a.availability === ASSET_AVAILABILITY.REFERENCED).length,
        unavailable: assetList.filter(a => a.availability === ASSET_AVAILABILITY.UNAVAILABLE).length
      },
      items: assetList.map(a => ({
        assetId: a.assetId || a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        status: a.availability,
        sourceMessageId: a.sourceMessageId || null,
        warning: (Array.isArray(a.warnings) && a.warnings[0]) || a.error || null
      }))
    };
  }

  class AssetResolver {
    constructor(options = {}) {
      this.strategy = options.imageStrategy || 'reference'; // 'package' | 'embed' | 'reference' | 'omit'
      this.strict = Boolean(options.strict);
    }

    static resolveAssetsForEntity(entity, options = {}) {
      return new AssetResolver(options).resolveAssetsForEntity(entity);
    }

    static async resolveAssetBinaries(entity, options = {}) {
      return new AssetResolver(options).resolveAssetBinaries(entity, options);
    }

    resolveAssetsForEntity(entity) {
      const records = [];
      const messages = Array.isArray(entity.selectedMessages)
        ? entity.selectedMessages
        : (Array.isArray(entity.messages) ? entity.messages : []);

      const seenKeys = new Set();
      const seenMsgAssetIds = new Set();
      let activeMessageIndex = null;
      const addAsset = asset => {
        records.push(asset);
        const index = asset.messageIndex == null ? null : activeMessageIndex;
        if (!index) return;
        for (const key of [asset.fileId, asset.assetId]) if (key != null && !index.identities.has(key)) index.identities.set(key, asset);
        if (asset.assetPointer) index.pointers.add(asset.assetPointer);
        if (asset.sourceURL) index.locations.add(asset.sourceURL);
        if (asset.dataURI) index.locations.add(asset.dataURI);
      };

      // 1. Adjuntos a nivel de mensaje
      messages.forEach((msg, mIdx) => {
        const index = { identities: new Map(), pointers: new Set(), locations: new Set() };
        activeMessageIndex = index;
        const msgId = msg.id || `msg_${mIdx}`;
        const atts = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.content?.attachments) ? msg.content.attachments : []);
        atts.forEach((att, aIdx) => {
          let localBlob = att.data || att.blob || att.localBlob || null;
          let remoteURL = att.sourceURL || att.url || att.downloadUrl || null;
          let dataURI = att.dataURI || null;

          let availability = ASSET_AVAILABILITY.REFERENCED;
          const warnings = [];

          if (localBlob || dataURI) {
            availability = ASSET_AVAILABILITY.EMBEDDED;
          } else if (remoteURL) {
            availability = ASSET_AVAILABILITY.REFERENCED;
          } else {
            availability = ASSET_AVAILABILITY.UNAVAILABLE;
            warnings.push('Recurso sin binario local ni URL de descarga');
          }

          const rawAssetId = att.assetId || att.id || `asset_${mIdx}_${aIdx}`;
          const identity = att.fileId || att.assetPointer?.replace(/^(?:sediment|file-service):\/\//, '') || rawAssetId;
          const existing = index.identities.get(identity);
          if (existing) {
            if (!existing.dataURI && dataURI) { existing.dataURI=dataURI;existing.availability='embedded';index.locations.add(dataURI); }
            return;
          }
          const scopedKey = `${msgId}::${rawAssetId}`;
          if (seenKeys.has(scopedKey)) return;
          seenKeys.add(scopedKey);
          let assetId = rawAssetId;
          let disambig = 1;
          while (seenMsgAssetIds.has(assetId)) {
            assetId = `${rawAssetId}__u${mIdx}_${aIdx}_${disambig++}`;
          }
          seenMsgAssetIds.add(rawAssetId);
          seenMsgAssetIds.add(assetId);

          const mimeType = att.mimeType || (att.kind === 'image' ? 'image/png' : 'application/octet-stream');
          const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : (mimeType.includes('png') ? 'png' : 'bin');
          const filename = att.filename || att.name || `image_${mIdx}_${aIdx}.${ext}`;

          addAsset({
            assetId,
            id: assetId,
            sourceMessageId: msgId,
            messageIndex: mIdx,
            sourceType: att.sourceType || (att.kind === 'image' ? 'dom-image' : 'attachment'),
            mimeType,
            filename,
            availability,
            resolutionMethod: this.strategy,
            dataURI,
            data: localBlob,
            sourceURL: remoteURL,
            assetPointer: att.assetPointer || null,
            fileId: att.fileId || att.assetPointer?.replace(/^(?:sediment|file-service):\/\//, '') || null,
            warnings,
            error: availability === ASSET_AVAILABILITY.UNAVAILABLE ? warnings[0] : null
          });
        });

        // 2. Punteros de imagen en content.parts (ChatGPT DAG)
        if (Array.isArray(msg.content?.parts)) {
          msg.content.parts.forEach((part, pIdx) => {
            if (part && typeof part === 'object' && (part.content_type === 'image_asset_pointer' || part.asset_pointer)) {
              const ptr = part.asset_pointer || part.id || `img_ptr_${mIdx}_${pIdx}`;
              if (index.pointers.has(ptr)) return;
              const assetId = `ptr_${mIdx}_${pIdx}`;
              if (seenKeys.has(assetId)) return;
              seenKeys.add(assetId);

              // Un puntero interno sin URL ni binario es estrictamente UNAVAILABLE
              const warnings = ['Puntero interno de ChatGPT no descargable en modo estático'];
              addAsset({
                assetId,
                id: assetId,
                sourceMessageId: msgId,
                messageIndex: mIdx,
                sourceType: 'image_asset_pointer',
                mimeType: 'image/png',
                filename: `chatgpt_asset_${ptr.substring(0, 16)}.png`,
                availability: ASSET_AVAILABILITY.UNAVAILABLE,
                resolutionMethod: this.strategy,
                dataURI: null,
                data: null,
                sourceURL: null,
                assetPointer: ptr,
                warnings,
                error: warnings[0]
              });
            }
          });
        }

        // 3. Detección de imágenes Markdown inline ![alt](url)
        const text = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
        const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        let imgIdx = 0;
        while ((match = mdImgRegex.exec(text)) !== null) {
          const imgUrl = match[2].replace(/^<|>$/g, '');
          if (index.locations.has(imgUrl)) continue;
          const isInlineData = imgUrl.startsWith('data:');
          const assetId = `md_img_${mIdx}_${imgIdx++}`;
          const scopedKey = `${msgId}::${assetId}`;
          if (seenKeys.has(scopedKey)) return;
          seenKeys.add(scopedKey);
          seenMsgAssetIds.add(assetId);

          const mimeType = isInlineData ? (imgUrl.split(';')[0].replace('data:', '') || 'image/png') : 'image/png';
          const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
          const filename = match[1] ? `${match[1].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24)}.${ext}` : `inline_img_${mIdx}_${imgIdx}.${ext}`;

          addAsset({
            assetId,
            id: assetId,
            sourceMessageId: msgId,
            messageIndex: mIdx,
            sourceType: isInlineData ? 'data-uri' : 'markdown-image',
            mimeType,
            filename,
            availability: isInlineData ? ASSET_AVAILABILITY.EMBEDDED : ASSET_AVAILABILITY.REFERENCED,
            resolutionMethod: this.strategy,
            dataURI: isInlineData ? imgUrl : null,
            data: isInlineData ? dataUriToUint8Array(imgUrl) : null,
            sourceURL: isInlineData ? null : imgUrl,
            assetPointer: null,
            warnings: [],
            error: null
          });
        }
      });

      activeMessageIndex = null;
      // 4. Adjuntos a nivel superior de entidad
      const topAtts = Array.isArray(entity.attachments) ? entity.attachments : [];
      topAtts.forEach((att, aIdx) => {
        const assetId = att.assetId || att.id || `top_asset_${aIdx}`;
        if (seenKeys.has(assetId) || seenMsgAssetIds.has(assetId)) return;
        seenKeys.add(assetId);

        const remoteURL = att.sourceURL || att.url || null;
        const localBlob = att.data || att.blob || null;
        const dataURI = att.dataURI || null;

        let availability = ASSET_AVAILABILITY.REFERENCED;
        const warnings = [];
        if (localBlob || dataURI) {
          availability = ASSET_AVAILABILITY.EMBEDDED;
        } else if (remoteURL) {
          availability = ASSET_AVAILABILITY.REFERENCED;
        } else {
          availability = ASSET_AVAILABILITY.UNAVAILABLE;
          warnings.push('Recurso a nivel superior sin URL ni binario');
        }

        addAsset({
          assetId,
          id: assetId,
          sourceMessageId: null,
          messageIndex: null,
          sourceType: att.sourceType || 'attachment',
          mimeType: att.mimeType || 'application/octet-stream',
          filename: att.filename || att.name || `adjunto_${aIdx}`,
          availability,
          resolutionMethod: this.strategy,
          dataURI,
          data: localBlob,
          sourceURL: remoteURL,
          assetPointer: att.assetPointer || null,
          warnings,
          error: availability === ASSET_AVAILABILITY.UNAVAILABLE ? warnings[0] : null
        });
      });

      const filenames = new Set();
      records.forEach((asset, i) => {
        let name = String(asset.filename || 'imagen.png').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_');
        if (!name || /^\.+$/.test(name)) name = 'imagen.png';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
        const originalName=name;let suffix=i;
        while(filenames.has(name.toLowerCase()))name=suffix+++'_'+originalName;
        filenames.add(name.toLowerCase());
        asset.filename = name;
      });
      return records;
    }

    /**
     * Resuelve los binarios reales de todos los recursos (DataURI, Fetch local y Blobs).
     * @param {Object} entity - Conversación o Clip
     * @param {Object} options - Opciones con fetch inyectable
     * @returns {Promise<{ assets: Array<Object>, assetBinaryMap: Map<string, Uint8Array> }>}
     */
    async resolveAssetBinaries(entity, options = {}) {
      const assets = this.resolveAssetsForEntity(entity);
      const assetBinaryMap = new Map();
      const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);

      // Caches are scoped to this export so a later retry can fetch fresh resources.
      const dataUris = new Map();
      const downloads = new Map();
      const download = address => {
        if (!downloads.has(address)) downloads.set(address, (async () => {
          const url = new URL(address);
          if (!['https:', 'http:', 'blob:'].includes(url.protocol)) throw new Error('URL de recurso no admitida');
          const trusted = /(^|\.)(chatgpt\.com|openai\.com|oaiusercontent\.com|googleusercontent\.com|claude\.ai)$/.test(url.hostname);
          const response = await fetchFn(address, { credentials: trusted ? 'include' : 'omit', signal: AbortSignal.timeout(12000) });
          if (!response?.ok) throw new Error('Fallo al descargar HTTP ' + (response?.status ?? 'desconocido'));
          const mimeType = response.headers?.get('content-type')?.split(';')[0];
          let body;
          return { mimeType, readBytes: () => {
            if (!body) body = (async () => {
              const buffer = await response.arrayBuffer();
              if (!buffer.byteLength) throw new Error('Recurso vacío');
              return new Uint8Array(buffer);
            })();
            return body;
          } };
        })());
        return downloads.get(address);
      };
      const bind = (asset, bytes, availability) => {
        asset.data = bytes;
        asset.availability = availability;
        assetBinaryMap.set(asset.filename, bytes);
        assetBinaryMap.set(asset.assetId, bytes);
      };
      const resolve = async asset => {
        if (asset.data && typeof asset.data.arrayBuffer === 'function') asset.data = new Uint8Array(await asset.data.arrayBuffer());
        if (asset.data instanceof ArrayBuffer) asset.data = new Uint8Array(asset.data);
        if (asset.data && (asset.data instanceof Uint8Array || asset.data.length > 0)) {
          bind(asset, asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data), ASSET_AVAILABILITY.EMBEDDED);
          return;
        }
        if (asset.dataURI && asset.dataURI.includes(',')) {
          if (!dataUris.has(asset.dataURI)) dataUris.set(asset.dataURI, dataUriToUint8Array(asset.dataURI));
          bind(asset, dataUris.get(asset.dataURI), ASSET_AVAILABILITY.EMBEDDED);
          return;
        }
        if (asset.sourceURL && fetchFn) {
          try {
            const { readBytes, mimeType } = await download(asset.sourceURL);
            if (asset.mimeType?.startsWith('image/') && mimeType && !mimeType.startsWith('image/')) throw new Error('La respuesta no contiene una imagen');
            if (mimeType?.startsWith('image/')) asset.mimeType = mimeType;
            bind(asset, await readBytes(), ASSET_AVAILABILITY.DOWNLOADED);
          } catch (error) {
            asset.warnings.push('Error al obtener recurso: ' + error.message);
            asset.availability = ASSET_AVAILABILITY.REFERENCED;
          }
        }
      };
      const requested = Number.isInteger(options.assetConcurrency) ? options.assetConcurrency : 4;
      const concurrency = Math.min(4, Math.max(1, requested), assets.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (cursor < assets.length) await resolve(assets[cursor++]);
      }));

      return {
        assets,
        assetBinaryMap,
        assetMap: assetBinaryMap
      };
    }
  }

  // --- 2. FORMATEADORES ---


  function isInternalToolPayload(msg) {
    if (!msg || msg.role === 'user') return false;
    if (msg.isConversational === false || msg.role === 'tool' || msg.nodeCategory === 'tool') return true;
    const t = String(msg?.text ?? msg?.content?.text ?? '').trim();
    return /^\{[\s\S]*"path"\s*:\s*"\/Automations\//i.test(t);
  }

  function splitFencedCodeSegments(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const segments = [];
    let buf = [];
    let inFence = false;
    let fenceLen = 0;

    const flush = isCode => {
      if (buf.length) {
        segments.push({ isCode, text: buf.join('\n') });
        buf = [];
      }
    };

    for (const line of lines) {
      if (!inFence) {
        const openM = line.match(/^(`{3,})[^`]*$/);
        if (openM) {
          flush(false);
          inFence = true;
          fenceLen = openM[1].length;
          buf.push(line);
          continue;
        }
        buf.push(line);
      } else {
        buf.push(line);
        const closeM = line.match(/^(`{3,})\s*$/);
        if (closeM && closeM[1].length >= fenceLen) {
          flush(true);
          inFence = false;
          fenceLen = 0;
        }
      }
    }
    flush(inFence);
    return segments;
  }

  function cleanExportText(text) {
    // Preserve literal examples in fenced code (including 4+ backtick nested fences); remove only ChatGPT control tokens.
    return splitFencedCodeSegments(text).map(seg => seg.isCode ? seg.text : seg.text
      .replace(/\uE200[\s\S]*?\uE201/g, '')
      .replace(/<Cite\b[^>]*\/>/gi, '')
      .replace(/<SuggestAutomation\b[^>]*\/>/gi, '')
      .replace(/<DisplayAutomation\b[^>]*\/>/gi, '')
      .replace(/!?\[([^\]]*)\]\(<?app:\/\/[^)>]+>?\)/g, (_, label) => label.replace(/^\$/, ''))
      .replace(/\[Imagen: (?:sediment:\/\/|file-)[^\]]*\]/g, '')).join('\n');
  }

  function markdownResources(msg, index, options) {
    const assets = (options.assets || []).filter(a => a.sourceMessageId === msg.id || a.messageIndex === index);
    const attachments = assets.length ? assets : (msg.attachments || msg.content?.attachments || []);
    const images = attachments.filter(a => a && (a.kind === 'image' || a.mimeType?.startsWith('image/') || a.sourceType?.includes('image')));
    const rendered = new Set();
    const strategy = options.imageStrategy || 'embed';
    const render = (a, alt) => {
      if (strategy === 'omit') return '';
      const key = a.assetId || a.id || a.sourceURL || a.url || a.dataURI;
      if (rendered.has(key)) return '';
      rendered.add(key);
      const label = String(alt || a.filename || a.name || 'Imagen').replace(/[\[\]\r\n]/g, ' ');
      const data = resolveDataUriForAsset(a, options.assetBinaryMap || options.assetMap);
      let target;
      if (strategy === 'package' && data) target = 'assets/' + encodeURIComponent(a.filename || a.name);
      else if (strategy === 'embed' && data) target = data;
      else target = a.sourceURL || a.url;
      if (!target || !/^(https?:|data:image\/|assets\/)/i.test(target)) return '> [Recurso visual no disponible: ' + label + ']';
      return '![' + label + '](<' + target.replace(/>/g, '%3E') + '>)';
    };
    const widgets = deps.chatgptWidgets || (typeof globalThis !== 'undefined' ? globalThis.Lossy?.ChatGPTWidgets : null);
    let text = cleanExportText(typeof msg.text === 'string' ? msg.text : msg.content?.text);
    if (!options.preserveRawWidgets && widgets && typeof widgets.renderWidgetsToMarkdown === 'function') {
      text = widgets.renderWidgetsToMarkdown(text);
    }
    const body = splitFencedCodeSegments(text).map(seg => seg.isCode ? seg.text : seg.text.replace(/!\[([^\]]*)\]\(<?([^)>]+)>?\)/g, (original, alt, url) => {
      const found = images.find(a => a.sourceURL === url || a.url === url || a.dataURI === url);
      return found ? render(found, alt) : (strategy === 'omit' ? '' : original);
    })).join('\n');
    return body + images.map(a => { const image = render(a); return image ? '\n\n' + image : ''; }).join('');
  }

  function formatCitationsMarkdown(msg) {
    const raw = (Array.isArray(msg?.content?.citations) && msg.content.citations.length)
      ? msg.content.citations
      : (Array.isArray(msg?.references) ? msg.references : []);
    if (!raw.length) return '';
    const seen = new Set();
    const links = [];
    for (const c of raw) {
      const url = String(c?.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const label = String(c.title || url).replace(/[\[\]\r\n]/g, ' ').trim();
      links.push(`[${links.length + 1}] [${label}](<${url.replace(/>/g, '%3E')}>)`);
    }
    return links.length ? `\n\n> **Fuentes:** ${links.join(' · ')}` : '';
  }

  function formatMessageMarkdown(message, index, options = {}) {
    const text = markdownResources(message, index, options);
    const blocks = message.codeBlocks || message.content?.codeBlocks || [];
    const codePart = !text.includes('```') ? blocks.map(block => '\n\n```' + (block.language || '') + '\n' + (block.code || '') + '\n```').join('') : '';
    const citationsPart = options.includeCitations !== false ? formatCitationsMarkdown(message) : '';
    return text + codePart + citationsPart;
  }

  function formatAsMarkdown(entity, profile = EXPORT_PROFILES.AI, options = {}) {
    const title = entity.title || 'Conversación';
    const platform = (entity.source?.platform || entity.sourcePlatform || entity.platform || 'ChatGPT').toUpperCase();
    const model = entity.model || entity.sourceModel || 'Estándar';
    const integrity = entity.integrity?.status || entity.integrityStatus || 'Capturado';
    const rawMessages = Array.isArray(entity.selectedMessages)
      ? entity.selectedMessages
      : (Array.isArray(entity.messages) ? entity.messages : []);

    const includeTechnical = Boolean(options.includeTechnicalEvents);
    const messages = rawMessages.filter(m => {
      if (includeTechnical) return true;
      if (m.isConversational === false) return false;
      return m.role === 'user' || m.role === 'assistant';
    });

    const isClip = entity.entityType === 'clip' || (entity.canonicalId && entity.canonicalId.startsWith('clip_'));

    if (profile === EXPORT_PROFILES.OBSIDIAN) {
      const isoDate = new Date(entity.updatedAt || entity.createdAt || Date.now()).toISOString().slice(0, 10);
      const sourceUrl = entity.source?.url || entity.sourceURL || '';
      const platTag = platform.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const lines = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `platform: ${JSON.stringify(platTag)}`,
        `model: ${JSON.stringify(model)}`,
        `date: ${isoDate}`,
        `messages: ${messages.length}`,
        sourceUrl ? `source: ${JSON.stringify(sourceUrl)}` : null,
        `tags: [lossy, ai-chat, ${platTag || 'ai'}]`,
        '---',
        '',
        `# ${title}`,
        '',
        `> [!info] Exportado localmente con Lossy (${platform} · ${messages.length} mensajes)`
      ].filter(v => v !== null);
      lines.push('');

      messages.forEach((msg, idx) => {
        const isUser = msg.role === 'user';
        const author = msg.author || (isUser ? 'Usuario' : platform);
        const text = (markdownResources(msg, idx, options) + formatCitationsMarkdown(msg)).trim();
        lines.push(`## ${author}`, '', text, '');
        const codeBlocks = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
        if (codeBlocks.length > 0 && !text.includes('```')) {
          codeBlocks.forEach(cb => {
            lines.push(`\`\`\`${cb.language || ''}`, cb.code || '', '```', '');
          });
        }
      });

      return lines.join('\n');
    }

    if (profile === EXPORT_PROFILES.AI) {
      // Perfil AI: Máxima claridad semántica, títulos estándar, delimitadores de rol H2
      const lines = [
        `# ${title}`,
        '',
        `Platform: ${platform}`,
        `Model: ${model}`,
        `Integrity: ${integrity}`,
        isClip ? `Entity: Clip (${entity.selectionType || 'slice'})` : 'Entity: Conversation'
      ];

      if (isClip && entity.sourceConversationTitle) {
        lines.push(`Source Conversation: ${entity.sourceConversationTitle}`);
      }

      lines.push('', '---', '');

      messages.forEach((msg, idx) => {
        const isUser = msg.role === 'user';
        const isAssistant = msg.role === 'assistant';
        const roleLabel = isUser ? 'User' : (isAssistant ? 'Assistant' : (msg.role || 'Tool'));
        const text = (markdownResources(msg, idx, options) + formatCitationsMarkdown(msg)).trim();

        lines.push(`## ${roleLabel}`, '', text, '');

        const codeBlocks = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
        if (codeBlocks.length > 0 && !text.includes('```')) {
          codeBlocks.forEach(cb => {
            lines.push(`\`\`\`${cb.language || ''}`, cb.code || '', '```', '');
          });
        }

      });

      return lines.join('\n');
    }

    // Perfil Human: Encabezados elegantes, metadatos estructurados
    const lines = [
      `# ${title}`,
      '',
      `> **Plataforma**: ${platform} · **Modelo**: \`${model}\``,
      `> **Integridad**: ${integrity} · **Fecha**: ${new Date(entity.updatedAt || entity.createdAt || Date.now()).toLocaleString()}`,
      isClip ? `> **Tipo**: Clip de contexto (${messages.length} turnos)` : `> **Total Mensajes**: ${messages.length}`,
      '',
      '---',
      ''
    ];

    messages.forEach((msg, idx) => {
      const isUser = msg.role === 'user';
      const isAssistant = msg.role === 'assistant';
      const aiLabel = platform === 'GEMINI' ? 'Gemini' : platform === 'CLAUDE' ? 'Claude' : 'ChatGPT';
      const author = msg.author || (isUser ? 'Usuario' : (isAssistant ? aiLabel : 'Herramienta'));
      const text = (markdownResources(msg, idx, options) + formatCitationsMarkdown(msg)).trim();
      const timeStr = msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString()}` : '';

      lines.push(`### ${author}${timeStr}`, '', text, '');

      const codeBlocks = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
      if (codeBlocks.length > 0 && !text.includes('```')) {
        codeBlocks.forEach(cb => {
          lines.push(`\`\`\`${cb.language || ''}`, cb.code || '', '```', '');
        });
      }

      lines.push('---', '');
    });

    return lines.join('\n');
  }

  function formatAsTxt(entity, profile = EXPORT_PROFILES.AI, options = {}) {
    const title = entity.title || 'Conversación';
    const platform = (entity.source?.platform || entity.sourcePlatform || entity.platform || 'ChatGPT').toUpperCase();
    const model = entity.model || entity.sourceModel || 'Estándar';
    const integrity = entity.integrity?.status || entity.integrityStatus || 'Capturado';
    const rawMessages = Array.isArray(entity.selectedMessages)
      ? entity.selectedMessages
      : (Array.isArray(entity.messages) ? entity.messages : []);

    const includeTechnical = Boolean(options.includeTechnicalEvents);
    const messages = rawMessages.filter(m => {
      if (includeTechnical) return true;
      if (m.isConversational === false) return false;
      return m.role === 'user' || m.role === 'assistant';
    });

    const lines = [
      `# ${title}`,
      `Platform: ${platform}`,
      `Model: ${model}`,
      `Integrity: ${integrity}`,
      `Date: ${new Date(entity.updatedAt || entity.createdAt || Date.now()).toLocaleDateString()}`,
      '',
      '================================================================',
      ''
    ];

    messages.forEach(msg => {
      const isUser = msg.role === 'user';
      const isAssistant = msg.role === 'assistant';
      const roleLabel = isUser ? 'USER' : (isAssistant ? 'ASSISTANT' : (msg.role || 'TOOL').toUpperCase());
      const widgets = deps.chatgptWidgets || (typeof globalThis !== 'undefined' ? globalThis.Lossy?.ChatGPTWidgets : null);
      let text = cleanExportText(typeof msg.text === 'string' ? msg.text : msg.content?.text).trim();
      if (widgets && typeof widgets.renderWidgetsToPlainText === 'function') {
        text = widgets.renderWidgetsToPlainText(text).trim();
      }

      lines.push(`${roleLabel}:`, text, '');

      const codeBlocks = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
      if (codeBlocks.length > 0 && !text.includes('```')) {
        codeBlocks.forEach(cb => {
          lines.push(`--- CODE [${cb.language || 'plaintext'}] ---`, cb.code || '', '-------------------------', '');
        });
      }

      // Recursos en TXT (Sin Base64)
      const msgAtts = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.content?.attachments) ? msg.content.attachments : []);
      msgAtts.forEach(att => {
        if (att && (att.kind === 'image' || (att.mimeType && att.mimeType.startsWith('image/')) || (att.sourceType && att.sourceType.includes('image')))) {
          const imgName = att.name || att.filename || 'imagen';
          if (options.imageStrategy === 'package') {
            lines.push(`[IMAGE: assets/${att.filename || att.name}]`);
          } else if (options.imageStrategy === 'reference' && (att.sourceURL || att.url)) {
            lines.push(`[IMAGE: ${att.sourceURL || att.url}]`);
          } else {
            lines.push(`[Recurso visual omitido: ${imgName}]`);
          }
        }
      });

      lines.push('----------------------------------------------------------------', '');
    });

    return lines.join('\n');
  }

  function formatAsJson(entity) {
    return JSON.stringify(entity, null, 2);
  }

  // Generador de imagen PNG local con paginación
  async function formatAsPng(entity, options = {}) {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('La exportación PNG requiere un navegador con Canvas.');
    const width=900,height=1200,padding=44;
    const pages=[];let canvas,ctx,y;
    function page() {
      if(canvas)pages.push(canvas);
      canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Canvas no disponible');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);y=padding;
    }
    function space(needed){if(y+needed>height-padding)page();}
    function line(text,size=17,color='#263d36',bold=false,mono=false){
      space(size*1.65);ctx.fillStyle=color;ctx.font=(bold?'600 ':'')+size+'px '+(mono?'monospace':'sans-serif');ctx.fillText(text,padding,y+size);y+=size*1.65;
    }
    function textLines(text,mono=false){
      const size=mono?15:17;
      for(const paragraph of String(text||'').split('\n')){
        ctx.font=size+'px '+(mono?'monospace':'sans-serif');
        let current='';
        for(const char of paragraph){
          if(ctx.measureText(current+char).width>width-padding*2){line(current,size,'#263d36',false,mono);current=char;}else current+=char;
        }
        line(current,size,'#263d36',false,mono);
      }
    }
    page();textLines(entity.title||'Conversación');line('LOSSY / ARCHIVO DE CONVERSACIÓN',11,'#62786f');y+=14;
    const messages=(entity.selectedMessages||entity.messages||[]).filter(m=>options.includeTechnicalEvents||(m.isConversational!==false&&['user','assistant'].includes(m.role)));
    const pngPlatform = (entity.source?.platform || entity.sourcePlatform || 'CHATGPT').toUpperCase();
    for(const [index,msg] of messages.entries()){
      space(80);line(msg.role==='user'?'USUARIO':msg.role==='assistant'?pngPlatform:msg.role.toUpperCase(),12,'#25664f',true);y+=4;
      const text=cleanExportText(typeof msg.text==='string'?msg.text:msg.content?.text).replace(/!\[[^\]]*\]\(<?[^)>]+>?\)/g,'');
      textLines(text);
      const code=msg.codeBlocks||msg.content?.codeBlocks||[];
      if(!text.includes('```'))for(const block of code)textLines(block.code,true);
      const images=(options.assets||[]).filter(a=>(a.sourceMessageId===msg.id||a.messageIndex===index)&&a.mimeType?.startsWith('image/'));
      if(options.imageStrategy!=='omit')for(const image of images){
        const bytes=options.assetMap?.get(image.assetId)||image.data||(image.dataURI?dataUriToUint8Array(image.dataURI):undefined);
        let bitmap;
        try {
          if(!bytes?.length)throw new Error('Imagen no disponible');
          bitmap=await createImageBitmap(new Blob([bytes],{type:image.mimeType}));
          const scale=Math.min((width-padding*2)/bitmap.width,(height-padding*2-50)/bitmap.height,1.5);
          const w=bitmap.width*scale,h=bitmap.height*scale;
          space(h+34);ctx.drawImage(bitmap,padding,y,w,h);y+=h+10;line(image.filename||'Imagen',11,'#62786f');
        }catch(error){textLines('[Imagen no disponible: '+(image.filename||'recurso')+']');}
        finally{bitmap?.close();}
      }
      y+=24;
    }
    pages.push(canvas);
    const encoded=[];
    for(const image of pages){const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));if(!blob)throw new Error('No se pudo generar PNG');encoded.push(new Uint8Array(await blob.arrayBuffer()));}
    if(encoded.length===1)return {isMultiPage:false,data:encoded[0],pagesCount:1};
    const files={};encoded.forEach((bytes,i)=>files['conversation_page_'+String(i+1).padStart(3,'0')+'.png']=bytes);
    return {isMultiPage:true,data:deps.zipBuilder.createZip(files),pagesCount:encoded.length};
  }

  // --- 3. MOTOR PRINCIPAL DE EXPORTACIÓN (PIPELINE) ---

  class ExportCenter {
    constructor(options = {}) {
      this.options = options;
      this.assetResolver = new AssetResolver(options);
    }

    /**
     * Exporta una entidad individual (Conversación o Clip).
     * @param {Object} entity - Entidad canónica
     * @param {string} format - Formato ('md' | 'txt' | 'json' | 'pdf' | 'docx' | 'png')
     * @param {string} profile - Perfil ('ai' | 'human' | 'compact')
     * @param {Object} exportOptions - Opciones adicionales
     */
    async exportSingle(entity, format = EXPORT_FORMATS.MARKDOWN, profile = null, exportOptions = {}) {
      if (!entity) throw new Error('Entidad no provista para exportar');
      const aliases={markdown:'md',text:'txt',word:'docx',image:'png'};
      format=String(format).toLowerCase();format=aliases[format]||format;
      if(!Object.values(EXPORT_FORMATS).includes(format))throw new Error('Formato no soportado: '+format);

      exportOptions = { ...this.options, ...exportOptions };
      const liveAssets=typeof globalThis !== 'undefined' ? globalThis.Lossy?.ChatGPTAssets : undefined;
      if (format !== 'json' && exportOptions.imageStrategy !== 'omit' && liveAssets && typeof chrome !== 'undefined' && chrome.runtime?.id && (entity.source?.platform === 'chatgpt' || entity.sourcePlatform === 'chatgpt') && liveAssets.summary(entity).missing) {
        entity=await liveAssets.resolveConversationAssets(entity, {baseOrigin:'https://chatgpt.com',getToken:async()=>{
          const res=await fetch('https://chatgpt.com/api/auth/session',{credentials:'include',signal:AbortSignal.timeout(10000)});
          if(!res.ok)throw new Error('Sesión no disponible');
          const session=await res.json();
          if(!session.accessToken)throw new Error('Sesión no disponible');
          return session.accessToken;
        }});
      }
      if (format !== 'json') {
        const widgets = deps.chatgptWidgets || (typeof globalThis !== 'undefined' ? globalThis.Lossy?.ChatGPTWidgets : null);
        const transformText = raw => {
          const cleaned = cleanExportText(raw);
          if (['pdf', 'docx', 'word', 'png', 'image'].includes(format) && widgets && typeof widgets.renderWidgetsToPlainText === 'function') {
            return widgets.renderWidgetsToPlainText(cleaned);
          }
          return cleaned;
        };
        const messages = (entity.selectedMessages || entity.messages || []).filter(m => exportOptions.includeTechnicalEvents || (m.isConversational !== false && ['user','assistant'].includes(m.role) && !isInternalToolPayload(m))).map(m => ({...m, ...(typeof m.text === 'string' ? {text:transformText(m.text)} : {}), ...(m.content ? {content:{...m.content,text:transformText(m.content.text)}} : {})}));
        entity = { ...entity, messages, ...(entity.selectedMessages ? { selectedMessages: messages } : {}) };
      }
      const effectiveProfile = profile || DEFAULT_PROFILE_BY_FORMAT[format] || EXPORT_PROFILES.HUMAN;
      const safeTitle = entity.title || 'conversacion';
      const isClip = entity.entityType === 'clip' || (entity.canonicalId && entity.canonicalId.startsWith('clip_'));
      const formatExt = format.toLowerCase().replace('markdown', 'md').replace('text', 'txt').replace('word', 'docx').replace('image', 'png');
      const rawBase = getSafeFilename(safeTitle, formatExt);
      const filename = (isClip && !rawBase.startsWith('clip_')) ? `clip_${rawBase}` : rawBase;

      // 1. Resolver activos / adjuntos y binarios locales
      let resolvedAssets = null;
      let resolvedBinaries = null;

      try {
        const customRes = exportOptions.imageStrategy === 'omit' || format === 'json'
          ? { assets: [], assetBinaryMap: new Map() }
          : await AssetResolver.resolveAssetBinaries(entity, exportOptions);
        if (customRes instanceof Map) {
          resolvedBinaries = customRes;
          resolvedAssets = this.assetResolver.resolveAssetsForEntity(entity);
        } else if (customRes && typeof customRes === 'object') {
          resolvedAssets = customRes.assets || this.assetResolver.resolveAssetsForEntity(entity);
          resolvedBinaries = customRes.assetBinaryMap || customRes.assetMap || (customRes instanceof Map ? customRes : new Map());
        }
      } catch (_) {}

      if (!resolvedBinaries) {
        const res = await this.assetResolver.resolveAssetBinaries(entity, exportOptions);
        resolvedAssets = res.assets;
        resolvedBinaries = res.assetBinaryMap;
      }

      if (exportOptions.imageStrategy === 'omit' && ['docx','word','png','image'].includes(format)) {
        const strip = m => ({...m,attachments:[],content:{...m.content,attachments:[]}});
        entity = {...entity,attachments:[],messages:(entity.messages||[]).map(strip),...(entity.selectedMessages ? {selectedMessages:entity.selectedMessages.map(strip)} : {})};
      }
      const assets = resolvedAssets || [];
      const assetBinaryMap = resolvedBinaries || new Map();

      // 2. Formatear según tipo
      switch (format.toLowerCase()) {
        case 'md':
        case 'markdown': {
          // Si la estrategia es 'package' y existen binarios descargados/embebidos, empaquetar en ZIP + /assets/
          if (exportOptions.imageStrategy === 'package') {
            const zb = deps.zipBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.ZipBuilder || globalThis.ZipBuilder) : null);
            if (zb && typeof zb.createZip === 'function') {
              const content = formatAsMarkdown(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap, imageStrategy: 'package' });
              const manifest = buildAssetManifest(entity, assets);
              const zipFiles = {
                [rawBase]: content,
                'manifest.json': JSON.stringify(manifest, null, 2)
              };
              for (const a of assets) {
                const bytes = assetBinaryMap.get(a.assetId) || assetBinaryMap.get(a.id) || assetBinaryMap.get(a.filename) || assetBinaryMap.get(a.name);
                if (bytes) {
                  if (a.filename) zipFiles[`assets/${a.filename}`] = bytes;
                }
              }

              const zipBytes = zb.createZip(zipFiles);
              return {
                filename: rawBase.replace(/\.[^.]+$/, '.zip'),
                mimeType: 'application/zip',
                data: zipBytes,
                isBinary: true,
                format: 'md',
                profile: effectiveProfile,
                assets
              };
            }
          }

          const content = formatAsMarkdown(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap });
          return {
            filename,
            mimeType: 'text/markdown;charset=utf-8',
            data: content,
            isBinary: false,
            format: 'md',
            profile: effectiveProfile,
            assets
          };
        }

        case 'txt':
        case 'text': {
          // Si la estrategia es 'package' y existen recursos, empaquetar TXT + assets en ZIP
          if (exportOptions.imageStrategy === 'package') {
            const zb = deps.zipBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.ZipBuilder || globalThis.ZipBuilder) : null);
            if (zb && typeof zb.createZip === 'function') {
              const content = formatAsTxt(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap, imageStrategy: 'package' });
              const manifest = buildAssetManifest(entity, assets);
              const zipFiles = {
                [rawBase]: content,
                'manifest.json': JSON.stringify(manifest, null, 2)
              };
              for (const a of assets) {
                const bytes = assetBinaryMap.get(a.assetId) || assetBinaryMap.get(a.id) || assetBinaryMap.get(a.filename) || assetBinaryMap.get(a.name);
                if (bytes) {
                  if (a.filename) zipFiles[`assets/${a.filename}`] = bytes;
                }
              }

              const zipBytes = zb.createZip(zipFiles);
              return {
                filename: rawBase.replace(/\.[^.]+$/, '.zip'),
                mimeType: 'application/zip',
                data: zipBytes,
                isBinary: true,
                format: 'txt',
                profile: effectiveProfile,
                assets
              };
            }
          }

          const content = formatAsTxt(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap });
          return {
            filename,
            mimeType: 'text/plain;charset=utf-8',
            data: content,
            isBinary: false,
            format: 'txt',
            profile: effectiveProfile,
            assets
          };
        }

        case 'json': {
          const content = formatAsJson(entity);
          return {
            filename,
            mimeType: 'application/json;charset=utf-8',
            data: content,
            isBinary: false,
            format: 'json',
            profile: effectiveProfile,
            assets
          };
        }

        case 'pdf': {
          const pb = deps.pdfBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.PdfBuilder || globalThis.PdfBuilder) : null);
          if (!pb || typeof pb.buildPdf !== 'function') {
            throw new Error('PdfBuilder no está disponible para generar el PDF');
          }
          const pdfOptions = { ...exportOptions, assets, assetMap: assetBinaryMap };
          const pdfBytes = pb.buildPdfAsync ? await pb.buildPdfAsync(entity, pdfOptions) : pb.buildPdf(entity, pdfOptions);
          return {
            filename,
            mimeType: 'application/pdf',
            data: pdfBytes,
            isBinary: true,
            format: 'pdf',
            profile: effectiveProfile,
            assets
          };
        }

        case 'docx':
        case 'word': {
          const db = deps.docxBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.DocxBuilder || globalThis.DocxBuilder) : null);
          if (!db || typeof db.buildDocx !== 'function') {
            throw new Error('DocxBuilder no está disponible para generar el documento DOCX');
          }
          const docxBytes = db.buildDocx(entity, { ...exportOptions, assets, assetMap: assetBinaryMap });
          return {
            filename,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data: docxBytes,
            isBinary: true,
            format: 'docx',
            profile: effectiveProfile,
            assets
          };
        }

        case 'html': {
          const hb = deps.htmlBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.HtmlBuilder || globalThis.HtmlBuilder) : null);
          if (!hb || typeof hb.buildStandaloneHtml !== 'function') {
            throw new Error('HtmlBuilder no está disponible para generar el archivo HTML');
          }
          const htmlStr = hb.buildStandaloneHtml(entity, { ...exportOptions, assets, assetBinaryMap });
          return {
            filename,
            mimeType: 'text/html;charset=utf-8',
            data: htmlStr,
            isBinary: false,
            format: 'html',
            profile: effectiveProfile,
            assets
          };
        }

        case 'png':
        case 'image': {
          const result = await formatAsPng(entity, { ...exportOptions, assets, assetMap:assetBinaryMap });
          const finalFilename = result.isMultiPage
            ? filename.replace(/\.png$/, '.zip')
            : filename;
          const mimeType = result.isMultiPage ? 'application/zip' : 'image/png';
          return {
            filename: finalFilename,
            mimeType,
            data: result.data,
            isBinary: true,
            format: 'png',
            profile: effectiveProfile,
            pagesCount: result.pagesCount,
            assets
          };
        }

        default:
          throw new Error(`Formato no soportado: ${format}`);
      }
    }

    /**
     * Exporta un conjunto heterogéneo de entidades empaquetándolas en un archivo ZIP estructurado.
     * @param {Array<Object>} entities - Conversaciones y/o Clips
     * @param {string} format - Formato base ('md' | 'txt' | 'json' | 'pdf' | 'docx')
     * @param {string} profile - Perfil
     * @param {Object} exportOptions - Opciones adicionales
     */
    async exportBulk(entities = [], format = EXPORT_FORMATS.MARKDOWN, profile = null, exportOptions = {}) {
      if (!Array.isArray(entities) || entities.length === 0) {
        throw new Error('No hay entidades seleccionadas para exportar');
      }

      const effectiveProfile = profile || DEFAULT_PROFILE_BY_FORMAT[format] || EXPORT_PROFILES.AI;
      const zb = deps.zipBuilder || (typeof globalThis !== 'undefined' ? (globalThis.Lossy?.ZipBuilder || globalThis.ZipBuilder) : null);
      if (!zb || typeof zb.createZip !== 'function') {
        throw new Error('ZipBuilder no está disponible para generar el paquete de exportación masiva');
      }

      const files = {};
      const usedPaths=new Set();
      const manifestEntries = [];
      const now = new Date().toISOString();

      let totalEmbedded = 0;
      let totalReferenced = 0;
      let totalUnavailable = 0;

      for (let i = 0; i < entities.length; i++) {
        const ent = entities[i];
        const isClip = ent.entityType === 'clip' || (ent.canonicalId && ent.canonicalId.startsWith('clip_'));
        const subfolder = isClip ? 'clips' : 'conversations';
        const singleResult = await this.exportSingle(ent, format, effectiveProfile, exportOptions);

        let entryPath = subfolder + '/' + singleResult.filename;
        let suffix=i+1;
        while(usedPaths.has(entryPath.toLowerCase()))entryPath=subfolder+'/'+suffix+++'_'+singleResult.filename;
        usedPaths.add(entryPath.toLowerCase());
        files[entryPath] = singleResult.data;

        if (Array.isArray(singleResult.assets)) {
          totalEmbedded += singleResult.assets.filter(a => ['embedded','downloaded'].includes(a.availability)).length;
          totalReferenced += singleResult.assets.filter(a => a.availability === 'referenced').length;
          totalUnavailable += singleResult.assets.filter(a => a.availability === 'unavailable').length;
        }

        manifestEntries.push({
          id: ent.canonicalId || ent.id || `ent_${i + 1}`,
          type: isClip ? 'clip' : 'conversation',
          title: ent.title,
          path: entryPath,
          format,
          profile: effectiveProfile,
          messagesCount: (ent.messages || ent.selectedMessages || []).length,
          integrity: ent.integrity?.status || ent.integrityStatus || 'captured'
        });
      }

      // Generar Portability Manifest conforme a la Sección 19
      const portabilityManifest = {
        exportedAt: now,
        createdAt: now,
        generator: 'Lossy Unified Export Center v1.4',
        format,
        profile: effectiveProfile,
        totalEntities: entities.length,
        assets: {
          embedded: totalEmbedded,
          referenced: totalReferenced,
          unavailable: totalUnavailable,
          total: totalEmbedded + totalReferenced + totalUnavailable
        },
        entities: manifestEntries,
        options: {
          includeTechnicalEvents: Boolean(exportOptions.includeTechnicalEvents)
        },
        warnings: []
      };

      files['manifest.json'] = JSON.stringify(portabilityManifest, null, 2);

      const zipBytes = zb.createZip(files);
      const filename = `lossy-export-${format}-${Date.now()}.zip`;

      return {
        filename,
        mimeType: 'application/zip',
        data: zipBytes,
        isBinary: true,
        manifest: portabilityManifest
      };
    }
  }

  // Helper de persistencia local para Quick Exports (1 a 3 formatos configurables)
  const QUICK_EXPORTS_STORAGE_KEY = 'lossy_quick_exports_pinned';
  const DEFAULT_QUICK_EXPORTS = ['md', 'pdf', 'docx'];

  async function getPinnedQuickExports() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get([QUICK_EXPORTS_STORAGE_KEY]);
        if (Array.isArray(res[QUICK_EXPORTS_STORAGE_KEY]) && res[QUICK_EXPORTS_STORAGE_KEY].length > 0) {
          return res[QUICK_EXPORTS_STORAGE_KEY].slice(0, 3);
        }
      } else if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(QUICK_EXPORTS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, 3);
          }
        }
      }
    } catch (_) {}
    return DEFAULT_QUICK_EXPORTS;
  }

  async function setPinnedQuickExports(formats = []) {
    const valid = formats.filter(f => Object.values(EXPORT_FORMATS).includes(f)).slice(0, 3);
    const toSave = valid.length > 0 ? valid : DEFAULT_QUICK_EXPORTS;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [QUICK_EXPORTS_STORAGE_KEY]: toSave });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(QUICK_EXPORTS_STORAGE_KEY, JSON.stringify(toSave));
      }
    } catch (_) {}
    return toSave;
  }

  return {
    ExportCenter,
    AssetResolver,
    buildAssetManifest,
    EXPORT_FORMATS,
    EXPORT_PROFILES,
    DEFAULT_PROFILE_BY_FORMAT,
    ASSET_AVAILABILITY,
    cleanExportText,
    formatMessageMarkdown,
    formatAsMarkdown,
    formatAsTxt,
    formatAsJson,
    formatAsPng,
    getPinnedQuickExports,
    setPinnedQuickExports,
    getSafeFilename
  };
});
