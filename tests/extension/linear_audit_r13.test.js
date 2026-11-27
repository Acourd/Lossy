'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 13 — AMD-56)
 * Cubre los 3 contraejemplos deterministas de la Ronda 13:
 * 1. P1 MIME genérico: Blob / DataURI / fetch declarado `application/octet-stream` con `original.png` y bytes `%PDF-1.4` NO se exporta como `assets/original.png`
 * 2. P1 Normalización previa: adjunto declarado PNG + `data:image/png;base64,<PDF>` con `original.png` NO borra la contradicción ni se incluye en el ZIP
 * 3. P2 `<grid>` inline: `` `<grid>` `` en código inline NO crea profundidad widget ficticia ni borra `<Cite/>` en un bloque indentado posterior
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const base = path.resolve(__dirname, '../..');
const load = p => require(path.join(base, 'extension/src', p));

const { ExportCenter, AssetResolver } = load('core/portability/export_center');
const Zip = load('core/portability/zip_builder');

test('R13 P1 generic octet-stream MIME: PDF bytes under original.png reject across Blob, DataURI, and fetch', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const pdfOctetUri = 'data:application/octet-stream;base64,' + pdfBytes.toString('base64');
  const pdfBlob = new Blob([pdfBytes], { type: 'application/octet-stream' });

  // 1. Blob with application/octet-stream + original.png + PDF bytes
  const convBlob = {
    title: 'OctetBlob',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Blob octet-stream PDF named original.png',
      attachments: [{ id: 'a1', kind: 'image', mimeType: 'application/octet-stream', filename: 'original.png', blob: pdfBlob }]
    }]
  };
  const expBlob = await new ExportCenter().exportSingle(convBlob, 'md', 'ai', { imageStrategy: 'package' });
  const zipBlob = await Zip.unzip(expBlob.data);
  assert.equal(zipBlob['assets/original.png'], undefined);
  assert.ok(!expBlob.data.includes('%PDF-1.4'));

  // 2. DataURI with application/octet-stream + original.png + PDF bytes
  const convUri = {
    title: 'OctetUri',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'DataURI octet-stream PDF named original.png',
      attachments: [{ id: 'a1', kind: 'image', mimeType: 'application/octet-stream', filename: 'original.png', dataURI: pdfOctetUri }]
    }]
  };
  const expUri = await new ExportCenter().exportSingle(convUri, 'md', 'ai', { imageStrategy: 'package' });
  const zipUri = await Zip.unzip(expUri.data);
  assert.equal(zipUri['assets/original.png'], undefined);

  // 3. Fetch returning application/octet-stream + PDF bytes for original.png
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/octet-stream']]),
      arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
    });
    const convFetch = {
      title: 'OctetFetch',
      messages: [{
        id: 'm0',
        role: 'assistant',
        text: 'Fetched octet-stream PDF named original.png',
        attachments: [{ id: 'a1', kind: 'image', mimeType: 'application/octet-stream', filename: 'original.png', sourceURL: 'https://cdn.test/original.png' }]
      }]
    };
    const resFetch = await AssetResolver.resolveAssetBinaries(convFetch, { imageStrategy: 'package' });
    assert.equal(resFetch.assetBinaryMap.get('original.png'), undefined);
    assert.equal(resFetch.assets[0].availability, 'unavailable');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('R13 P1 pre-normalization: PNG declaration + data:image/png;base64,<PDF> rejects rather than rewriting to PDF under original.png', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const mismatchedDataUri = 'data:image/png;base64,' + pdfBytes.toString('base64');
  const conv = {
    title: 'PreNormConflict',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Declared PNG with PDF magic bytes',
      attachments: [{
        id: 'img_1',
        kind: 'image',
        mimeType: 'image/png',
        filename: 'original.png',
        dataURI: mismatchedDataUri
      }]
    }]
  };

  const resolved = await AssetResolver.resolveAssetBinaries(conv, { imageStrategy: 'package' });
  assert.equal(resolved.assetBinaryMap.get('original.png'), undefined);
  assert.equal(resolved.assets[0].availability, 'unavailable');

  const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(zip['assets/original.png'], undefined);
  assert.ok(!exp.data.includes('%PDF-1.4'));
});

test('R13 P2 inline <grid> code span does not poison widgetDepth or strip Cite in subsequent indented code block', async () => {
  const text = [
    'El tag `<grid>` es solo texto inline.',
    '',
    '    <Cite href="INDENT_AFTER_INLINE_GRID"/>'
  ].join('\n');

  const md = await new ExportCenter().exportSingle(
    { messages: [{ role: 'assistant', text }] },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.ok(md.data.includes('`<grid>`'));
  assert.ok(md.data.includes('<Cite href="INDENT_AFTER_INLINE_GRID"/>'), 'Debe preservar <Cite/> dentro de bloque indentado tras `<grid>` inline');
});
