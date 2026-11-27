'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 8 — AMD-56)
 * Cubre todos los hallazgos restantes de la Ronda 8:
 * 1. P1 top-level binary mismatch: mensaje con `data: PNG_A` + duplicado top-level con misma `sourceURL` e identidad propia y `dataURI: PNG_B` conserva AMBAS imágenes
 * 2. P1 bare hydration MIME check: `{id: fileIdExistente, mimeType: 'application/pdf', dataURI: PDF}` NO se fusiona con un PNG sin bytes
 * 3. P2 list continuation closing fence: cerca abierta con 2 espacios en continuación de lista y cerrada con 4 espacios cierra limpiamente, descubriendo imágenes y limpiando `<Cite/>` posteriores
 * 4. P2 backtick URL destination: `![alt](`code`)` o `![alt](https://x/`c`)` nunca produce una URL con `\u0000CODE\u0000` ni dispara `fetch`
 * 5. P2 codeBlock language enrichment: recaptura con mismo código y `language` no vacío enriquece bloques persistidos sin idioma
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');

const base = path.resolve(__dirname, '../..');
const load = p => require(path.join(base, 'extension/src', p));

const { LinerDB } = load('core/storage/liner_db');
const { ExportCenter, AssetResolver } = load('core/portability/export_center');
const Zip = load('core/portability/zip_builder');
const CS = load('content/content_script');

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

const enc = bytes => Buffer.from(bytes).toString('hex');

test('R8 P1 top-level binary mismatch: message data PNG_A + top-level dataURI PNG_B on same sourceURL preserve both in ZIP', async () => {
  const pngA = makePng(15);
  const pngB = makePng(95);
  const conv = {
    title: 'TopDiffBinary',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Message image A',
      attachments: [{
        id: 'att_msg',
        assetId: 'att_msg',
        kind: 'image',
        mimeType: 'image/png',
        filename: 'a.png',
        sourceURL: 'https://shared.test/same-url.png',
        data: new Uint8Array(pngA)
      }]
    }],
    attachments: [{
      id: 'att_top',
      assetId: 'att_top',
      kind: 'image',
      mimeType: 'image/png',
      filename: 'b.png',
      sourceURL: 'https://shared.test/same-url.png',
      dataURI: 'data:image/png;base64,' + pngB.toString('base64')
    }]
  };

  const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(enc(zip['assets/a.png']), enc(pngA));
  assert.equal(enc(zip['assets/b.png']), enc(pngB));
});

test('R8 P1 MIME isolation: PDF stub matching another asset fileId never merges into PNG attachment', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  const pdfDataUri = 'data:application/pdf;base64,' + pdfBytes.toString('base64');
  const conv = {
    title: 'MimeCollision',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'PNG + PDF',
      attachments: [
        { id: 'img_first', fileId: 'file_shared_id', kind: 'image', mimeType: 'image/png', filename: 'first.png' },
        { id: 'file_shared_id', mimeType: 'application/pdf', dataURI: pdfDataUri }
      ]
    }]
  };
  const resolved = AssetResolver.resolveAssetsForEntity(conv);
  assert.equal(resolved.length, 2, 'Deben mantenerse ambos adjuntos sin fusionar PDF dentro de PNG');
  assert.equal(resolved[0].mimeType, 'image/png');
  assert.equal(resolved[0].dataURI, null);
  assert.equal(resolved[1].mimeType, 'application/pdf');
  assert.equal(resolved[1].dataURI, pdfDataUri);
});

test('R8 P2 CommonMark list continuation: 2-space open in list closed with 4 spaces discovers outside image and strips Cite', async () => {
  const outerPng = makePng(55);
  const fetched = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return { ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => outerPng.buffer.slice(outerPng.byteOffset, outerPng.byteOffset + outerPng.byteLength) };
    };
    const text = [
      '- Item',
      '',
      '  ```md',
      '  <Cite href="INSIDE"/>',
      '    ```',
      '',
      '![outside](https://cdn.test/outside.png)',
      '',
      'Texto <Cite href="OUTSIDE"/>'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries({ canonicalId: 'r8_list', messages: [{ id: 'm0', role: 'assistant', text }] }, { imageStrategy: 'package' });
    assert.deepEqual(fetched, ['https://cdn.test/outside.png']);
    assert.equal(res.assets.length, 1);

    const md = await new ExportCenter().exportSingle({ messages: [{ role: 'assistant', text }] }, 'md', 'ai', { imageStrategy: 'omit' });
    assert.ok(md.data.includes('<Cite href="INSIDE"/>'), 'Literal dentro de la cerca en lista debe conservarse');
    assert.ok(!md.data.includes('<Cite href="OUTSIDE"/>'), 'Cite fuera de la cerca cerrada debe limpiarse');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('R8 P2 inline destination with backticks never produces \\u0000CODE\\u0000 URL or fetch', async () => {
  const fetched = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      throw new Error('should not fetch');
    };
    const text = 'Test ![alt](`https://evil.test/a.png`) and ![alt2](https://evil.test/`x`.png)';
    const res = await AssetResolver.resolveAssetBinaries({ canonicalId: 'r8_bt', messages: [{ id: 'm0', role: 'assistant', text }] }, { imageStrategy: 'package' });
    assert.equal(res.assets.length, 0);
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('R8 P2 codeBlock language enrichment: empty language adopts non-empty language on merge', async () => {
  const db = new LinerDB();
  await db.saveConversation({
    canonicalId: 'r8_lang',
    messages: [{ id: 'm1', role: 'assistant', text: 'Code', codeBlocks: [{ language: '', code: 'const x = 1;\nconst y = 2;' }] }]
  });
  await db.saveConversation({
    canonicalId: 'r8_lang',
    messages: [{ id: 'm1', role: 'assistant', text: 'Code', codeBlocks: [{ language: 'js', code: 'const x = 1;' }] }]
  });
  const saved = await db.getConversation('r8_lang');
  assert.equal(saved.messages[0].codeBlocks[0].code, 'const x = 1;\nconst y = 2;');
  assert.equal(saved.messages[0].codeBlocks[0].language, 'js');

  const csMerged = CS.alignAndAppendTurns(
    [{ id: 'm1', role: 'assistant', text: 'Code', codeBlocks: [{ language: '', code: 'const x = 1;' }] }],
    [{ id: 'm1', role: 'assistant', text: 'Code', codeBlocks: [{ language: 'typescript', code: 'const x = 1;' }] }]
  );
  assert.equal(csMerged[0].codeBlocks[0].language, 'typescript');
});
