'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 12 — AMD-56)
 * Cubre ambos hallazgos residuales de la Ronda 12:
 * 1. P1 Firma binaria post-lectura: un Blob declarado `type: 'image/png'` con bytes `%PDF-1.4` NO se emite como `assets/original.png` en el ZIP
 * 2. P2 Código indentado con tabulación dentro de `lista > blockquote`: `- item\n\n  > \t![literal]\n  > \t<Cite/>` preserva literales sin emitir `fetch`
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

test('R12 P1 post-read magic bytes: Blob spoofed as image/png carrying %PDF-1.4 is rejected before binding to assets/original.png', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const spoofedBlob = new Blob([pdfBytes], { type: 'image/png' });
  const conv = {
    title: 'SpoofedBlobBytes',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'PNG metadata with spoofed image/png Blob containing %PDF-1.4',
      attachments: [
        { id: 'shared', fileId: 'shared_fid', kind: 'image', mimeType: 'image/png', filename: 'original.png' },
        { id: 'shared', fileId: 'shared_fid', mimeType: 'image/png', blob: spoofedBlob }
      ]
    }]
  };

  const resolved = await AssetResolver.resolveAssetBinaries(conv, { imageStrategy: 'package' });
  assert.equal(resolved.assetBinaryMap.get('original.png'), undefined);
  assert.equal(resolved.assets[0].availability, 'unavailable');

  const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(zip['assets/original.png'], undefined, 'ZIP nunca debe emitir assets/original.png con bytes %PDF-1.4');
  assert.ok(!exp.data.includes('%PDF-1.4'));
});

test('R12 P2 CommonMark indented code inside lista > blockquote with TAB isolates literal image and Cite', async () => {
  const outerPng = makePng(91);
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
      '- item',
      '',
      '  > \t![literal](https://evil.test/literal.png)',
      '  > \t<Cite href="LITERAL"/>',
      '',
      '![outside](https://cdn.test/after_indented.png)',
      '<Cite href="OUTSIDE"/>'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r12_indented_tab', messages: [{ id: 'm0', role: 'assistant', text }] },
      { imageStrategy: 'package' }
    );
    assert.deepEqual(fetched, ['https://cdn.test/after_indented.png'], 'No debe emitir fetch para la imagen en código indentado con TAB dentro de lista > blockquote');
    assert.equal(res.assets.length, 1);

    const md = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(md.data.includes('<Cite href="LITERAL"/>'), 'Debe preservar <Cite/> literal dentro de código indentado con TAB');
    assert.ok(!md.data.includes('<Cite href="OUTSIDE"/>'), 'Debe limpiar <Cite/> fuera del bloque indentado');
  } finally {
    globalThis.fetch = origFetch;
  }
});
