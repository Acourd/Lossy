'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 9 — AMD-56)
 * Cubre las dos causas raíz residuales de la Ronda 9:
 * 1. P1 Hidratación MIME: coincidencia directa por `id` o `fileId` con distinto `mimeType` (ej. PNG sin bytes vs PDF compartido) nunca fusiona ni contamina `assets/original.png` con `%PDF-1.4`
 * 2. P2 Cercas en listas anidadas: al regresar de una sublista a la continuación de la lista padre, un cierre válido de 4 espacios se reconoce limpiamente y expone imágenes y `<Cite/>` posteriores
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

test('R9 P1 MIME direct id/fileId match: PNG without bytes + shared id/fileId PDF never emits PDF bytes as original.png', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const pdfUri = 'data:application/pdf;base64,' + pdfBytes.toString('base64');

  // Case A: shared fileId AND id across message attachments
  const convSameMsg = {
    title: 'SharedIdMime',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Two resources with colliding id and different MIME',
      attachments: [
        { id: 'shared_id', fileId: 'shared_fid', kind: 'image', mimeType: 'image/png', filename: 'original.png' },
        { id: 'shared_id', fileId: 'shared_fid', mimeType: 'application/pdf', filename: 'doc.pdf', dataURI: pdfUri }
      ]
    }]
  };
  const resolved = AssetResolver.resolveAssetsForEntity(convSameMsg);
  assert.equal(resolved.length, 2, 'Deben conservarse ambos adjuntos');
  assert.equal(resolved[0].mimeType, 'image/png');
  assert.equal(resolved[0].dataURI, null);
  assert.equal(resolved[1].mimeType, 'application/pdf');
  assert.equal(resolved[1].dataURI, pdfUri);

  const exp = await new ExportCenter().exportSingle(convSameMsg, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(zip['assets/original.png'], undefined, 'original.png sin bytes no debe contener el binario PDF');
  assert.ok(!exp.data.includes('%PDF-1.4'), 'original.png no debe recibir bytes %PDF-1.4');

  // Case B: shared id via entity.attachments top-level
  const convTop = {
    title: 'SharedIdTop',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Message PNG without bytes',
      attachments: [{ id: 'shared_top', fileId: 'fid_top', kind: 'image', mimeType: 'image/png', filename: 'original.png' }]
    }],
    attachments: [{ id: 'shared_top', fileId: 'fid_top', mimeType: 'application/pdf', filename: 'doc.pdf', dataURI: pdfUri }]
  };
  const resolvedTop = AssetResolver.resolveAssetsForEntity(convTop);
  assert.equal(resolvedTop.length, 2);
  assert.equal(resolvedTop[0].dataURI, null);
  assert.equal(resolvedTop[1].mimeType, 'application/pdf');
});

test('R9 P2 nested list return: fence after sublist closes validly with 4 spaces and exposes following image & Cite', async () => {
  const outerPng = makePng(64);
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
      '- Parent item',
      '  - Nested child',
      '    nested text',
      '',
      '  ```md',
      '  <Cite href="INSIDE_PARENT"/>',
      '    ```',
      '',
      '  ![after_sublist_fence](https://cdn.test/after.png)',
      '',
      '  <Cite href="OUTSIDE_PARENT"/>'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r9_nested_list', messages: [{ id: 'm0', role: 'assistant', text }] },
      { imageStrategy: 'package' }
    );
    assert.deepEqual(fetched, ['https://cdn.test/after.png']);
    assert.equal(res.assets.length, 1);

    const md = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(md.data.includes('<Cite href="INSIDE_PARENT"/>'));
    assert.ok(!md.data.includes('<Cite href="OUTSIDE_PARENT"/>'));
  } finally {
    globalThis.fetch = origFetch;
  }
});
