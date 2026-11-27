/**
 * Lossy Context Portability — Generador de Documentos Word (.docx) Local-First (Zero-Dependencies)
 * Ensambla paquetes OpenXML (ECMA-376) estándar con ZipBuilder sin dependencias externas ni backend.
 * Compatible con Microsoft Word, LibreOffice, Apple Pages y Google Docs.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const zipBuilder = require('./zip_builder.js');
    module.exports = factory(zipBuilder);
  } else {
    root.Lossy = root.Lossy || root.Liner || {};
    const zipBuilder = root.Lossy.ZipBuilder || root.Liner?.ZipBuilder;
    root.Lossy.DocxBuilder = factory(zipBuilder);
    if (root.Liner) root.Liner.DocxBuilder = root.Lossy.DocxBuilder;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (zipBuilderModule) {
  'use strict';

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

  function escapeXml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function getZipBuilder() {
    if (zipBuilderModule && typeof zipBuilderModule.createZip === 'function') {
      return zipBuilderModule;
    }
    if (typeof globalThis !== 'undefined') {
      const g = globalThis;
      if (g.Lossy && g.Lossy.ZipBuilder) return g.Lossy.ZipBuilder;
      if (g.Liner && g.Liner.ZipBuilder) return g.Liner.ZipBuilder;
      if (typeof ZipBuilder !== 'undefined') return ZipBuilder;
    }
    throw new Error('ZipBuilder no está disponible para construir el paquete DOCX');
  }

  /**
   * Genera el XML de [Content_Types].xml
   */
  function buildContentTypesXml(images = []) {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Default Extension="png" ContentType="image/png"/>\n' +
      '  <Default Extension="jpeg" ContentType="image/jpeg"/>\n' +
      '  <Default Extension="jpg" ContentType="image/jpeg"/>\n' +
      '  <Default Extension="gif" ContentType="image/gif"/>\n' +
      '  <Default Extension="webp" ContentType="image/webp"/>\n' +
      '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n' +
      '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n' +
      '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n' +
      '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n' +
      '</Types>'
    );
  }

  /**
   * Genera el XML de _rels/.rels
   */
  function buildRootRelsXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
      '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n' +
      '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n' +
      '</Relationships>'
    );
  }

  /**
   * Genera el XML de word/_rels/document.xml.rels con soporte de imágenes DrawingML
   */
  function buildDocumentRelsXml(images = []) {
    const imgRels = (Array.isArray(images) ? images : []).map(img =>
      `  <Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.filename}"/>`
    ).join('\n');

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n' +
      (imgRels ? `${imgRels}\n` : '') +
      '</Relationships>'
    );
  }

  /**
   * Genera el XML de docProps/core.xml
   */
  function buildCorePropsXml(entity) {
    const title = entity.title || 'Conversación';
    const now = new Date().toISOString();
    const created = entity.createdAt || now;
    const modified = entity.updatedAt || now;

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
      `  <dc:title>${escapeXml(title)}</dc:title>\n` +
      '  <dc:creator>Lossy AI Context Portability</dc:creator>\n' +
      '  <cp:lastModifiedBy>Lossy</cp:lastModifiedBy>\n' +
      `  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(created)}</dcterms:created>\n` +
      `  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(modified)}</dcterms:modified>\n` +
      '</cp:coreProperties>'
    );
  }

  /**
   * Genera el XML de docProps/app.xml
   */
  function buildAppPropsXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n' +
      '  <Application>Lossy Context Portability</Application>\n' +
      '  <DocSecurity>0</DocSecurity>\n' +
      '</Properties>'
    );
  }

  /**
   * Genera el XML de word/styles.xml con estilos limpios
   */
  function buildStylesXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
      '  <w:docDefaults>\n' +
      '    <w:rPrDefault>\n' +
      '      <w:rPr>\n' +
      '        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>\n' +
      '        <w:sz w:val="22"/>\n' + // 11pt
      '        <w:szCs w:val="22"/>\n' +
      '        <w:color w:val="1F1F1F"/>\n' +
      '      </w:rPr>\n' +
      '    </w:rPrDefault>\n' +
      '    <w:pPrDefault>\n' +
      '      <w:pPr>\n' +
      '        <w:spacing w:after="160" w:line="260" w:lineRule="auto"/>\n' +
      '      </w:pPr>\n' +
      '    </w:pPrDefault>\n' +
      '  </w:docDefaults>\n' +
      '  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">\n' +
      '    <w:name w:val="Normal"/>\n' +
      '  </w:style>\n' +
      '  <w:style w:type="paragraph" w:styleId="Title">\n' +
      '    <w:name w:val="Title"/>\n' +
      '    <w:rPr>\n' +
      '      <w:b/>\n' +
      '      <w:sz w:val="40"/>\n' + // 20pt
      '      <w:color w:val="111827"/>\n' +
      '    </w:rPr>\n' +
      '    <w:pPr>\n' +
      '      <w:spacing w:before="120" w:after="180"/>\n' +
      '    </w:pPr>\n' +
      '  </w:style>\n' +
      '  <w:style w:type="paragraph" w:styleId="RoleHeaderUser">\n' +
      '    <w:name w:val="RoleHeaderUser"/>\n' +
      '    <w:rPr>\n' +
      '      <w:b/>\n' +
      '      <w:sz w:val="24"/>\n' + // 12pt
      '      <w:color w:val="1D4ED8"/>\n' + // Azul
      '    </w:rPr>\n' +
      '    <w:pPr>\n' +
      '      <w:spacing w:before="240" w:after="80"/>\n' +
      '    </w:pPr>\n' +
      '  </w:style>\n' +
      '  <w:style w:type="paragraph" w:styleId="RoleHeaderAssistant">\n' +
      '    <w:name w:val="RoleHeaderAssistant"/>\n' +
      '    <w:rPr>\n' +
      '      <w:b/>\n' +
      '      <w:sz w:val="24"/>\n' + // 12pt
      '      <w:color w:val="059669"/>\n' + // Verde esmeralda
      '    </w:rPr>\n' +
      '    <w:pPr>\n' +
      '      <w:spacing w:before="240" w:after="80"/>\n' +
      '    </w:pPr>\n' +
      '  </w:style>\n' +
      '  <w:style w:type="paragraph" w:styleId="RoleHeaderTechnical">\n' +
      '    <w:name w:val="RoleHeaderTechnical"/>\n' +
      '    <w:rPr>\n' +
      '      <w:b/>\n' +
      '      <w:sz w:val="22"/>\n' +
      '      <w:color w:val="6B7280"/>\n' + // Gris
      '    </w:rPr>\n' +
      '    <w:pPr>\n' +
      '      <w:spacing w:before="200" w:after="60"/>\n' +
      '    </w:pPr>\n' +
      '  </w:style>\n' +
      '  <w:style w:type="paragraph" w:styleId="CodeBlock">\n' +
      '    <w:name w:val="CodeBlock"/>\n' +
      '    <w:rPr>\n' +
      '      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>\n' +
      '      <w:sz w:val="19"/>\n' + // 9.5pt
      '      <w:color w:val="1F2937"/>\n' +
      '    </w:rPr>\n' +
      '    <w:pPr>\n' +
      '      <w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>\n' +
      '      <w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>\n' +
      '      <w:ind w:left="200" w:right="200"/>\n' +
      '    </w:pPr>\n' +
      '  </w:style>\n' +
      '</w:styles>'
    );
  }

  /**
   * Genera el cuerpo de documento word/document.xml con soporte completo para imágenes DrawingML
   */
  function buildDocumentXml(entity, options = {}, docContext = { images: [] }) {
    const title = entity.title || 'Conversación';
    const platform = (entity.source?.platform || entity.sourcePlatform || entity.platform || 'ChatGPT').toUpperCase();
    const model = entity.model || entity.sourceModel || 'Estándar';
    const integrity = entity.integrity?.status || entity.integrityStatus || 'Capturado';
    const dateStr = entity.updatedAt || entity.createdAt ? new Date(entity.updatedAt || entity.createdAt).toLocaleString() : new Date().toLocaleString();

    const rawMessages = Array.isArray(entity.selectedMessages)
      ? entity.selectedMessages
      : (Array.isArray(entity.messages) ? entity.messages : []);

    const includeTechnicalEvents = Boolean(options.includeTechnicalEvents);

    const messagesToRender = rawMessages.filter(m => {
      if (includeTechnicalEvents) return true;
      if (m.isConversational === false) return false;
      return m.role === 'user' || m.role === 'assistant';
    });

    const assetMap = options.assetMap || options.assetsMap || new Map();
    const getAssetBinary = (key) => {
      if (!key) return null;
      if (assetMap instanceof Map) return assetMap.get(key);
      if (typeof assetMap === 'object') return assetMap[key];
      return null;
    };

    const bodyParagraphs = [];
    let imageCounter = 0;

    // 1. Título del Documento
    bodyParagraphs.push(
      '  <w:p>\n' +
      '    <w:pPr><w:pStyle w:val="Title"/><w:spacing w:after="160"/></w:pPr>\n' +
      `    <w:r><w:t>${escapeXml(title)}</w:t></w:r>\n` +
      '  </w:p>'
    );

    // 2. Ficha de Metadatos
    const metaText = `${platform} · Modelo: ${model} · Integridad: ${integrity} · Fecha: ${dateStr}`;
    bodyParagraphs.push(
      '  <w:p>\n' +
      '    <w:pPr>\n' +
      '      <w:pBdr>\n' +
      '        <w:bottom w:val="single" w:sz="6" w:space="8" w:color="E5E7EB"/>\n' +
      '      </w:pBdr>\n' +
      '      <w:spacing w:after="280"/>\n' +
      '    </w:pPr>\n' +
      '    <w:r>\n' +
      '      <w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr>\n' +
      `      <w:t>${escapeXml(metaText)}</w:t>\n` +
      '    </w:r>\n' +
      '  </w:p>'
    );

    // 3. Renderizado de Mensajes
    messagesToRender.forEach((msg, idx) => {
      const isUser = msg.role === 'user';
      const isAssistant = msg.role === 'assistant';
      const isTool = msg.role === 'tool';
      const styleId = isUser ? 'RoleHeaderUser' : (isAssistant ? 'RoleHeaderAssistant' : 'RoleHeaderTechnical');
      const roleLabel = isUser ? 'USUARIO' : (isAssistant ? platform : (isTool ? 'HERRAMIENTA' : (msg.role || 'SISTEMA').toUpperCase()));

      const originalText = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
      const text=originalText.replace(/\x60\x60\x60[^\n]*\n[\s\S]*?\x60\x60\x60/g,'').replace(/!\[[^\]]*\]\(<?[^)>]+>?\)/g,'');
      const storedCode=Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
      const codeBlocks=storedCode.length?storedCode:Array.from(originalText.matchAll(/\x60\x60\x60([^\n]*)\n([\s\S]*?)\x60\x60\x60/g),match=>({language:match[1].trim(),code:match[2].replace(/\n$/,'')}));

      // Encabezado de Turno
      bodyParagraphs.push(
        '  <w:p>\n' +
        `    <w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>\n` +
        `    <w:r><w:t>${escapeXml(roleLabel)}</w:t></w:r>\n` +
        '  </w:p>'
      );

      // Párrafos de texto
      const paragraphs = text.split(/\n\s*\n/);
      paragraphs.forEach(pText => {
        const trimmed = pText.trim();
        if (!trimmed) return;

        // Dividir saltos de línea suaves dentro del párrafo
        const lines = trimmed.split('\n');
        const runs = lines.map((line, lIdx) => {
          const runXml = `<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
          if (lIdx < lines.length - 1) {
            return `${runXml}<w:r><w:br/></w:r>`;
          }
          return runXml;
        }).join('');

        bodyParagraphs.push(
          '  <w:p>\n' +
          '    <w:pPr><w:pStyle w:val="Normal"/></w:pPr>\n' +
          `    ${runs}\n` +
          '  </w:p>'
        );
      });

      // Bloques de código
      if (codeBlocks.length > 0) {
        codeBlocks.forEach(cb => {
          const lang = cb.language ? ` [${cb.language.toUpperCase()}]` : '';
          const codeText = typeof cb.code === 'string' ? cb.code : '';
          const lines = codeText.split('\n');

          // Etiqueta del bloque
          bodyParagraphs.push(
            '  <w:p>\n' +
            '    <w:pPr>\n' +
            '      <w:spacing w:before="120" w:after="20"/>\n' +
            '      <w:ind w:left="200"/>\n' +
            '    </w:pPr>\n' +
            '    <w:r>\n' +
            '      <w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="4B5563"/></w:rPr>\n' +
            `      <w:t>${escapeXml('CÓDIGO' + lang)}</w:t>\n` +
            '    </w:r>\n' +
            '  </w:p>'
          );

          // Líneas de código en párrafo monospace
          lines.forEach(codeLine => {
            bodyParagraphs.push(
              '  <w:p>\n' +
              '    <w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>\n' +
              `    <w:r><w:t xml:space="preserve">${escapeXml(codeLine || ' ')}</w:t></w:r>\n` +
              '  </w:p>'
            );
          });
        });
      }

      // 4. Recursos visuales e imágenes asociadas (ASSET-RED-001)
      const msgAttachments = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.content?.attachments) ? msg.content.attachments : []);
      const associatedAssets = (Array.isArray(options.assets) ? options.assets : []).filter(a =>
        a.sourceMessageId === msg.id || a.messageIndex === idx
      );

      const allMsgImages = [...msgAttachments, ...associatedAssets].filter(att =>
        att && (att.kind === 'image' || (att.mimeType && att.mimeType.startsWith('image/')) || (att.sourceType && att.sourceType.includes('image')))
      );

      const seenAssetKeys = new Set();
      const uniqueMsgImages = allMsgImages.filter(img => {
        const key = img.assetId || img.id || img.filename || img.name;
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

        if (isBinaryAvailable) {
          imageCounter++;
          const rawExt = (img.filename && img.filename.includes('.'))
            ? img.filename.split('.').pop().toLowerCase()
            : (img.mimeType && (img.mimeType.includes('jpeg') || img.mimeType.includes('jpg')) ? 'jpeg' : 'png');
          const ext = (rawExt === 'jpg' || rawExt === 'jpeg') ? 'jpeg' : rawExt;
          const docxFilename = `image${imageCounter}.${ext}`;
          const rId = `rIdImg${imageCounter}`;

          const imgBytes = rawBinary instanceof Uint8Array ? rawBinary : new Uint8Array(rawBinary);
          docContext.images.push({
            rId,
            filename: docxFilename,
            bytes: imgBytes
          });

          // Dimensión estándar en EMUs (1 pt = 12700 EMUs; ancho máx 432 pt = 5486400 EMUs)
          let cx = 5486400;
          let cy = 3657600; // 288 pt por defecto
          if (typeof img.width === 'number' && typeof img.height === 'number' && img.width > 0 && img.height > 0) {
            const aspect = img.height / img.width;
            cy = Math.round(cx * Math.min(Math.max(aspect, 0.25), 1.5));
          }

          bodyParagraphs.push(
            '  <w:p>\n' +
            '    <w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="160"/></w:pPr>\n' +
            '    <w:r>\n' +
            '      <w:drawing>\n' +
            '        <wp:inline distT="0" distB="0" distL="0" distR="0">\n' +
            `          <wp:extent cx="${cx}" cy="${cy}"/>\n` +
            `          <wp:docPr id="${imageCounter}" name="${escapeXml(img.filename || docxFilename)}"/>\n` +
            '          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">\n' +
            '            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">\n' +
            '              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">\n' +
            '                <pic:nvPicPr>\n' +
            `                  <pic:cNvPr id="${imageCounter}" name="${escapeXml(img.filename || docxFilename)}"/>\n` +
            '                  <pic:cNvPicPr/>\n' +
            '                </pic:nvPicPr>\n' +
            '                <pic:blipFill>\n' +
            `                  <a:blip r:embed="${rId}"/>\n` +
            '                  <a:stretch><a:fillRect/></a:stretch>\n' +
            '                </pic:blipFill>\n' +
            '                <pic:spPr>\n' +
            `                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>\n` +
            '                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>\n' +
            '                </pic:spPr>\n' +
            '              </pic:pic>\n' +
            '            </a:graphicData>\n' +
            '          </a:graphic>\n' +
            '        </wp:inline>\n' +
            '      </w:drawing>\n' +
            '    </w:r>\n' +
            '  </w:p>'
          );
        } else {
          // Fallback honesto: Callout accesible sin IDs crudos
          const fallbackName = img.filename || img.name || 'imagen';
          bodyParagraphs.push(
            '  <w:p>\n' +
            '    <w:pPr>\n' +
            '      <w:pBdr>\n' +
            '        <w:left w:val="single" w:sz="18" w:space="8" w:color="9CA3AF"/>\n' +
            '        <w:top w:val="single" w:sz="4" w:space="4" w:color="E5E7EB"/>\n' +
            '        <w:bottom w:val="single" w:sz="4" w:space="4" w:color="E5E7EB"/>\n' +
            '        <w:right w:val="single" w:sz="4" w:space="4" w:color="E5E7EB"/>\n' +
            '      </w:pBdr>\n' +
            '      <w:shd w:val="clear" w:color="auto" w:fill="F9FAFB"/>\n' +
            '      <w:spacing w:before="100" w:after="120"/>\n' +
            '    </w:pPr>\n' +
            '    <w:r>\n' +
            '      <w:rPr><w:i/><w:color w:val="4B5563"/><w:sz w:val="18"/></w:rPr>\n' +
            `      <w:t xml:space="preserve">[Recurso visual no disponible en la exportación: ${escapeXml(fallbackName)} · Origen: ChatGPT]</w:t>\n` +
            '    </w:r>\n' +
            '  </w:p>'
          );
        }
      });
    });

    // Pie de página de documento y propiedades de sección
    const sectionXml =
      '  <w:sectPr>\n' +
      '    <w:pgSz w:w="11906" w:h="16838"/>\n' + // A4: 11906 x 16838 dxa (twips)
      '    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>\n' +
      '  </w:sectPr>';

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"\n' +
      '            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"\n' +
      '            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"\n' +
      '            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"\n' +
      '            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">\n' +
      '  <w:body>\n' +
      bodyParagraphs.join('\n') + '\n' +
      sectionXml + '\n' +
      '  </w:body>\n' +
      '</w:document>'
    );
  }

  /**
   * Genera el archivo DOCX completo empaquetado en un archivo PKZip conforme a OpenXML.
   * @param {Object} entity - Conversación o Clip canónico
   * @param {Object} options - Opciones de exportación
   * @returns {Uint8Array} Bytes binarios del archivo DOCX
   */
  function buildDocx(entity, options = {}) {
    const zb = getZipBuilder();
    const docContext = { images: [] };
    const documentXml = buildDocumentXml(entity, options, docContext);

    const files = {
      '[Content_Types].xml': buildContentTypesXml(docContext.images),
      '_rels/.rels': buildRootRelsXml(),
      'word/_rels/document.xml.rels': buildDocumentRelsXml(docContext.images),
      'docProps/core.xml': buildCorePropsXml(entity),
      'docProps/app.xml': buildAppPropsXml(),
      'word/styles.xml': buildStylesXml(),
      'word/document.xml': documentXml
    };

    // Incrustar binarios de imágenes en word/media/
    for (const img of docContext.images) {
      files[`word/media/${img.filename}`] = img.bytes;
    }

    return zb.createZip(files);
  }

  return {
    buildDocx,
    buildDocumentXml,
    buildStylesXml,
    escapeXml
  };
});
