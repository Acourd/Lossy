'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 10 — AMD-56)
 * Cubre los dos hallazgos residuales de la Ronda 10:
 * 1. P1 Corrupción MIME case-insensitive / Blob.type / magic bytes:
 *    - `DATA:application/pdf;base64,...` (esquema en mayúsculas) NO hidrata a un PNG sin bytes
 *    - `Blob` con `{ type: 'application/pdf' }` NO hidrata a un PNG sin bytes
 * 2. P2 Contenedores CommonMark arbitrariamente anidados:
 *    - `lista > blockquote > cerca` preserva literales `<Cite/>` e imágenes sin emitir `fetch`
 *    - Retorno `lista > blockquote > continuación de lista > cerca` con cierre de 4 espacios expone imagen y `<Cite/>` posteriores
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');

const base = path.resolve(__dirname, '../..');
const load = p => require(path.join(base, 'extension/src', p));

const { ExportCenter, AssetResolver } = load('core/portability/export_center');
const Zip = load('core/portability/zip_builder');

function pngChunk(name, data) {
  const n = Buffer.from(name);
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length);
  n.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(Zip.crc32(Buffer.concat([n, data])), 8 + data.length);
  return b;
}

function makePng(seed) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(1);
  h.writeUInt32BE(1, 4);
  h[8] = 8;
  h[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', h),
    pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, seed, 0, 255 - seed]))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

test('R10 P1 MIME: uppercase DATA: PDF URI and Blob(type: application/pdf) never corrupt original.png', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const upperPdfUri = 'DATA:application/pdf;base64,' + pdfBytes.toString('base64');

  // Case A: Uppercase DATA: scheme with shared id & fileId
  const convUpper = {
    title: 'UpperDataUri',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Uppercase DATA URI',
      attachments: [
        { id: 'shared_u', fileId: 'fid_u', kind: 'image', mimeType: 'image/png', filename: 'original.png' },
        { id: 'shared_u', fileId: 'fid_u', filename: 'doc.pdf', dataURI: upperPdfUri }
      ]
    }]
  };
  const expUpper = await new ExportCenter().exportSingle(convUpper, 'md', 'ai', { imageStrategy: 'package' });
  const zipUpper = await Zip.unzip(expUpper.data);
  assert.equal(zipUpper['assets/original.png'], undefined, 'DATA:application/pdf no debe escribir %PDF-1.4 en original.png');
  assert.ok(!expUpper.data.includes('%PDF-1.4'));

  // Case B: Blob with type: 'application/pdf' and shared id & fileId
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const convBlob = {
    title: 'BlobMime',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Blob PDF',
      attachments: [
        { id: 'shared_b', fileId: 'fid_b', kind: 'image', mimeType: 'image/png', filename: 'original.png' },
        { id: 'shared_b', fileId: 'fid_b', blob: pdfBlob }
      ]
    }]
  };
  const resolvedBlob = AssetResolver.resolveAssetsForEntity(convBlob);
  assert.equal(resolvedBlob.length, 2);
  assert.equal(resolvedBlob[0].mimeType, 'image/png');
  assert.equal(resolvedBlob[0].data, null);
  assert.equal(resolvedBlob[1].mimeType, 'application/pdf');
});

test('R10 P2 CommonMark containers: lista > blockquote > cerca preserves literals AND returning from blockquote to list honors 4-space close', async () => {
  const outerPng = makePng(71);
  const fetched = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => outerPng.buffer.slice(outerPng.byteOffset, outerPng.byteOffset + outerPng.byteLength)
      };
    };

    const text = [
      '- Lista padre',
      '  > Cita con cerca:',
      '  > ```md',
      '  > ![dentro](https://evil.test/inside.png)',
      '  > <Cite href="INSIDE_LIST_BQ"/>',
      '  > ```',
      '',
      '  ```md',
      '  <Cite href="PARENT_LIST_FENCE"/>',
      '    ```',
      '',
      '  ![fuera](https://cdn.test/after_bq_return.png)',
      '',
      '  <Cite href="OUTSIDE_AFTER_RETURN"/>'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r10_containers', messages: [{ id: 'm0', role: 'assistant', text }] },
      { imageStrategy: 'package' }
    );
    assert.deepEqual(fetched, ['https://cdn.test/after_bq_return.png'], 'Solo debe descubrir y descargar la imagen fuera de cercas tras regresar del blockquote a la lista');
    assert.equal(res.assets.length, 1);

    const md = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(md.data.includes('<Cite href="INSIDE_LIST_BQ"/>'));
    assert.ok(md.data.includes('<Cite href="PARENT_LIST_FENCE"/>'));
    assert.ok(!md.data.includes('<Cite href="OUTSIDE_AFTER_RETURN"/>'));
  } finally {
    globalThis.fetch = origFetch;
  }
});
