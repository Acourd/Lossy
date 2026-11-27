'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 11 — AMD-56)
 * Cubre los contraejemplos de la Ronda 11:
 * 1. P1 PDF exportado como PNG cuando `mimeType: 'image/png'` spoofa un `Blob` con `type: 'application/pdf'`
 * 2. P2 Tabulaciones en `lista > blockquote > cerca` nunca abandonan la cerca ni disparan `fetch` ni borran `<Cite/>`
 * 3. P2 Cerca sin cierre dentro de una lista se cierra al salir de la lista para que contenido posterior fuera de la lista siga activo
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

test('R11 P1 Blob type mismatch vs spoofed att.mimeType never writes %PDF-1.4 into assets/original.png', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const conv = {
    title: 'SpoofedAttMimeBlob',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'PNG placeholder + PDF Blob with spoofed image/png att.mimeType',
      attachments: [
        { id: 'shared', fileId: 'shared_fid', kind: 'image', mimeType: 'image/png', filename: 'original.png' },
        { id: 'shared', fileId: 'shared_fid', mimeType: 'image/png', blob: pdfBlob }
      ]
    }]
  };

  const resolved = AssetResolver.resolveAssetsForEntity(conv);
  assert.equal(resolved.length, 2, 'No debe fusionar un Blob PDF sobre original.png aunque att.mimeType diga image/png');
  assert.equal(resolved[0].data, null);
  assert.equal(resolved[1].mimeType, 'application/pdf');

  const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(zip['assets/original.png'], undefined, 'original.png sin bytes reales no debe recibir bytes %PDF-1.4');
  assert.ok(!exp.data.includes('%PDF-1.4'));
});

test('R11 P2 Tabbed lista > blockquote > cerca isolates literals and unclosed list fence closes upon exiting list', async () => {
  const outerPng = makePng(84);
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

    // Case A: Tabs continuing inside lista > blockquote > cerca
    const tabbedText = [
      '- Item con cita tabulada',
      '\t> ```md',
      '\t> ![literal](https://evil.test/tabbed.png)',
      '\t> <Cite href="TAB_LITERAL"/>',
      '\t> ```',
      '',
      '![outside_tab](https://cdn.test/after_tab.png)'
    ].join('\n');

    const resA = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r11_tabs', messages: [{ id: 'm0', role: 'assistant', text: tabbedText }] },
      { imageStrategy: 'package' }
    );
    assert.deepEqual(fetched, ['https://cdn.test/after_tab.png']);
    assert.equal(resA.assets.length, 1);

    const mdA = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text: tabbedText }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(mdA.data.includes('<Cite href="TAB_LITERAL"/>'));

    // Case B: Unclosed fence inside list exits when non-blank unindented content appears outside list
    fetched.length = 0;
    const unclosedText = [
      '- Item con cerca sin cerrar',
      '  ```md',
      '  ![inside_unclosed](https://evil.test/unclosed.png)',
      '  <Cite href="INSIDE_UNCLOSED"/>',
      'Parrafo fuera de lista.',
      '![after_exit](https://cdn.test/after_exit.png)',
      '<Cite href="OUTSIDE_EXIT"/>'
    ].join('\n');

    const resB = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r11_exit', messages: [{ id: 'm0', role: 'assistant', text: unclosedText }] },
      { imageStrategy: 'package' }
    );
    assert.deepEqual(fetched, ['https://cdn.test/after_exit.png']);
    assert.equal(resB.assets.length, 1);

    const mdB = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text: unclosedText }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(mdB.data.includes('<Cite href="INSIDE_UNCLOSED"/>'));
    assert.ok(!mdB.data.includes('<Cite href="OUTSIDE_EXIT"/>'));
  } finally {
    globalThis.fetch = origFetch;
  }
});
