/**
 * Lossy Context Portability — Generador de Documentos PDF Local-First (Zero-Dependencies)
 * Genera archivos PDF 1.4 estándar con paginación dinámica, cálculo de saltos de línea,
 * delimitación visual de turnos (Usuario vs Asistente), bloques de código y metadatos.
 * 100% Local, compatible con CSP / Manifest V3, dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Lossy = root.Lossy || root.Liner || {};
    root.Lossy.PdfBuilder = factory();
    if (root.Liner) root.Liner.PdfBuilder = root.Lossy.PdfBuilder;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Dimensiones A4 en puntos tipográficos (72 puntos/pulgada)
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN_LEFT = 45;
  const MARGIN_RIGHT = 45;
  const MARGIN_TOP = 50;
  const MARGIN_BOTTOM = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // ~505 pt

  // Mapeo seguro de caracteres UTF-8 / Latin-1 a WinAnsi para fuentes PDF estándar
  const WIN_ANSI_MAP = {
    'á': '\\341', 'é': '\\351', 'í': '\\355', 'ó': '\\363', 'ú': '\\372',
    'Á': '\\301', 'É': '\\311', 'Í': '\\315', 'Ó': '\\323', 'Ú': '\\332',
    'ñ': '\\361', 'Ñ': '\\321', 'ü': '\\374', 'Ü': '\\334',
    '¿': '\\277', '¡': '\\241', '«': '\\253', '»': '\\273',
    '—': '-', '–': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
    '•': '*', '·': '*', '…': '...', '€': 'EUR'
  };

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

  function sanitizePdfText(str) {
    if (typeof str !== 'string') return '';
    let res = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') {
        res += '\\(';
      } else if (ch === ')') {
        res += '\\)';
      } else if (ch === '\\') {
        res += '\\\\';
      } else if (ch === '\t') {
        res += '    ';
      } else if (WIN_ANSI_MAP[ch]) {
        res += WIN_ANSI_MAP[ch];
      } else {
        const code = ch.charCodeAt(0);
        if (code >= 32 && code <= 126) {
          res += ch;
        } else if (code >= 160 && code <= 255) {
          res += '\\' + code.toString(8).padStart(3, '0');
        } else {
          // Carácter fuera del rango WinAnsi estándar -> reemplazar por aproximación ASCII segura
          res += ' ';
        }
      }
    }
    return res;
  }

  // Estimador de ancho de caracteres para fuentes Helvetica (proporcional) y Courier (monoespacio)
  function estimateTextWidth(text, fontSize, isMonospace = false) {
    if (!text) return 0;
    if (isMonospace) {
      return text.length * fontSize * 0.6;
    }
    // Promedio ponderado para fuente proporcional Helvetica
    return text.length * fontSize * 0.52;
  }

  function wrapText(text, maxPts, fontSize, isMonospace = false) {
    if (!text) return [''];
    if (isMonospace) {
      const columns = Math.max(1, Math.floor(maxPts / (fontSize * 0.6)));
      return text.replace(/\t/g, '    ').split('\n').flatMap(line => line.length ? Array.from({length: Math.ceil(line.length / columns)}, (_,i) => line.slice(i * columns, (i+1) * columns)) : ['']);
    }
    const paragraphs = text.split('\n');
    const lines = [];

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }

      const maxChars = Math.max(1, Math.floor(maxPts / (fontSize * 0.52)));
      const words = paragraph.split(/\s+/).flatMap(word => word.length > maxChars ? word.match(new RegExp('.{1,' + maxChars + '}', 'g')) : [word]);
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const width = estimateTextWidth(candidate, fontSize, isMonospace);
        if (width <= maxPts || !currentLine) {
          currentLine = candidate;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines;
  }

  /**
   * Parser ligero y determinista de cabeceras de imagen (JPEG / PNG)
   */
  function parseImageHeader(bytes) {
    if (!bytes || bytes.length < 8) return null;

    // 1. JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xFF) break;
        const marker = bytes[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) { // SOF0 o SOF2
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { format: 'jpeg', width, height };
        }
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + len;
      }
      return { format: 'jpeg', width: 400, height: 300 };
    }

    // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 33 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      const bitDepth = bytes[24];
      const colorType = bytes[25];

      let offset = 8;
      const idats = [];
      while (offset + 12 <= bytes.length) {
        const len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (len < 0 || offset + len + 12 > bytes.length) return null;
        if (type === 'IDAT') {
          idats.push(bytes.subarray(offset + 8, offset + 8 + len));
        }
        offset += 12 + len;
      }

      let idatData;
      if (typeof Buffer !== 'undefined' && Buffer.concat) {
        idatData = Buffer.concat(idats);
      } else {
        const total = idats.reduce((s, b) => s + b.length, 0);
        idatData = new Uint8Array(total);
        let pos = 0;
        for (const b of idats) {
          idatData.set(b, pos);
          pos += b.length;
        }
      }

      return {
        format: 'png',
        width: width || 400,
        height: height || 300,
        bitDepth,
        interlace: bytes[28],
        colorType,
        idatData
      };
    }

    return null;
  }

  /**
   * Generador estructurado de documentos PDF.
   */

  // Flatten alpha on paper white. PNG filters are scanline predictors, not RGB bytes.
  function decodePngRGB(header) {
    if (typeof require !== 'function' || header.bitDepth !== 8 || header.interlace !== 0) return undefined;
    const channels = {0:1, 2:3, 4:2, 6:4}[header.colorType];
    if (!channels || header.width * header.height > 25000000) return undefined;
    const stride = header.width * channels;
    const raw = require('node:zlib').inflateSync(header.idatData, {maxOutputLength: (stride + 1) * header.height});
    if (raw.length !== (stride+1) * header.height) return undefined;
    let previous = new Uint8Array(stride);
    const rgb = new Uint8Array(header.width * header.height * 3);
    const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y && x<=z ? a : y<=z ? b : c; };
    for (let y=0; y<header.height; y++) {
      const filter=raw[y*(stride+1)];
      if (filter>4) return undefined;
      const row=new Uint8Array(stride);
      for (let x=0;x<stride;x++) {
        const a=x>=channels ? row[x-channels] : 0, b=previous[x], c=x>=channels ? previous[x-channels] : 0;
        const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
        row[x]=(raw[y*(stride+1)+1+x]+predictor)&255;
      }
      for (let x=0;x<header.width;x++) {
        const pos=x*channels;
        const alpha=channels===2 || channels===4 ? row[pos+channels-1]/255 : 1;
        for (let c=0;c<3;c++) rgb[(y*header.width+x)*3+c]=Math.round((channels<=2 ? row[pos] : row[pos+c])*alpha+255*(1-alpha));
      }
      previous=row;
    }
    return rgb;
  }

  async function buildPdfAsync(entity, options = {}) {
    // Browser codecs decode PNG alpha, palette PNG and WebP before native PDF assembly.
    if (typeof createImageBitmap !== 'function') return buildPdf(entity, options);
    const assetMap = new Map(options.assetMap instanceof Map ? options.assetMap : Object.entries(options.assetMap || {}));
    for (const asset of options.assets || []) {
      const bytes=assetMap.get(asset.assetId) || asset.data;
      if (!(bytes instanceof Uint8Array) || (bytes[0]===255 && bytes[1]===216)) continue;
      let bitmap;
      try {
        bitmap=await createImageBitmap(new Blob([bytes], {type:asset.mimeType}));
        const canvas=typeof OffscreenCanvas==='function' ? new OffscreenCanvas(bitmap.width,bitmap.height) : document.createElement('canvas');
        canvas.width=bitmap.width; canvas.height=bitmap.height;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);
        const blob=canvas.convertToBlob ? await canvas.convertToBlob({type:'image/jpeg',quality:0.96}) : await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.96));
        if (!blob) throw new Error('No se pudo convertir la imagen');
        const converted=new Uint8Array(await blob.arrayBuffer());
        for (const key of [asset.assetId,asset.id,asset.filename]) if (key) assetMap.set(key,converted);
      } catch (error) {
        asset.warnings = [...(asset.warnings || []), 'Imagen no decodificable: ' + error.message];
      } finally { bitmap?.close(); }
    }
    return buildPdf(entity, {...options,assetMap});
  }

  function buildPdf(entity, options = {}) {
    if (!entity || typeof entity !== 'object') {
      throw new Error('Entidad inválida para exportación a PDF');
    }

    const title = entity.title || 'Conversación';
    const platform = (entity.source?.platform || entity.sourcePlatform || entity.platform || 'ChatGPT').toUpperCase();
    const model = entity.model || entity.sourceModel || 'Estándar';
    const integrity = entity.integrity?.status || entity.integrityStatus || 'Capturado';
    const dateStr = entity.updatedAt || entity.createdAt ? new Date(entity.updatedAt || entity.createdAt).toLocaleDateString() : new Date().toLocaleDateString();

    const rawMessages = Array.isArray(entity.selectedMessages)
      ? entity.selectedMessages
      : (Array.isArray(entity.messages) ? entity.messages : []);

    const includeTechnicalEvents = Boolean(options.includeTechnicalEvents);

    const messagesToRender = rawMessages.filter(m => {
      if (includeTechnicalEvents) return true;
      if (m.isConversational === false) return false;
      return m.role === 'user' || m.role === 'assistant';
    });

    const docImages = [];
    const assetMap = options.assetMap || options.assetsMap || new Map();
    const getAssetBinary = (key) => {
      if (!key) return null;
      if (assetMap instanceof Map) return assetMap.get(key);
      if (typeof assetMap === 'object') return assetMap[key];
      return null;
    };

    const pages = [];
    let currentStreams = [];
    let currentY = PAGE_HEIGHT - MARGIN_TOP;

    function startNewPage() {
      if (currentStreams.length > 0 || pages.length > 0) {
        pages.push(currentStreams.join('\n'));
        currentStreams = [];
      }
      currentY = PAGE_HEIGHT - MARGIN_TOP;

      // Encabezado superior de página continua
      if (pages.length > 0) {
        currentStreams.push('q');
        currentStreams.push('0.5 0.5 0.5 rg'); // Gris tenue
        currentStreams.push('BT /F1 8.5 Tf');
        currentStreams.push(`${MARGIN_LEFT} ${PAGE_HEIGHT - 32} Td (${sanitizePdfText(title.substring(0, 50))}) Tj ET`);
        currentStreams.push('0.85 0.85 0.85 RG 0.5 w');
        currentStreams.push(`${MARGIN_LEFT} ${PAGE_HEIGHT - 38} m ${PAGE_WIDTH - MARGIN_RIGHT} ${PAGE_HEIGHT - 38} l S`);
        currentStreams.push('Q');
        currentY = PAGE_HEIGHT - MARGIN_TOP - 15;
      }
    }

    function ensureVerticalSpace(neededPts) {
      if (currentY - neededPts < MARGIN_BOTTOM) {
        startNewPage();
      }
    }

    // 1. Iniciar primera página
    startNewPage();

    // 2. Portada / Cabecera de Documento
    currentStreams.push('q');
    // Fondo de tarjeta de metadatos
    currentStreams.push('0.96 0.96 0.97 rg');
    currentStreams.push(`${MARGIN_LEFT} ${currentY - 60} ${CONTENT_WIDTH} 60 re f`);
    currentStreams.push('0.82 0.82 0.85 RG 0.75 w');
    currentStreams.push(`${MARGIN_LEFT} ${currentY - 60} ${CONTENT_WIDTH} 60 re S`);

    // Título Principal
    currentStreams.push('0.08 0.08 0.1 rg');
    currentStreams.push('BT /F2 15 Tf');
    currentStreams.push(`${MARGIN_LEFT + 14} ${currentY - 22} Td (${sanitizePdfText(title.substring(0, 65))}) Tj ET`);

    // Metadatos
    currentStreams.push('0.35 0.35 0.4 rg');
    currentStreams.push('BT /F1 9 Tf');
    const metaLine = `${platform} · Modelo: ${model} · Integridad: ${integrity} · Fecha: ${dateStr}`;
    currentStreams.push(`${MARGIN_LEFT + 14} ${currentY - 42} Td (${sanitizePdfText(metaLine)}) Tj ET`);
    currentStreams.push('Q');

    currentY -= 76;

    // 3. Renderizado de Mensajes en Orden Cronológico
    messagesToRender.forEach((msg, idx) => {
      const isUser = msg.role === 'user';
      const isAssistant = msg.role === 'assistant';
      const isTool = msg.role === 'tool';
      const roleLabel = isUser ? 'USUARIO' : (isAssistant ? 'CHATGPT' : (isTool ? 'HERRAMIENTA' : (msg.role || 'SISTEMA').toUpperCase()));

      const originalText = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
      const text = originalText.replace(/\uE200[\s\S]*?\uE201/g, '').replace(/!\[[^\]]*\]\(<?[^)>]+>?\)/g, '').replace(/\x60\x60\x60[^\n]*\n[\s\S]*?\x60\x60\x60/g, '');
      const storedCode = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
      const codeBlocks = storedCode.length ? storedCode : Array.from(originalText.matchAll(/\x60\x60\x60([^\n]*)\n([\s\S]*?)\x60\x60\x60/g), match => ({language:match[1].trim(),code:match[2].replace(/\n$/, '')}));

      ensureVerticalSpace(45);

      // Etiqueta de Rol con pastilla de color
      currentStreams.push('q');
      if (isUser) {
        currentStreams.push('0.15 0.45 0.85 rg'); // Azul sobrio
      } else if (isAssistant) {
        currentStreams.push('0.1 0.6 0.35 rg');  // Verde esmeralda sobrio
      } else {
        currentStreams.push('0.5 0.5 0.55 rg');  // Gris pizarra
      }

      // Pastilla de fondo para el rol
      const roleBadgeWidth = Math.max(estimateTextWidth(roleLabel, 8.5) + 12, 54);
      currentStreams.push(`${MARGIN_LEFT} ${currentY - 14} ${roleBadgeWidth} 14 re f`);

      // Texto de etiqueta de rol en blanco
      currentStreams.push('1 1 1 rg');
      currentStreams.push('BT /F2 8.5 Tf');
      currentStreams.push(`${MARGIN_LEFT + 6} ${currentY - 10.5} Td (${sanitizePdfText(roleLabel)}) Tj ET`);

      // Línea divisoria tenue a la derecha del rol
      currentStreams.push('0.88 0.88 0.9 RG 0.5 w');
      currentStreams.push(`${MARGIN_LEFT + roleBadgeWidth + 8} ${currentY - 7} m ${PAGE_WIDTH - MARGIN_RIGHT} ${currentY - 7} l S`);
      currentStreams.push('Q');

      currentY -= 22;

      // Párrafos del mensaje
      const bodyLines = wrapText(text, CONTENT_WIDTH - 12, 10, false);
      for (const line of bodyLines) {
        ensureVerticalSpace(14);
        if (line) {
          currentStreams.push('q');
          currentStreams.push('0.12 0.12 0.14 rg');
          currentStreams.push('BT /F1 10 Tf');
          currentStreams.push(`${MARGIN_LEFT + 6} ${currentY - 10} Td (${sanitizePdfText(line)}) Tj ET`);
          currentStreams.push('Q');
        }
        currentY -= 13.5;
      }

      // Bloques de código adjuntos
      if (codeBlocks.length > 0) {
        codeBlocks.forEach(cb => {
          const lang = cb.language ? ` [${cb.language.toUpperCase()}]` : '';
          const codeText = typeof cb.code === 'string' ? cb.code : '';
          const codeLines = wrapText(codeText, CONTENT_WIDTH - 24, 8.5, true);

          if (codeLines.length === 0) return;

          let lineIdx = 0;
          while (lineIdx < codeLines.length) {
            // Asegurar espacio para al menos cabecera + 1 línea en la página actual
            if (currentY - MARGIN_BOTTOM < 45) {
              startNewPage();
            }

            const isFirstChunk = (lineIdx === 0);
            const headerSpace = isFirstChunk ? 16 : 12;
            const availablePts = currentY - MARGIN_BOTTOM - headerSpace - 10;
            const maxLinesThisPage = Math.max(1, Math.floor(availablePts / 11));
            const linesThisChunk = codeLines.slice(lineIdx, lineIdx + maxLinesThisPage);
            const isLastChunk = (lineIdx + linesThisChunk.length >= codeLines.length);
            const chunkHeight = (linesThisChunk.length * 11) + headerSpace + (isLastChunk ? 8 : 4);

            // Fondo caja de código para el fragmento de la página actual
            currentStreams.push('q');
            currentStreams.push('0.12 0.13 0.15 rg'); // Gris oscuro
            currentStreams.push(`${MARGIN_LEFT + 6} ${(currentY - chunkHeight).toFixed(2)} ${CONTENT_WIDTH - 12} ${chunkHeight.toFixed(2)} re f`);
            currentStreams.push('0.25 0.26 0.3 RG 0.5 w');
            currentStreams.push(`${MARGIN_LEFT + 6} ${(currentY - chunkHeight).toFixed(2)} ${CONTENT_WIDTH - 12} ${chunkHeight.toFixed(2)} re S`);

            // Cabecera del bloque de código
            currentStreams.push(isFirstChunk ? '0.6 0.65 0.7 rg' : '0.45 0.5 0.55 rg');
            currentStreams.push('BT /F3 7.5 Tf');
            const headerLabel = isFirstChunk ? ('CODIGO' + lang) : ('CODIGO' + lang + ' (cont.)');
            currentStreams.push(`${MARGIN_LEFT + 12} ${(currentY - (isFirstChunk ? 9 : 8)).toFixed(2)} Td (${sanitizePdfText(headerLabel)}) Tj ET`);
            currentStreams.push('Q');

            let codeY = currentY - (isFirstChunk ? 18 : 14);
            for (const cLine of linesThisChunk) {
              if (cLine) {
                currentStreams.push('q');
                currentStreams.push('0.85 0.9 0.95 rg'); // Texto claro en caja oscura
                currentStreams.push('BT /F3 8.5 Tf');
                currentStreams.push(`${MARGIN_LEFT + 12} ${(codeY - 8).toFixed(2)} Td (${sanitizePdfText(cLine)}) Tj ET`);
                currentStreams.push('Q');
              }
              codeY -= 11;
            }

            currentY -= (chunkHeight + (isLastChunk ? 8 : 0));
            lineIdx += linesThisChunk.length;

            if (!isLastChunk) {
              startNewPage();
            }
          }
        });
      }

      // 4. Recursos visuales e imágenes asociadas (ASSET-RED-001)
      const assetMap = options.assetMap || options.assetsMap || new Map();
      const getAssetBinary = (key) => {
        if (!key) return null;
        if (assetMap instanceof Map) return assetMap.get(key);
        if (typeof assetMap === 'object') return assetMap[key];
        return null;
      };

      const msgAttachments = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.content?.attachments) ? msg.content.attachments : []);
      const associatedAssets = (Array.isArray(options.assets) ? options.assets : []).filter(a =>
        a.sourceMessageId === msg.id || a.messageIndex === idx
      );

      const allMsgImages = (options.imageStrategy === 'omit' ? [] : [...associatedAssets, ...msgAttachments]).filter(att =>
        att && (att.kind === 'image' || (att.mimeType && att.mimeType.startsWith('image/')) || (att.sourceType && att.sourceType.includes('image')))
      );

      const seenAssetKeys = new Set();
      const uniqueMsgImages = allMsgImages.filter(img => {
        const key = img.assetId || img.id || img.sourceURL || img.url || img.filename || img.name || img;
        if (seenAssetKeys.has(key)) return false;
        seenAssetKeys.add(key);
        return true;
      });

      uniqueMsgImages.forEach(img => {
        let rawBinary = getAssetBinary(img.assetId) ||
                        getAssetBinary(img.id) ||
                        getAssetBinary(img.filename) ||
                        getAssetBinary(img.name) ||
                        img.data || img.bytes;

        if (!rawBinary && img.dataURI && img.dataURI.includes(',')) {
          rawBinary = dataUriToUint8Array(img.dataURI);
        }

        const isBinaryAvailable = rawBinary && (rawBinary instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBinary)) || rawBinary.length > 0);

        let safeHeader;
        let rawRGB;
        if (isBinaryAvailable) {
          safeHeader = parseImageHeader(rawBinary);
          try { if (safeHeader?.format === 'png') rawRGB = decodePngRGB(safeHeader); } catch (error) { safeHeader = undefined; }
        }
        const supported = safeHeader?.format === 'jpeg' || rawRGB || (safeHeader?.format === 'png' && safeHeader.bitDepth === 8 && safeHeader.interlace === 0 && [0,2].includes(safeHeader.colorType));
        if (isBinaryAvailable && supported) {
          const imgBytes = rawBinary instanceof Uint8Array ? rawBinary : new Uint8Array(rawBinary);
          const header = parseImageHeader(imgBytes);
          const imgWidth = (header && header.width) || img.width || 400;
          const imgHeight = (header && header.height) || img.height || 300;
          const aspect = imgHeight / imgWidth;

          const maxRenderWidth = CONTENT_WIDTH - 24;
          const maxRenderHeight = 260;

          let renderW = maxRenderWidth;
          let renderH = renderW * aspect;
          if (renderH > maxRenderHeight) {
            renderH = maxRenderHeight;
            renderW = renderH / aspect;
          }

          ensureVerticalSpace(renderH + 26);

          const imgId = `Img${docImages.length + 1}`;
          const isJpeg = (header && header.format === 'jpeg') || (img.mimeType && (img.mimeType.includes('jpeg') || img.mimeType.includes('jpg')));

          docImages.push({
            id: imgId,
            bytes: imgBytes,
            width: imgWidth,
            height: imgHeight,
            format: isJpeg ? 'jpeg' : 'png',
            header,
            rawRGB
          });

          // Marco y fondo del artefacto gráfico
          currentStreams.push('q');
          currentStreams.push('0.92 0.92 0.94 RG 0.5 w');
          currentStreams.push(`${MARGIN_LEFT + 6} ${currentY - renderH - 4} ${(renderW + 8).toFixed(2)} ${(renderH + 8).toFixed(2)} re S`);

          // Renderizar XObject
          currentStreams.push(`${renderW.toFixed(2)} 0 0 ${renderH.toFixed(2)} ${(MARGIN_LEFT + 10).toFixed(2)} ${(currentY - renderH).toFixed(2)} cm`);
          currentStreams.push(`/${imgId} Do % /Do paint XObject`);
          currentStreams.push('Q');

          currentY -= (renderH + 18);
        } else {
          // Fallback honesto: Card delimitada con procedencia sin IDs crudos
          ensureVerticalSpace(38);
          const fallbackName = img.filename || img.name || 'imagen';
          currentStreams.push('q');
          currentStreams.push('0.97 0.97 0.97 rg');
          currentStreams.push('0.82 0.82 0.85 RG 0.5 w');
          currentStreams.push(`${MARGIN_LEFT + 6} ${currentY - 30} ${CONTENT_WIDTH - 12} 30 re f`);
          currentStreams.push(`${MARGIN_LEFT + 6} ${currentY - 30} ${CONTENT_WIDTH - 12} 30 re S`);
          currentStreams.push('0.35 0.35 0.4 rg');
          currentStreams.push('BT /F1 9 Tf');
          currentStreams.push(`${MARGIN_LEFT + 14} ${currentY - 14} Td (${sanitizePdfText(`[Recurso visual no disponible en la exportacion: ${fallbackName}]`)}) Tj ET`);
          currentStreams.push('0.5 0.5 0.55 rg');
          currentStreams.push('BT /F1 7.5 Tf');
          currentStreams.push(`${MARGIN_LEFT + 14} ${currentY - 24} Td (${sanitizePdfText('Actualiza la captura con ChatGPT abierto para recuperar esta imagen.')}) Tj ET`);
          currentStreams.push('Q');
          currentY -= 36;
        }
      });

      currentY -= 12; // Separación entre turnos
    });

    // Guardar última página
    if (currentStreams.length > 0) {
      pages.push(currentStreams.join('\n'));
    }

    const totalPages = pages.length;

    // 4. Inyección de números de página finales en cada página
    const renderedPageStreams = pages.map((streamContent, pageIdx) => {
      const footerStream = [
        'q',
        '0.55 0.55 0.6 rg',
        'BT /F1 8 Tf',
        `${MARGIN_LEFT} ${MARGIN_BOTTOM - 20} Td (${sanitizePdfText('Lossy / Archivo de conversación / Local')}) Tj ET`,
        'BT /F1 8 Tf',
        `${PAGE_WIDTH - MARGIN_RIGHT - 65} ${MARGIN_BOTTOM - 20} Td (${sanitizePdfText(`Pagina ${pageIdx + 1} de ${totalPages}`)}) Tj ET`,
        'Q'
      ].join('\n');
      return `${streamContent}\n${footerStream}`;
    });

    // 5. Ensamblado del Estándar PDF 1.4 con Tabla XREF Determinista
    return assemblePdfDocument(renderedPageStreams, docImages);
  }

  function assemblePdfDocument(pageContents, docImages = []) {
    const textEncoder = new TextEncoder();
    const chunks = [];
    const xrefOffsets = [];
    let currentByteOffset = 0;

    function pushStr(str) {
      const bytes = textEncoder.encode(str);
      chunks.push(bytes);
      currentByteOffset += bytes.length;
    }

    // Cabecera PDF 1.4 con comentario binario para preservar integridad 8-bit
    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const totalPages = pageContents.length;
    const pageObjStart = 3;
    const contentObjStart = pageObjStart + totalPages;
    const font1Obj = contentObjStart + totalPages;
    const font2Obj = font1Obj + 1;
    const font3Obj = font2Obj + 1;
    const imageObjStart = font3Obj + 1;
    const totalObjects = font3Obj + docImages.length;

    // 1 0 obj: Catálogo
    xrefOffsets[1] = currentByteOffset;
    pushStr(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

    // 2 0 obj: Diccionario de Páginas
    xrefOffsets[2] = currentByteOffset;
    const kids = Array.from({ length: totalPages }, (_, i) => `${pageObjStart + i} 0 R`).join(' ');
    pushStr(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${totalPages} >>\nendobj\n`);

    const xObjectDict = docImages.length > 0
      ? ` /XObject << ${docImages.map((im, idx) => `/${im.id} ${imageObjStart + idx} 0 R`).join(' ')} >>`
      : '';

    // 3..(3+N-1) objs: Diccionarios de Página individual
    for (let i = 0; i < totalPages; i++) {
      const pObjId = pageObjStart + i;
      const cObjId = contentObjStart + i;
      xrefOffsets[pObjId] = currentByteOffset;
      pushStr(
        `${pObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R\n` +
        `   /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}]\n` +
        `   /Contents ${cObjId} 0 R\n` +
        `   /Resources << /Font << /F1 ${font1Obj} 0 R /F2 ${font2Obj} 0 R /F3 ${font3Obj} 0 R >>${xObjectDict} >>\n` +
        `>>\nendobj\n`
      );
    }

    // Streams de Contenido de Página
    for (let i = 0; i < totalPages; i++) {
      const cObjId = contentObjStart + i;
      const streamBytes = textEncoder.encode(pageContents[i]);
      xrefOffsets[cObjId] = currentByteOffset;
      pushStr(`${cObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
      chunks.push(streamBytes);
      currentByteOffset += streamBytes.length;
      pushStr(`\nendstream\nendobj\n`);
    }

    // Fuentes Estándar Type 1 con Codificación WinAnsi
    xrefOffsets[font1Obj] = currentByteOffset;
    pushStr(`${font1Obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);

    xrefOffsets[font2Obj] = currentByteOffset;
    pushStr(`${font2Obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

    xrefOffsets[font3Obj] = currentByteOffset;
    pushStr(`${font3Obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n`);

    // Inyección de Image XObjects
    docImages.forEach((im, idx) => {
      const objId = imageObjStart + idx;
      xrefOffsets[objId] = currentByteOffset;
      const isJpeg = im.format === 'jpeg';
      if (im.rawRGB) {
        pushStr(objId + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.width + ' /Height ' + im.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ' + im.rawRGB.length + ' >>\nstream\n');
        chunks.push(im.rawRGB); currentByteOffset += im.rawRGB.length;
        pushStr('\nendstream\nendobj\n');
      } else if (isJpeg) {
        pushStr(`${objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
        chunks.push(im.bytes);
        currentByteOffset += im.bytes.length;
        pushStr('\nendstream\nendobj\n');
      } else {
        const idat = im.header?.idatData;
        if (idat && idat.length > 0) {
          pushStr(`${objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace ${im.header.colorType === 0 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${im.header.colorType === 0 ? 1 : 3} /BitsPerComponent 8 /Columns ${im.width} >> /Length ${idat.length} >>\nstream\n`);
          chunks.push(idat);
          currentByteOffset += idat.length;
          pushStr('\nendstream\nendobj\n');
        } else {
          pushStr(`${objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
          chunks.push(im.bytes);
          currentByteOffset += im.bytes.length;
          pushStr('\nendstream\nendobj\n');
        }
      }
    });

    // Tabla de Referencias Cruzadas (XREF)
    const startXref = currentByteOffset;
    pushStr(`xref\n0 ${totalObjects + 1}\n`);
    pushStr(`0000000000 65535 f \n`);
    for (let i = 1; i <= totalObjects; i++) {
      const offset = (xrefOffsets[i] || 0).toString().padStart(10, '0');
      pushStr(`${offset} 00000 n \n`);
    }

    // Tráiler y Fin de Archivo (EOF)
    pushStr(
      `trailer\n` +
      `<< /Size ${totalObjects + 1}\n` +
      `   /Root 1 0 R >>\n` +
      `startxref\n` +
      `${startXref}\n` +
      `%%EOF\n`
    );

    // Concatenar todos los fragmentos a un único Uint8Array continuo
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }

    return result;
  }

  return {
    buildPdf,
    buildPdfAsync,
    estimateTextWidth,
    wrapText,
    sanitizePdfText
  };
});
