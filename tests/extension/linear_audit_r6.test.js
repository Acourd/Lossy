'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 6 — AMD-56)
 * Cubre todos los hallazgos P1/P2 de la Ronda 6:
 * 1. P1 A06: mismo fileId con URL firmada rotada preserva dataURI local hidratado
 * 2. P1 A08: mezcla de codeBlocks por contenido (no posicional) preserva [FIRST, SECOND_LONG_UNIQUE] al recapturar [SECOND_LONG_UNIQUE]
 * 3. P1 A11/A12: adjunto top-level llamado md_img_0_0 o ptr_0_0 y colisión assetId === fileId de otra imagen preservan todos los recursos
 * 4. P2 CommonMark: cercas en listas, código indentado y spans inline preservan literales y nunca disparan fetch
 * 5. P2 A27: URL con coma vs dos URLs separadas nunca colisionan en el ID de turno Gemini
 * 6. P2 A07: ventanas disjuntas con timestamps explícitos se ordenan cronológicamente ([a,b] tras [c,d] -> [a,b,c,d])
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
const Multi = load('platforms/multi_platform_adapter');

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
const turn = (id, text, extra = {}) => ({ id, role: 'assistant', text, ...extra });

async function savePair(a, b) {
  const db = new LinerDB();
  await db.saveConversation(a);
  await db.saveConversation(b);
  return db.getConversation(a.canonicalId);
}

test('R6 P1 A06: same fileId with rotated signed URL token retains hydrated local dataURI', async () => {
  const dataURI = 'data:image/png;base64,' + makePng(33).toString('base64');
  const saved = await savePair(
    {
      canonicalId: 'r6_a06_token',
      messages: [{
        ...turn('m1', 'Image'),
        attachments: [{ id: 'a1', fileId: 'file-abc123', url: 'https://cdn.test/img?sig=OLD_TOKEN', dataURI }]
      }]
    },
    {
      canonicalId: 'r6_a06_token',
      messages: [{
        ...turn('m1', 'Image'),
        attachments: [{ id: 'a1', fileId: 'file-abc123', url: 'https://cdn.test/img?sig=NEW_TOKEN' }]
      }]
    }
  );
  assert.equal(saved.messages[0].attachments[0].dataURI, dataURI, 'Debe conservar dataURI cuando fileId coincide aunque rote el token de URL');
});

test('R6 P1 A08: content-aware codeBlocks merge preserves [FIRST, SECOND_LONG_UNIQUE] when recapturing [SECOND_LONG_UNIQUE]', async () => {
  const block1 = { language: 'js', code: 'FIRST' };
  const block2 = { language: 'js', code: 'SECOND_LONG_UNIQUE' };
  const saved = await savePair(
    { canonicalId: 'r6_a08', messages: [{ ...turn('m1', 'Code'), codeBlocks: [block1, block2] }] },
    { canonicalId: 'r6_a08', messages: [{ ...turn('m1', 'Code'), codeBlocks: [block2] }] }
  );
  assert.deepEqual(saved.messages[0].codeBlocks.map(b => b.code), ['FIRST', 'SECOND_LONG_UNIQUE']);

  // Also verify content_script.alignAndAppendTurns
  const merged = CS.alignAndAppendTurns(
    [{ ...turn('m1', 'Code'), codeBlocks: [block1, block2] }],
    [{ ...turn('m1', 'Code'), codeBlocks: [block2] }]
  );
  assert.deepEqual(merged[0].codeBlocks.map(b => b.code), ['FIRST', 'SECOND_LONG_UNIQUE']);
});

test('R6 P1 A11/A12: top-level attachment named md_img_0_0/ptr_0_0 and assetId === other fileId preserve all resources', async () => {
  // 1. Top-level attachment named md_img_0_0 vs inline markdown image in msg 0
  const convTop = {
    title: 'TopCollision',
    messages: [{ id: 'm0', role: 'assistant', text: '![inline](data:image/png;base64,' + makePng(22).toString('base64') + ')' }],
    attachments: [{ id: 'md_img_0_0', assetId: 'md_img_0_0', kind: 'image', mimeType: 'image/png', filename: 'top.png', data: new Uint8Array(makePng(11)) }]
  };
  const resolvedTop = AssetResolver.resolveAssetsForEntity(convTop);
  assert.equal(resolvedTop.length, 2, 'Debe conservar tanto la imagen inline como el adjunto top-level md_img_0_0');
  assert.equal(new Set(resolvedTop.map(a => a.assetId)).size, 2);
  const exp = await new ExportCenter().exportSingle(convTop, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(enc(zip['assets/top.png']), enc(makePng(11)));

  // 2. Asset 2 whose assetId equals Asset 1's fileId
  const convCross = {
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Two images',
      attachments: [
        { id: 'img_1', assetId: 'img_1', fileId: 'file-shared', kind: 'image', mimeType: 'image/png', filename: 'one.png', data: new Uint8Array(makePng(41)) },
        { id: 'file-shared', assetId: 'file-shared', kind: 'image', mimeType: 'image/png', filename: 'two.png', data: new Uint8Array(makePng(42)) }
      ]
    }]
  };
  const resolvedCross = AssetResolver.resolveAssetsForEntity(convCross);
  assert.equal(resolvedCross.length, 2, 'Una imagen cuyo assetId coincide con el fileId de otra nunca debe descartarse');
  assert.equal(new Set(resolvedCross.map(a => a.assetId)).size, 2);
});

test('R6 P2 CommonMark: list fences, indented code blocks, and inline code spans preserve literals and never fetch', async () => {
  const fetchedUrls = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetchedUrls.push(String(url));
      throw new Error('should not fetch');
    };
    const text = [
      '- Item con cerca:',
      '  ```md',
      '  ![list](https://evil.test/list.png)',
      '  <Cite href="LIST_LITERAL"/>',
      '  ```',
      '',
      '    ![indented](https://evil.test/indented.png)',
      '    <Cite href="INDENT_LITERAL"/>',
      '',
      'Inline: `` `![inline](https://evil.test/inline.png)` <Cite href="INLINE_LITERAL"/> ``'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries({ canonicalId: 'cm_r6', messages: [{ id: 'm0', role: 'assistant', text }] }, { imageStrategy: 'package' });
    assert.equal(res.assets.length, 0, 'Cero recursos descubiertos dentro de listas cercadas, código indentado o código inline');
    assert.deepEqual(fetchedUrls, [], 'Cero llamadas fetch para imágenes dentro de código literal');

    const md = await new ExportCenter().exportSingle({ messages: [{ role: 'assistant', text }] }, 'md', 'ai', { imageStrategy: 'omit' });
    assert.ok(md.data.includes('<Cite href="LIST_LITERAL"/>'));
    assert.ok(md.data.includes('<Cite href="INDENT_LITERAL"/>'));
    assert.ok(md.data.includes('<Cite href="INLINE_LITERAL"/>'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('R6 P2 A27: URL containing a comma never collides with two separate URLs in Gemini turn IDs', () => {
  const mockDocWithImgs = (srcs) => ({
    title: 'Test - Gemini',
    querySelectorAll: () => [{
      nodeType: 1,
      tagName: 'MODEL-RESPONSE',
      childNodes: [{ nodeType: 3, textContent: 'Same text' }],
      textContent: 'Same text',
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: (sel) => sel.includes('img')
        ? srcs.map(s => ({ getAttribute: k => (k === 'src' ? s : null), currentSrc: s, src: s, complete: false, naturalWidth: 0 }))
        : []
    }]
  });
  const url = 'https://gemini.google.com/app/comma';
  const oneUrlWithComma = Multi.extractGeminiDom(mockDocWithImgs(['https://x.test/a,https://x.test/b']), url);
  const twoSeparateUrls = Multi.extractGeminiDom(mockDocWithImgs(['https://x.test/a', 'https://x.test/b']), url);
  assert.notEqual(oneUrlWithComma.messages[0].id, twoSeparateUrls.messages[0].id);
});

test('R6 P2 A07: disjoint windows with explicit timestamps sort chronologically [a,b] before [c,d]', async () => {
  const saved = await savePair(
    {
      canonicalId: 'r6_a07_disjoint',
      integrity: { status: 'captured' },
      messages: [
        turn('c', 'C', { createdAt: '2026-01-01T00:03:00Z' }),
        turn('d', 'D', { createdAt: '2026-01-01T00:04:00Z' })
      ]
    },
    {
      canonicalId: 'r6_a07_disjoint',
      integrity: { status: 'captured' },
      messages: [
        turn('a', 'A', { createdAt: '2026-01-01T00:01:00Z' }),
        turn('b', 'B', { createdAt: '2026-01-01T00:02:00Z' })
      ]
    }
  );
  assert.deepEqual(saved.messages.map(m => m.id), ['a', 'b', 'c', 'd']);
});
