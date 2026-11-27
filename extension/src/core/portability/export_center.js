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

  function normMimeType(m) {
    const base = String(m || '').split(';')[0].trim().toLowerCase();
    return base === 'image/jpg' ? 'image/jpeg' : base;
  }

  function isGenericMimeType(m) {
    return !m || m === 'application/octet-stream';
  }

  function isDataUriString(u) {
    return typeof u === 'string' && /^data:/i.test(u);
  }

  function parseDataUriMimeType(u) {
    return isDataUriString(u) ? normMimeType(u.slice(5).split(';')[0]) : '';
  }

  function detectMagicMimeType(bytes) {
    if (!bytes || bytes.length < 4) return '';
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && (bytes.length < 5 || bytes[4] === 0x2D)) return 'application/pdf';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return '';
  }

  function mimeFromAssetFilename(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.avif')) return 'image/avif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.ico')) return 'image/x-icon';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.xhtml')) return 'application/xhtml+xml';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
    if (lower.endsWith('.xml')) return 'application/xml';
    if (lower.endsWith('.json')) return 'application/json';
    return '';
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
      const allocateUniqueAssetId = (rawId, mIdx, aIdx) => {
        let candidate = rawId;
        let disambig = 1;
        while (seenMsgAssetIds.has(candidate)) {
          candidate = `${rawId}__u${mIdx}_${aIdx}_${disambig++}`;
        }
        seenMsgAssetIds.add(rawId);
        seenMsgAssetIds.add(candidate);
        return candidate;
      };
      const normMime = normMimeType;
      const isDataUriStr = isDataUriString;
      const parseDataUriMime = parseDataUriMimeType;
      const toRawBytes = (rawData, uri) => {
        if (rawData instanceof Uint8Array) return rawData;
        if (ArrayBuffer.isView(rawData)) return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        if (rawData instanceof ArrayBuffer) return new Uint8Array(rawData);
        if (Array.isArray(rawData) || (rawData && typeof rawData.length === 'number' && typeof rawData !== 'string')) return new Uint8Array(rawData);
        if (isDataUriStr(uri)) return dataUriToUint8Array(uri);
        return null;
      };
      const detectMagicMime = detectMagicMimeType;
      const mimeFromFilename = mimeFromAssetFilename;
      const isGenericMime = isGenericMimeType;
      const areMimesCompatible = (target, att, dataURI, localBlob) => {
        const candMime = normMime(target?.mimeType) || mimeFromFilename(target?.filename);
        const attMime = normMime(att?.mimeType);
        const blobMime = normMime(localBlob?.type);
        const uriMime = parseDataUriMime(dataURI);
        const magicMime = detectMagicMime(toRawBytes(localBlob, dataURI));
        const incomingMimes = [attMime, blobMime, uriMime, magicMime].filter(m => m && !isGenericMime(m));
        for (let i = 1; i < incomingMimes.length; i++) {
          if (incomingMimes[i] !== incomingMimes[0]) return false;
        }
        if (!isGenericMime(candMime)) {
          for (const inc of incomingMimes) {
            if (inc !== candMime) return false;
          }
          if (att?.kind === 'image' && !candMime.startsWith('image/')) return false;
        }
        return true;
      };
      let activeMessageIndex = null;
      const emittedMsgExplicitIds = new Set();
      const emittedByLocation = { fid: new Map(), ptr: new Map(), url: new Map(), uri: new Map() };
      const addAsset = asset => {
        records.push(asset);
        if (asset.fileId && !emittedByLocation.fid.has(asset.fileId)) emittedByLocation.fid.set(asset.fileId, asset);
        if (asset.assetPointer && !emittedByLocation.ptr.has(asset.assetPointer)) emittedByLocation.ptr.set(asset.assetPointer, asset);
        if (asset.sourceURL && !emittedByLocation.url.has(asset.sourceURL)) emittedByLocation.url.set(asset.sourceURL, asset);
        if (asset.dataURI && !emittedByLocation.uri.has(asset.dataURI)) emittedByLocation.uri.set(asset.dataURI, asset);
        const index = asset.messageIndex == null ? null : activeMessageIndex;
        if (!index) return;
        if (asset.fileId != null && !index.fileIds.has(asset.fileId)) index.fileIds.set(asset.fileId, asset);
        if (asset.assetId != null && !index.assetIds.has(asset.assetId)) index.assetIds.set(asset.assetId, asset);
        if (asset.assetPointer) index.pointers.add(asset.assetPointer);
        if (asset.sourceURL) index.locations.add(asset.sourceURL);
        if (asset.dataURI) index.locations.add(asset.dataURI);
      };

      // 1. Adjuntos a nivel de mensaje
      messages.forEach((msg, mIdx) => {
        const index = { fileIds: new Map(), assetIds: new Map(), pointers: new Set(), locations: new Set() };
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
          const safePtr = typeof att.assetPointer === 'string' ? att.assetPointer : null;
          const resolvedFileId = (typeof att.fileId === 'string' && att.fileId) || safePtr?.replace(/^(?:sediment|file-service):\/\//, '') || null;
          const isBareHydrationStub = !att.assetId && !att.filename && !att.name && !remoteURL && !att.fileId && !att.assetPointer && !att.kind && Boolean(dataURI) && !localBlob;
          let existing = resolvedFileId ? index.fileIds.get(resolvedFileId) : index.assetIds.get(rawAssetId);
          if (existing && !areMimesCompatible(existing, att, dataURI, localBlob)) {
            existing = null;
          }
          if (!existing && isBareHydrationStub && index.fileIds.has(rawAssetId)) {
            const candidate = index.fileIds.get(rawAssetId);
            if (candidate && !candidate.dataURI && !candidate.data && areMimesCompatible(candidate, att, dataURI, localBlob)) {
              existing = candidate;
            }
          }
          if (existing) {
            if (!existing.dataURI && dataURI) { existing.dataURI = dataURI; existing.availability = 'embedded'; index.locations.add(dataURI); emittedByLocation.uri.set(dataURI, existing); }
            if (!existing.data && localBlob) { existing.data = localBlob; existing.availability = 'embedded'; }
            return;
          }
          const scopedKey = `msg::${msgId}::${aIdx}::${rawAssetId}`;
          if (seenKeys.has(scopedKey)) return;
          seenKeys.add(scopedKey);
          emittedMsgExplicitIds.add(rawAssetId);
          const assetId = allocateUniqueAssetId(rawAssetId, mIdx, aIdx);

          const rawMime = normMime(att.mimeType);
          const extMime = mimeFromFilename(att.filename || att.name);
          const blobMime = normMime(localBlob?.type);
          const uriMime = parseDataUriMime(dataURI);
          const magicMime = detectMagicMime(toRawBytes(localBlob, dataURI));
          const resolvedAttMime =
            (!att.filename && !dataURI && blobMime && !isGenericMime(blobMime) ? blobMime : '')
            || (rawMime && !isGenericMime(rawMime) ? rawMime : '')
            || rawMime
            || extMime
            || (blobMime && !isGenericMime(blobMime) ? blobMime : '')
            || (uriMime && !isGenericMime(uriMime) ? uriMime : '');
          const mimeType = resolvedAttMime || (att.kind === 'image' ? 'image/png' : 'application/octet-stream');
          const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : (mimeType.includes('png') ? 'png' : (mimeType.includes('pdf') ? 'pdf' : 'bin'));
          const filename = att.filename || att.name || `image_${mIdx}_${aIdx}.${ext}`;
          const declaredConflicts = [rawMime, extMime, uriMime, normMime(mimeType)].filter(m => m && !isGenericMime(m));
          const hasBinaryConflict = Boolean(magicMime && declaredConflicts.some(c => c !== magicMime));
          if (hasBinaryConflict) {
            availability = ASSET_AVAILABILITY.UNAVAILABLE;
            warnings.push(`Firma binaria incompatible (${magicMime})`);
            dataURI = null;
            localBlob = null;
          }

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
            assetPointer: safePtr,
            fileId: (typeof att.fileId === 'string' && att.fileId) || safePtr?.replace(/^(?:sediment|file-service):\/\//, '') || null,
            warnings,
            error: availability === ASSET_AVAILABILITY.UNAVAILABLE ? warnings[0] : null
          });
        });

        // 2. Punteros de imagen en content.parts (ChatGPT DAG)
        if (Array.isArray(msg.content?.parts)) {
          msg.content.parts.forEach((part, pIdx) => {
            if (part && typeof part === 'object' && (part.content_type === 'image_asset_pointer' || (typeof part.asset_pointer === 'string' && part.asset_pointer))) {
              const ptr = (typeof part.asset_pointer === 'string' && part.asset_pointer)
                ? part.asset_pointer
                : ((typeof part.id === 'string' && part.id) ? part.id : `img_ptr_${mIdx}_${pIdx}`);
              if (index.pointers.has(ptr)) return;
              const rawPtrId = `ptr_${mIdx}_${pIdx}`;
              const scopedPtrKey = `ptr::${msgId}::${pIdx}`;
              if (seenKeys.has(scopedPtrKey)) return;
              seenKeys.add(scopedPtrKey);
              const assetId = allocateUniqueAssetId(rawPtrId, mIdx, pIdx);

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

        // 3. Detección de imágenes Markdown inline ![alt](url) (excluyendo bloques cercados, código inline y escapes)
        const text = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
        const nonCodeText = splitFencedCodeSegments(text)
          .filter(seg => !seg.isCode)
          .map(seg => maskInlineCodeSpans(seg.text, seg.initialContainers))
          .join('\n');
        const isEscapedBackslash = (str, idx) => {
          let bs = 0;
          for (let k = idx - 1; k >= 0 && str[k] === '\\'; k--) bs++;
          return (bs % 2) === 1;
        };
        const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        let imgIdx = 0;
        while ((match = mdImgRegex.exec(nonCodeText)) !== null) {
          if (isEscapedBackslash(nonCodeText, match.index) || isEscapedBackslash(match[1], match[1].length)) continue;
          const imgUrl = match[2].replace(/^<|>$/g, '');
          if (!imgUrl || imgUrl.includes('\u0000') || index.locations.has(imgUrl)) continue;
          const cleanAlt = match[1].replace(/\u0000CODE\u0000/g, '');
          const isInlineData = isDataUriStr(imgUrl);
          const rawMdId = `md_img_${mIdx}_${imgIdx++}`;
          const scopedKey = `md::${msgId}::${imgIdx}`;
          if (seenKeys.has(scopedKey)) continue;
          seenKeys.add(scopedKey);
          const assetId = allocateUniqueAssetId(rawMdId, mIdx, imgIdx);

          const mimeType = isInlineData ? (parseDataUriMime(imgUrl) || 'image/png') : 'image/png';
          const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
          const filename = cleanAlt ? `${cleanAlt.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24)}.${ext}` : `inline_img_${mIdx}_${imgIdx}.${ext}`;

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
        if (!att || typeof att !== 'object') return;
        const rawTopId = att.assetId || att.id || `top_asset_${aIdx}`;
        const remoteURL = att.sourceURL || att.url || null;
        const localBlob = att.data || att.blob || null;
        const dataURI = att.dataURI || null;
        const safePtr = typeof att.assetPointer === 'string' ? att.assetPointer : null;
        const topFileId = (typeof att.fileId === 'string' && att.fileId) || safePtr?.replace(/^(?:sediment|file-service):\/\//, '') || null;

        const hydrateMirror = (target) => {
          if (!target) return false;
          if (!target.dataURI && dataURI) {
            target.dataURI = dataURI;
            target.availability = ASSET_AVAILABILITY.EMBEDDED;
            emittedByLocation.uri.set(dataURI, target);
          }
          if (!target.data && localBlob) {
            target.data = localBlob;
            target.availability = ASSET_AVAILABILITY.EMBEDDED;
          }
          if (!target.data && dataURI) {
            const decoded = dataUriToUint8Array(dataURI);
            if (decoded) target.data = decoded;
          }
          return true;
        };

        const toBytes = toRawBytes;
        const bytesEqual = (aBytes, bBytes) => {
          if (!aBytes || !bBytes || aBytes.length !== bBytes.length) return false;
          for (let i = 0; i < aBytes.length; i++) if (aBytes[i] !== bBytes[i]) return false;
          return true;
        };

        let exactMirror = (topFileId && emittedByLocation.fid.get(topFileId)) ||
          (safePtr && emittedByLocation.ptr.get(safePtr)) ||
          (dataURI && emittedByLocation.uri.get(dataURI)) ||
          (remoteURL && emittedByLocation.url.get(remoteURL)) ||
          (att.sourceMessageId && records.find(r => r.sourceMessageId === att.sourceMessageId && (r.id === rawTopId || r.assetId === rawTopId))) ||
          null;

        if (exactMirror && !areMimesCompatible(exactMirror, att, dataURI, localBlob)) {
          exactMirror = null;
        }
        if (exactMirror) {
          const mirrorBytes = toBytes(exactMirror.data, exactMirror.dataURI);
          const topBytes = toBytes(localBlob, dataURI);
          const mirrorHasBinary = Boolean(mirrorBytes || exactMirror.data || exactMirror.dataURI);
          const topHasBinary = Boolean(topBytes || localBlob || dataURI);
          const topHasOwnExplicitId = Boolean(
            (att.assetId || att.id) &&
            rawTopId !== exactMirror.id &&
            rawTopId !== exactMirror.assetId &&
            (!topFileId || topFileId !== exactMirror.fileId)
          );
          let topIsDistinct = false;
          if (mirrorHasBinary && topHasBinary) {
            if (topHasOwnExplicitId) topIsDistinct = true;
            else if (mirrorBytes && topBytes) topIsDistinct = !bytesEqual(mirrorBytes, topBytes);
            else topIsDistinct = true;
          }
          if (!topIsDistinct) {
            hydrateMirror(exactMirror);
            return;
          }
        }
        if (att.sourceMessageId && (seenKeys.has(`${att.sourceMessageId}::${rawTopId}`) || emittedMsgExplicitIds.has(rawTopId)) && !localBlob && !dataURI) return;

        const topKey = `top::${rawTopId}::${aIdx}`;
        if (seenKeys.has(topKey)) return;
        seenKeys.add(topKey);
        const assetId = allocateUniqueAssetId(rawTopId, 'top', aIdx);

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
          assetPointer: safePtr,
          fileId: topFileId,
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
      const idKeys = new Set(assets.map(a => a.assetId).filter(Boolean));
      const bind = (asset, bytes, availability) => {
        const isEmbedded = availability === ASSET_AVAILABILITY.EMBEDDED;
        const mismatchReason = validateBinaryForImageAsset(asset, bytes, isEmbedded);
        if (mismatchReason) {
          asset.warnings = [...(asset.warnings || []), mismatchReason];
          asset.error = mismatchReason;
          asset.data = null;
          asset.dataURI = null;
          asset.availability = ASSET_AVAILABILITY.UNAVAILABLE;
          return;
        }
        asset.data = bytes;
        asset.availability = availability;
        assetBinaryMap.set(asset.assetId, bytes);
        if (asset.filename && !idKeys.has(asset.filename) && !assetBinaryMap.has(asset.filename)) {
          assetBinaryMap.set(asset.filename, bytes);
        }
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
            const respMime = normMimeType(mimeType);
            const extMime = mimeFromAssetFilename(asset.filename);
            const declaredImage = isDeclaredImageAsset(asset);
            if (declaredImage && respMime && !respMime.startsWith('image/') && !isGenericMimeType(respMime)) {
              throw new Error('La respuesta no contiene una imagen');
            }
            if (respMime === 'application/pdf' && extMime?.startsWith('image/')) {
              throw new Error('La respuesta PDF es incompatible con una imagen declarada');
            }
            if (isGenericMimeType(normMimeType(asset.mimeType)) && respMime?.startsWith('image/')) asset.mimeType = respMime;
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

  function isSingleLineNonParaBlockMd(cols, trimmed, canSetext = false) {
    if (cols > 3) return false;
    if (/^#{1,6}(?:[ \t]|$)/.test(trimmed)) return true;
    if (/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(trimmed)) return true;
    if (canSetext && /^(?:=+|-+)[ \t]*$/.test(trimmed)) return true;
    return false;
  }

  function measureLeadColsMd(str, startCol = 0) {
    let col = startCol;
    let i = 0;
    while (i < str.length) {
      if (str[i] === ' ') { col += 1; i++; }
      else if (str[i] === '\t') { col += 4 - (col % 4); i++; }
      else break;
    }
    return { idx: i, cols: col - startCol, endCol: col };
  }

  function stripIndentColsMd(str, startCol, targetCols) {
    let col = startCol;
    let i = 0;
    while (col < startCol + targetCols && i < str.length) {
      if (str[i] === ' ') { col += 1; i++; }
      else if (str[i] === '\t') { col += 4 - (col % 4); i++; }
      else return { ok: false, rest: str, col: startCol };
    }
    if (col < startCol + targetCols) return { ok: false, rest: str, col };
    const excess = col - (startCol + targetCols);
    const rest = (excess > 0 ? ' '.repeat(excess) : '') + str.slice(i);
    return { ok: true, rest, col: startCol + targetCols };
  }

  function matchBqPrefixMd(str, bsCol, sCol = 0, lineCol = bsCol + sCol, allowOverIndent = false) {
    const lead = measureLeadColsMd(str, lineCol);
    if ((!allowOverIndent && lead.cols > 3) || str[lead.idx] !== '>') return { ok: false };
    let i = lead.idx + 1;
    const tBase = sCol + lead.cols + 1;
    let t = tBase;
    let optCols = 0;
    let tabAdj = 0;
    if (i < str.length) {
      if (str[i] === ' ') {
        i++;
        t++;
        optCols = 1;
      } else if (str[i] === '\t') {
        optCols = 1;
        if (((bsCol + t) % 4) === 3) {
          i++;
          t++;
        } else {
          tabAdj = 1;
        }
      }
    }
    const nextBsCol = tBase + optCols;
    const nextLineCol = bsCol + t + tabAdj;
    return { ok: true, rest: str.slice(i), col: nextBsCol, bsCol: nextBsCol, lineCol: nextLineCol };
  }

  function matchListPrefixMd(str, bsSCol, canInterruptPara = true, allowEmptyInterrupt = false, lineCol = bsSCol) {
    const lead = measureLeadColsMd(str, lineCol);
    if (lead.cols > 3) return { ok: false };
    const after = str.slice(lead.idx);
    const m = after.match(/^([-*+]|\d{1,9}[.)])([ \t]+|$)/);
    if (!m) return { ok: false };
    const markerLen = m[1].length;
    const wsStartCol = bsSCol + lead.cols + markerLen;
    const wsLead = measureLeadColsMd(after.slice(markerLen), wsStartCol);
    const isEmptyItem = after.slice(markerLen + wsLead.idx).trim().length === 0;
    if (!canInterruptPara) {
      if (isEmptyItem) return { ok: false };
      if (/^\d/.test(m[1]) && m[1] !== '1.' && m[1] !== '1)') return { ok: false };
    } else if (isEmptyItem && !allowEmptyInterrupt) {
      return { ok: false };
    }
    const wsCols = isEmptyItem ? 1 : (wsLead.cols >= 5 ? 1 : wsLead.cols);
    const targetIndent = lead.cols + markerLen + wsCols;
    const stripped = stripIndentColsMd(after.slice(markerLen), wsStartCol, wsCols);
    const rest = stripped.ok ? stripped.rest : after.slice(markerLen + wsLead.idx);
    return { ok: true, indent: targetIndent, col: bsSCol + targetIndent, rest };
  }

  function stepContainerPrefixMd(line, containerList, allowBlankListSkip = true) {
    let rest = line;
    let bsCol = 0;
    let sCol = 0;
    let lineCol = 0;
    let matched = 0;
    while (matched < containerList.length) {
      const c = containerList[matched];
      if (c.type === 'bq') {
        const m = matchBqPrefixMd(rest, bsCol, sCol, lineCol, true);
        if (!m.ok) break;
        rest = m.rest;
        bsCol = m.bsCol;
        sCol = 0;
        lineCol = m.lineCol;
        matched++;
      } else {
        if (allowBlankListSkip && rest.trim().length === 0) {
          matched++;
          continue;
        }
        const s = stripIndentColsMd(rest, lineCol, c.indent);
        if (!s.ok) break;
        rest = s.rest;
        sCol += c.indent;
        lineCol += c.indent;
        matched++;
      }
    }
    return { rest, bsCol, sCol, lineCol, matched };
  }

  function createContainerStepperMd(initialContainers) {
    const containers = Array.isArray(initialContainers) ? initialContainers.map(c => ({ ...c })) : [];
    let inParagraph = false;
    return {
      get containers() { return containers; },
      get inParagraph() { return inParagraph; },
      set inParagraph(v) { inParagraph = Boolean(v); },
      step(line) {
        let { rest, bsCol, sCol, lineCol, matched } = stepContainerPrefixMd(line, containers, true);
        const exitedAnyContainer = matched < containers.length;
        const listExited = containers.slice(matched).some(c => c.type === 'list');
        let lazyKeep = false;
        if (exitedAnyContainer && inParagraph && rest.trim().length > 0) {
          const tailLead = measureLeadColsMd(rest, lineCol);
          const tailTrim = rest.slice(tailLead.idx);
          const tailInterrupts =
            isSingleLineNonParaBlockMd(tailLead.cols, tailTrim, false) ||
            matchBqPrefixMd(rest, bsCol, sCol, lineCol).ok ||
            (tailLead.cols <= 3 && /^(`{3,}[^`]*|~{3,}.*)$/.test(tailTrim)) ||
            (tailLead.cols <= 3 && /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(tailTrim));
          if (!tailInterrupts) lazyKeep = true;
        }
        if (!lazyKeep) containers.length = matched;
        let hadMarker = false;
        while (!lazyKeep && rest.trim().length > 0) {
          const bq = matchBqPrefixMd(rest, bsCol, sCol, lineCol);
          if (bq.ok) {
            containers.push({ type: 'bq' });
            rest = bq.rest;
            bsCol = bq.bsCol;
            sCol = 0;
            lineCol = bq.lineCol;
            hadMarker = true;
            continue;
          }
          const allowEmpty = !inParagraph || exitedAnyContainer || hadMarker;
          const leadBeforeList = measureLeadColsMd(rest, lineCol);
          if (leadBeforeList.cols > 3) break;
          const lst = matchListPrefixMd(rest, bsCol + sCol, !inParagraph || listExited || exitedAnyContainer || hadMarker, allowEmpty, lineCol);
          if (lst.ok) {
            containers.push({ type: 'list', indent: lst.indent });
            rest = lst.rest;
            sCol += lst.indent;
            lineCol = bsCol + sCol;
            hadMarker = true;
            continue;
          }
          break;
        }
        const col = bsCol + sCol;
        const lead = measureLeadColsMd(rest, lineCol);
        const curBqCount = containers.filter(c => c.type === 'bq').length;
        const isBlank = rest.trim().length === 0;
        const trimmedAfterLead = rest.slice(lead.idx);
        return { rest, col, lineCol, lead, curBqCount, hadMarker, isBlank, trimmedAfterLead, exitedAnyContainer };
      }
    };
  }

  function inlineSpanCrossesBlockBreakMd(s, contentStart, closePos, initialContainers) {
    const firstNl = s.indexOf('\n', contentStart);
    if (firstNl === -1 || firstNl >= closePos) return false;
    const lines = s.split('\n');
    const openLineStart = s.lastIndexOf('\n', Math.max(0, contentStart - 1)) + 1;
    let openLineIdx = 0;
    for (let pos = 0; pos < openLineStart; pos++) {
      if (s[pos] === '\n') openLineIdx++;
    }
    let closeLineIdx = openLineIdx;
    for (let pos = openLineStart; pos < closePos; pos++) {
      if (s[pos] === '\n') closeLineIdx++;
    }

    const stepper = createContainerStepperMd(initialContainers);
    for (let li = 0; li <= closeLineIdx; li++) {
      const rawLine = lines[li].replace(/\r$/, '');
      const prevPara = stepper.inParagraph;
      const { lead, hadMarker, isBlank, trimmedAfterLead, exitedAnyContainer } = stepper.step(rawLine);
      const canSetext = prevPara && !exitedAnyContainer && !hadMarker;
      const isNonPara = !isBlank && isSingleLineNonParaBlockMd(lead.cols, trimmedAfterLead, canSetext);
      const isFenceOpen = !isBlank && lead.cols <= 3 && /^(`{3,}[^`]*|~{3,}.*)$/.test(trimmedAfterLead);
      const isIndented = !isBlank && (hadMarker || !stepper.inParagraph) && lead.cols >= 4;

      if (li > openLineIdx) {
        if (isBlank || hadMarker || isNonPara || isFenceOpen || isIndented) return true;
      }
      stepper.inParagraph = !(isBlank || isNonPara || isFenceOpen || isIndented);
    }
    return false;
  }

  function splitInlineCodeSpans(str, initialContainers) {
    const s = String(str || '');
    const parts = [];
    let plainBuf = '';
    let i = 0;
    const isEscaped = (idx) => {
      let bs = 0;
      for (let k = idx - 1; k >= 0 && s[k] === '\\'; k--) bs++;
      return (bs % 2) === 1;
    };
    while (i < s.length) {
      if (s[i] === '`' && !isEscaped(i)) {
        let ticks = 0;
        while (i + ticks < s.length && s[i + ticks] === '`') ticks++;
        const delim = '`'.repeat(ticks);
        let end = i + ticks;
        let found = -1;
        while (end < s.length) {
          const pos = s.indexOf(delim, end);
          if (pos === -1) break;
          if (s[pos - 1] !== '`' && s[pos + ticks] !== '`') {
            if (!inlineSpanCrossesBlockBreakMd(s, i + ticks, pos, initialContainers)) {
              found = pos;
            }
            break;
          }
          end = pos + 1;
        }
        if (found !== -1) {
          if (plainBuf) { parts.push({ isCode: false, text: plainBuf }); plainBuf = ''; }
          parts.push({ isCode: true, text: s.slice(i, found + ticks) });
          i = found + ticks;
          continue;
        }
        plainBuf += delim;
        i += ticks;
        continue;
      }
      plainBuf += s[i++];
    }
    if (plainBuf) parts.push({ isCode: false, text: plainBuf });
    return parts;
  }

  function maskInlineCodeSpans(str, initialContainers) {
    return splitInlineCodeSpans(str, initialContainers).map(p => p.isCode ? '\u0000CODE\u0000' : p.text).join('');
  }

  function transformOutsideInlineCode(str, fn, initialContainers) {
    return splitInlineCodeSpans(str, initialContainers).map(p => p.isCode ? p.text : fn(p.text)).join('');
  }

  function splitFencedCodeSegments(text, initialContainers) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const segments = [];
    let buf = [];
    let inFence = false;
    let inIndented = false;
    let indentedBqCount = 0;
    let fenceChar = '';
    let fenceLen = 0;
    let fenceContainers = [];
    const stepper = createContainerStepperMd(initialContainers);
    let bufInitContainers = stepper.containers.map(c => ({ ...c }));

    const flush = (isCode, nextInit) => {
      if (buf.length) {
        segments.push({ isCode, text: buf.join('\n'), initialContainers: bufInitContainers });
        buf = [];
      }
      if (nextInit) bufInitContainers = nextInit.map(c => ({ ...c }));
    };
    const matchFenceContainers = (line, fcStack) => {
      if (String(line || '').trim().length === 0) {
        if (fcStack.some(c => c.type === 'bq')) return { ok: false, rest: line, lineCol: 0 };
        return { ok: true, rest: line, lineCol: 0 };
      }
      const res = stepContainerPrefixMd(line, fcStack, true);
      return { ok: res.matched === fcStack.length, rest: res.rest, lineCol: res.lineCol };
    };

    for (const line of lines) {
      const beforeLineContainers = stepper.containers.map(c => ({ ...c }));
      if (inFence) {
        const { ok, rest, lineCol } = matchFenceContainers(line, fenceContainers);
        if (!ok) {
          flush(true, beforeLineContainers);
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          fenceContainers = [];
          stepper.inParagraph = false;
        } else {
          buf.push(line);
          const closeLead = measureLeadColsMd(rest, lineCol);
          const closeM = closeLead.cols <= 3 ? rest.slice(closeLead.idx).match(/^(`{3,}|~{3,})[ \t]*$/) : null;
          if (closeM && closeM[1][0] === fenceChar && closeM[1].length >= fenceLen) {
            flush(true, stepper.containers);
            inFence = false;
            fenceChar = '';
            fenceLen = 0;
            fenceContainers = [];
          }
          stepper.inParagraph = false;
          continue;
        }
      }

      if (buf.length === 0) bufInitContainers = beforeLineContainers;
      const prevPara = stepper.inParagraph;
      const { lead, curBqCount, hadMarker, isBlank, trimmedAfterLead, exitedAnyContainer } = stepper.step(line);

      if (inIndented) {
        if (curBqCount >= indentedBqCount && (lead.cols >= 4 || isBlank)) {
          buf.push(line);
          stepper.inParagraph = false;
          continue;
        }
        flush(true, beforeLineContainers);
        inIndented = false;
        indentedBqCount = 0;
        stepper.inParagraph = false;
      }

      const openM = lead.cols <= 3 ? trimmedAfterLead.match(/^(`{3,}|~{3,})(.*)$/) : null;
      if (openM && !(openM[1][0] === '`' && openM[2].includes('`'))) {
        flush(false, beforeLineContainers);
        inFence = true;
        fenceChar = openM[1][0];
        fenceLen = openM[1].length;
        fenceContainers = stepper.containers.map(c => ({ ...c }));
        buf.push(line);
        stepper.inParagraph = false;
        continue;
      }

      if ((hadMarker || !stepper.inParagraph) && lead.cols >= 4 && !isBlank) {
        flush(false, beforeLineContainers);
        inIndented = true;
        indentedBqCount = curBqCount;
        buf.push(line);
        stepper.inParagraph = false;
        continue;
      }

      const canSetext = prevPara && !exitedAnyContainer && !hadMarker;
      const lineIsNonParaBlock = !isBlank && isSingleLineNonParaBlockMd(lead.cols, trimmedAfterLead, canSetext);
      buf.push(line);
      stepper.inParagraph = !isBlank && !lineIsNonParaBlock;
    }
    flush(inFence || inIndented);
    return segments;
  }

  function cleanExportText(text) {
    // Preserve literal examples in fenced, indented, and inline code; remove only ChatGPT control tokens.
    const isEscaped = (str, idx) => {
      let bs = 0;
      for (let k = idx - 1; k >= 0 && str[k] === '\\'; k--) bs++;
      return (bs % 2) === 1;
    };
    return splitFencedCodeSegments(text).map(seg => seg.isCode ? seg.text : transformOutsideInlineCode(seg.text, s => s
      .replace(/\uE200[\s\S]*?\uE201/g, '')
      .replace(/<(?:Cite|SuggestAutomation|DisplayAutomation)\b[^>]*\/>/gi, (m, offset, str) => (isEscaped(str, offset) ? m : ''))
      .replace(/!?\[([^\]]*)\]\(<?app:\/\/[^)>]+>?\)/g, (_, label) => label.replace(/^\$/, ''))
      .replace(/\[Imagen: (?:sediment:\/\/|file-)[^\]]*\]/g, ''), seg.initialContainers)).join('\n');
  }

  function isPlainUtf8Text(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return false;
    const sampleLen = Math.min(bytes.length, 4096);
    for (let i = 0; i < sampleLen; i++) {
      const b = bytes[i];
      if (b <= 0x08 || b === 0x0B || b === 0x0C || (b >= 0x0E && b <= 0x1F) || b === 0x7F) return false;
    }
    try {
      const slice = bytes instanceof Uint8Array ? bytes.subarray(0, Math.min(bytes.length, 262144)) : Uint8Array.from(bytes.slice(0, 262144));
      if (typeof TextDecoder !== 'undefined') {
        // Avoid trailing partial multi-byte UTF-8 failure when sampling a slice larger than 4KB
        const checkSlice = bytes.length <= 262144 ? slice : slice.subarray(0, Math.max(1, sampleLen - 4));
        new TextDecoder('utf-8', { fatal: true }).decode(checkSlice);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function decodeBytesHeadUtf8(bytes, maxLen = 8192) {
    const limit = Math.min(bytes.length, maxLen);
    if (typeof TextDecoder !== 'undefined') {
      const slice = bytes instanceof Uint8Array ? bytes.subarray(0, limit) : Uint8Array.from(bytes.slice(0, limit));
      return new TextDecoder('utf-8', { fatal: false }).decode(slice);
    }
    let out = '';
    for (let i = 0; i < limit; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function decodeUnicodeBomOrUtf16Text(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length < 2) return null;
    const len = bytes.length;
    const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);

    if (len >= 4) {
      const is32le = u8[0] === 0xFF && u8[1] === 0xFE && u8[2] === 0x00 && u8[3] === 0x00;
      const is32be = u8[0] === 0x00 && u8[1] === 0x00 && u8[2] === 0xFE && u8[3] === 0xFF;
      if (is32le || is32be) {
        let out = '';
        const limit = Math.min(len, 262144);
        for (let i = 4; i + 3 < limit; i += 4) {
          const cp = is32le
            ? (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) >>> 0
            : ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
          if (cp === 0 || cp > 0x10FFFF || (cp <= 0x08 || cp === 0x0B || cp === 0x0C || (cp >= 0x0E && cp <= 0x1F) || cp === 0x7F)) return null;
          out += String.fromCodePoint(cp);
        }
        return { text: out, complete: len <= 262144 };
      }
    }

    let utf16Mode = null;
    let startOffset = 0;
    if (u8[0] === 0xFF && u8[1] === 0xFE) {
      utf16Mode = 'le';
      startOffset = 2;
    } else if (u8[0] === 0xFE && u8[1] === 0xFF) {
      utf16Mode = 'be';
      startOffset = 2;
    } else if (len >= 4 && (len % 2) === 0) {
      const samplePairs = Math.min(len, 1024) >> 1;
      let leZeroHigh = 0, lePrintable = 0, beZeroHigh = 0, bePrintable = 0;
      const isPrint = b => (b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D;
      for (let i = 0; i < samplePairs * 2; i += 2) {
        if (u8[i + 1] === 0x00) leZeroHigh++;
        if (u8[i + 1] === 0x00 && isPrint(u8[i])) lePrintable++;
        if (u8[i] === 0x00) beZeroHigh++;
        if (u8[i] === 0x00 && isPrint(u8[i + 1])) bePrintable++;
      }
      if (leZeroHigh >= Math.ceil(samplePairs * 0.8) && lePrintable >= Math.max(2, Math.floor(samplePairs * 0.75))) utf16Mode = 'le';
      else if (beZeroHigh >= Math.ceil(samplePairs * 0.8) && bePrintable >= Math.max(2, Math.floor(samplePairs * 0.75))) utf16Mode = 'be';
    }

    if (!utf16Mode) return null;
    const limit = Math.min(len, 262144);
    const bodyLen = (limit - startOffset) & ~1;
    if (bodyLen <= 0) return null;
    let viewBytes = u8.subarray(startOffset, startOffset + bodyLen);
    if (utf16Mode === 'be') {
      const swapped = new Uint8Array(bodyLen);
      for (let i = 0; i < bodyLen; i += 2) {
        swapped[i] = viewBytes[i + 1];
        swapped[i + 1] = viewBytes[i];
      }
      viewBytes = swapped;
    }
    let decoded = '';
    if (typeof TextDecoder !== 'undefined') {
      decoded = new TextDecoder('utf-16le', { fatal: false }).decode(viewBytes);
    } else {
      for (let i = 0; i < viewBytes.length; i += 2) {
        decoded += String.fromCharCode(viewBytes[i] | (viewBytes[i + 1] << 8));
      }
    }
    for (let i = 0; i < Math.min(decoded.length, 4096); i++) {
      const c = decoded.charCodeAt(i);
      if (c <= 0x08 || c === 0x0B || c === 0x0C || (c >= 0x0E && c <= 0x1F) || c === 0x7F || c === 0xFFFD) return null;
    }
    return { text: decoded, complete: len <= 262144 };
  }

  function classifyDecodedTextMime(fullText, canParseCompleteJson) {
    const head = fullText.slice(0, 8192).replace(/^\uFEFF/, '');
    let trimmed = head.trimStart();
    let hasXmlPrologue = false;
    let hasXhtmlDoctype = false;
    let hasHtmlDoctype = false;
    let doctypeRoot = '';

    const stripComments = s => {
      let cur = s;
      while (/^<!--/.test(cur)) {
        const closeIdx = cur.indexOf('-->');
        if (closeIdx === -1) break;
        cur = cur.slice(closeIdx + 3).trimStart();
      }
      return cur;
    };

    trimmed = stripComments(trimmed);
    if (/^<\?xml\b/i.test(trimmed)) {
      hasXmlPrologue = true;
      const endXml = trimmed.indexOf('?>');
      trimmed = endXml !== -1 ? stripComments(trimmed.slice(endXml + 2).trimStart()) : '';
    }
    while (/^<\?[\w-]+\b/i.test(trimmed)) {
      const endPi = trimmed.indexOf('?>');
      if (endPi === -1) break;
      trimmed = stripComments(trimmed.slice(endPi + 2).trimStart());
    }
    const doctypeM = trimmed.match(/^<!doctype\s+([^\s\[>]+)([^>]*)>/i);
    if (doctypeM) {
      doctypeRoot = doctypeM[1].toLowerCase();
      if (/\bxhtml\b/i.test(doctypeM[0])) hasXhtmlDoctype = true;
      else if (doctypeRoot === 'html') hasHtmlDoctype = true;
      trimmed = stripComments(trimmed.slice(doctypeM[0].length).trimStart());
    }
    if (/^<svg(?=[\s>/])/i.test(trimmed)) return 'image/svg+xml';
    if (/^<html(?=[\s>/])/i.test(trimmed)) {
      const hasXhtmlNs = /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml["']/i.test(head);
      return (hasXmlPrologue || hasXhtmlDoctype || hasXhtmlNs) ? 'application/xhtml+xml' : 'text/html';
    }
    if (/^(?:<head|<body|<script|<style|<title|<meta|<iframe|<object|<embed)(?=[\s>/])/i.test(trimmed) || (hasHtmlDoctype && !hasXhtmlDoctype)) {
      return 'text/html';
    }
    if (doctypeRoot === 'svg') return 'image/svg+xml';
    if (hasXmlPrologue) return 'application/xml';

    const t = trimmed;
    if (/^(?:\{|\[|true\b|false\b|null\b|-?\d|")/.test(t)) {
      if (canParseCompleteJson) {
        try {
          JSON.parse(fullText);
          return 'application/json';
        } catch (_) {}
      } else if (/^(?:\{\s*"|\[\s*[\{\["\d\-tfn])/.test(t)) {
        return 'application/json';
      }
    }
    return null;
  }

  function detectMarkupMimeType(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return null;
    const unicodeText = decodeUnicodeBomOrUtf16Text(bytes);
    if (unicodeText) {
      return classifyDecodedTextMime(unicodeText.text, unicodeText.complete) || 'text/plain';
    }
    const utf8Head = decodeBytesHeadUtf8(bytes, 8192);
    const plain = isPlainUtf8Text(bytes);
    const fullUtf8 = plain && bytes.length <= 262144 ? decodeBytesHeadUtf8(bytes, bytes.length) : utf8Head;
    const classified = classifyDecodedTextMime(fullUtf8, plain && bytes.length <= 262144);
    if (classified) return classified;
    return plain ? 'text/plain' : null;
  }

  function isDeclaredImageAsset(asset) {
    if (!asset) return false;
    return Boolean(
      asset.kind === 'image' ||
      (typeof asset.sourceType === 'string' && asset.sourceType.includes('image')) ||
      normMimeType(asset.mimeType).startsWith('image/') ||
      parseDataUriMimeType(asset.dataURI).startsWith('image/')
    );
  }

  function areContentMimesCompatible(expected, actual) {
    if (!expected || !actual || expected === actual) return true;
    const xhtmlDocs = ['application/xhtml+xml', 'text/html', 'application/xml'];
    if (actual === 'application/xhtml+xml' && xhtmlDocs.includes(expected)) return true;
    if (expected === 'application/xhtml+xml' && actual === 'text/html') return true;
    if (expected === 'application/json' && actual === 'text/plain') return false;
    return false;
  }

  function validateBinaryForImageAsset(asset, bytes, isEmbedded) {
    const magicMime = detectMagicMimeType(bytes);
    const extMime = mimeFromAssetFilename(asset?.filename);
    const expectedMimes = [
      normMimeType(asset?.mimeType),
      extMime,
      parseDataUriMimeType(asset?.dataURI)
    ].filter(m => m && !isGenericMimeType(m));
    if (magicMime && expectedMimes.some(expected => magicMime !== expected)) {
      const expectedSummary = expectedMimes.find(m => m !== magicMime) || 'desconocido';
      return `Firma binaria incompatible (${magicMime} != ${expectedSummary})`;
    }
    const declaredImage = isDeclaredImageAsset(asset);
    const contentMime = magicMime ? null : detectMarkupMimeType(bytes);
    if (contentMime && (isEmbedded || declaredImage) && expectedMimes.some(expected => !areContentMimesCompatible(expected, contentMime))) {
      const expectedSummary = expectedMimes.find(m => !areContentMimesCompatible(m, contentMime)) || 'imagen';
      return `Contenido incompatible (${contentMime} != ${expectedSummary})`;
    }
    if ((isEmbedded || declaredImage) && isGenericMimeType(normMimeType(asset?.mimeType)) && extMime && extMime.startsWith('image/') && extMime !== 'image/svg+xml' && !magicMime) {
      return `Firma binaria no válida para imagen (${extMime})`;
    }
    return null;
  }

  function preparePackageZipAssets(assets, assetBinaryMap) {
    const zipAssets = {};
    for (const a of (assets || [])) {
      const bytes = assetBinaryMap.get(a.assetId) || assetBinaryMap.get(a.id) || assetBinaryMap.get(a.filename) || assetBinaryMap.get(a.name);
      if (!bytes) continue;
      const extMime = mimeFromAssetFilename(a.filename);
      const mismatchReason = validateBinaryForImageAsset(a, bytes, Boolean(extMime && extMime.startsWith('image/')));
      if (mismatchReason) {
        a.warnings = [...(a.warnings || []), mismatchReason];
        a.error = mismatchReason;
        a.data = null;
        a.dataURI = null;
        a.availability = ASSET_AVAILABILITY.UNAVAILABLE;
        if (a.assetId) assetBinaryMap.delete(a.assetId);
        if (a.id) assetBinaryMap.delete(a.id);
        if (a.filename) assetBinaryMap.delete(a.filename);
        if (a.name) assetBinaryMap.delete(a.name);
        continue;
      }
      if (a.filename) zipAssets[`assets/${a.filename}`] = bytes;
    }
    return zipAssets;
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
    const isEscapedBackslash = (str, idx) => {
      let bs = 0;
      for (let k = idx - 1; k >= 0 && str[k] === '\\'; k--) bs++;
      return (bs % 2) === 1;
    };
    const imgReplaced = splitFencedCodeSegments(text).map(seg => seg.isCode ? seg.text : transformOutsideInlineCode(seg.text, s => s.replace(/!\[([^\]]*)\]\(<?([^)>]+)>?\)/g, (original, alt, url, offset) => {
      if (isEscapedBackslash(s, offset) || isEscapedBackslash(alt, alt.length)) return original;
      const found = images.find(a => a.sourceURL === url || a.url === url || a.dataURI === url);
      return found ? render(found, alt) : (strategy === 'omit' ? '' : original);
    }), seg.initialContainers)).join('\n');
    const body = (!options.preserveRawWidgets && widgets && typeof widgets.renderWidgetsToMarkdown === 'function')
      ? widgets.renderWidgetsToMarkdown(imgReplaced)
      : imgReplaced;
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

  function buildSafeCodeFence(code) {
    const s = String(code || '');
    let maxRun = 0;
    let run = 0;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 96) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
    return '`'.repeat(Math.max(3, maxRun + 1));
  }

  function formatFencedCodeBlockMd(block) {
    const body = String(block?.code || '');
    const fence = buildSafeCodeFence(body);
    return `${fence}${block?.language || ''}\n${body}\n${fence}`;
  }

  function formatMessageMarkdown(message, index, options = {}) {
    const text = markdownResources(message, index, options);
    const blocks = message.codeBlocks || message.content?.codeBlocks || [];
    const hasInlineFence = splitFencedCodeSegments(text).some(seg => seg.isCode);
    const codePart = !hasInlineFence ? blocks.map(block => '\n\n' + formatFencedCodeBlockMd(block)).join('') : '';
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
        if (codeBlocks.length > 0 && !splitFencedCodeSegments(text).some(seg => seg.isCode)) {
          codeBlocks.forEach(cb => {
            lines.push(formatFencedCodeBlockMd(cb), '');
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
        if (codeBlocks.length > 0 && !splitFencedCodeSegments(text).some(seg => seg.isCode)) {
          codeBlocks.forEach(cb => {
            lines.push(formatFencedCodeBlockMd(cb), '');
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
      if (codeBlocks.length > 0 && !splitFencedCodeSegments(text).some(seg => seg.isCode)) {
        codeBlocks.forEach(cb => {
          lines.push(formatFencedCodeBlockMd(cb), '');
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
      if (codeBlocks.length > 0 && !splitFencedCodeSegments(text).some(seg => seg.isCode)) {
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
      const cleanedRaw = cleanExportText(typeof msg.text === 'string' ? msg.text : msg.content?.text);
      const text = splitFencedCodeSegments(cleanedRaw).map(seg => seg.isCode
        ? seg.text
        : transformOutsideInlineCode(seg.text, s => s.replace(/!\[[^\]]*\]\(<?[^)>]+>?\)/g, ''), seg.initialContainers)).join('\n');
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
              const zipAssets = preparePackageZipAssets(assets, assetBinaryMap);
              const content = formatAsMarkdown(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap, imageStrategy: 'package' });
              const manifest = buildAssetManifest(entity, assets);
              const zipFiles = {
                [rawBase]: content,
                'manifest.json': JSON.stringify(manifest, null, 2),
                ...zipAssets
              };

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
              const zipAssets = preparePackageZipAssets(assets, assetBinaryMap);
              const content = formatAsTxt(entity, effectiveProfile, { ...exportOptions, assets, assetBinaryMap, imageStrategy: 'package' });
              const manifest = buildAssetManifest(entity, assets);
              const zipFiles = {
                [rawBase]: content,
                'manifest.json': JSON.stringify(manifest, null, 2),
                ...zipAssets
              };

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
