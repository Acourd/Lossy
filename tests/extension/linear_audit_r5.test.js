'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 5 — AMD-56)
 * Cubre los 6 bloqueadores reproducidos en la Ronda 5:
 * 1. P1 A10: buildPdfAsync (Chromium PNG->JPEG) no sobrescribe aliases por filename
 * 2. P1 A06/A07/A08: LinerDB preserva adjuntos parcialmente omitidos, codeBlocks y orden en ventanas desplazadas (scroll up/down)
 * 3. P1 A27: MultiPlatform genera IDs sobre el texto completo (>160 chars) sin colisión de prefijo
 * 4. P1 A11/A12: Colisiones de adjuntos explícitos con md_img_* y ptr_* en el MISMO mensaje nunca descartan recursos
 * 5. P2 Importación: content.parts con asset_pointer no-string se rechaza en frontera y nunca rompe exportación directa
 * 6. P2 CommonMark: cercas ~~~ no duplican código, blockquotes con cercas preservan literales, imágenes en código literal no generan red
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
const Pdf = load('core/portability/pdf_builder');
const Bundle = load('core/portability/project_bundle');
const Crypto = load('core/crypto_util');
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

function makeFakeJpeg(tagByte) {
  // Minimal valid JPEG SOI + SOF0 (1x1) + tag + EOI
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xfe, 0x00, 0x03, tagByte,
    0xff, 0xd9
  ]);
}

const enc = bytes => Buffer.from(bytes).toString('hex');
const turn = (id, text) => ({ id, role: 'assistant', text });
const att = (id, seed, filename = 'image.png') => ({
  id,
  assetId: id,
  kind: 'image',
  mimeType: 'image/png',
  filename,
  data: new Uint8Array(makePng(seed))
});

async function savePair(a, b) {
  const db = new LinerDB();
  await db.saveConversation(a);
  await db.saveConversation(b);
  return db.getConversation(a.canonicalId);
}

async function readSignedPkg(entity) {
  const files = {
    'project.json': JSON.stringify({
      version: '1.1',
      name: 'Audit',
      sourceIds: [entity.canonicalId],
      sources: [{ canonicalId: entity.canonicalId, path: 'conversations/source.json' }]
    }),
    'conversations/source.json': JSON.stringify(entity)
  };
  const fileHashes = {};
  for (const [k, v] of Object.entries(files)) fileHashes[k] = Crypto.sha256(v);
  files['portability/receipt.json'] = JSON.stringify({ fileHashes });
  return Bundle.readProjectPackage(Zip.createZip(files));
}

function mockGeminiDoc(turns) {
  return {
    title: 'Test - Gemini',
    querySelectorAll: () =>
      turns.map(([tag, text]) => ({
        nodeType: 1,
        tagName: tag,
        childNodes: [{ nodeType: 3, textContent: text }],
        textContent: text,
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
      }))
  };
}

test('R5 P1 A10: buildPdfAsync PNG->JPEG conversion never overwrites assetId with another asset filename', async () => {
  const origBitmap = globalThis.createImageBitmap;
  const origCanvas = globalThis.OffscreenCanvas;
  try {
    let callSeq = 0;
    const redJpeg = makeFakeJpeg(0xaa);
    const blueJpeg = makeFakeJpeg(0xbb);
    globalThis.createImageBitmap = async (blob) => {
      const idx = callSeq++;
      return { width: 1, height: 1, _tag: idx, close() {} };
    };
    globalThis.OffscreenCanvas = class {
      constructor() { this._tag = 0; }
      getContext() {
        return {
          fillRect() {},
          drawImage: (bmp) => { this._tag = bmp._tag; }
        };
      }
      async convertToBlob() {
        const bytes = this._tag === 0 ? redJpeg : blueJpeg;
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
    };

    const a1 = { assetId: 'b.png', id: 'b.png', sourceMessageId: 'm0', messageIndex: 0, kind: 'image', mimeType: 'image/png', filename: 'a.png', data: new Uint8Array(makePng(11)) };
    const a2 = { assetId: 'b', id: 'b', sourceMessageId: 'm1', messageIndex: 1, kind: 'image', mimeType: 'image/png', filename: 'b.png', data: new Uint8Array(makePng(22)) };
    const entity = {
      title: 'RedBlue',
      messages: [
        { ...turn('m0', 'Red'), attachments: [a1] },
        { ...turn('m1', 'Blue'), attachments: [a2] }
      ]
    };
    const assetMap = new Map([['b.png', a1.data], ['b', a2.data]]);
    const pdfBytes = await Pdf.buildPdfAsync(entity, { assets: [a1, a2], assetMap });
    const rawPdf = Buffer.from(pdfBytes);
    assert.ok(rawPdf.includes(Buffer.from(redJpeg)), 'Debe conservar el JPEG de la primera imagen (rojo)');
    assert.ok(rawPdf.includes(Buffer.from(blueJpeg)), 'Debe conservar el JPEG de la segunda imagen (azul)');
  } finally {
    globalThis.createImageBitmap = origBitmap;
    globalThis.OffscreenCanvas = origCanvas;
  }
});

test('R5 P1 A06/A07/A08: LinerDB retains partially omitted attachments, codeBlocks, and shifted window order', async () => {
  // A06: 2 hydrated attachments -> recapture with only 1 -> both retained
  const img1 = 'data:image/png;base64,' + makePng(11).toString('base64');
  const img2 = 'data:image/png;base64,' + makePng(22).toString('base64');
  const savedA06 = await savePair(
    {
      canonicalId: 'r5_a06',
      messages: [{
        ...turn('m1', 'Text'),
        attachments: [
          { id: 'att_1', url: 'https://x.test/1', dataURI: img1 },
          { id: 'att_2', url: 'https://x.test/2', dataURI: img2 }
        ]
      }]
    },
    {
      canonicalId: 'r5_a06',
      messages: [{
        ...turn('m1', 'Text'),
        attachments: [{ id: 'att_1', url: 'https://x.test/1' }]
      }]
    }
  );
  assert.equal(savedA06.messages[0].attachments.length, 2, 'No debe perder el segundo adjunto omitido');
  assert.equal(savedA06.messages[0].attachments[0].dataURI, img1);
  assert.equal(savedA06.messages[0].attachments[1].dataURI, img2);

  // A08: persisted codeBlocks never regress on shorter stale recapture
  const savedA08 = await savePair(
    {
      canonicalId: 'r5_a08',
      messages: [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'const a = 1;\nconst b = 2;' }] }]
    },
    {
      canonicalId: 'r5_a08',
      messages: [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'const a = 1;' }] }]
    }
  );
  assert.equal(savedA08.messages[0].codeBlocks[0].code, 'const a = 1;\nconst b = 2;');

  // A07: scroll-up shifted window [b,c] -> [a,b] preserves chronological order [a,b,c]
  const savedScrollUp = await savePair(
    { canonicalId: 'r5_a07_up', integrity: { status: 'captured' }, messages: [turn('b', 'B'), turn('c', 'C')] },
    { canonicalId: 'r5_a07_up', integrity: { status: 'captured' }, messages: [turn('a', 'A'), turn('b', 'B')] }
  );
  assert.deepEqual(savedScrollUp.messages.map(m => m.id), ['a', 'b', 'c']);

  // A07: scroll-down shifted window [a,b] -> [b,c] preserves [a,b,c]
  const savedScrollDown = await savePair(
    { canonicalId: 'r5_a07_down', integrity: { status: 'captured' }, messages: [turn('a', 'A'), turn('b', 'B')] },
    { canonicalId: 'r5_a07_down', integrity: { status: 'captured' }, messages: [turn('b', 'B'), turn('c', 'C')] }
  );
  assert.deepEqual(savedScrollDown.messages.map(m => m.id), ['a', 'b', 'c']);
});

test('R5 P1 A27: Gemini turn IDs hash full content beyond 160 chars without collision', async () => {
  const prefix200 = 'P'.repeat(200);
  const url = 'https://gemini.google.com/app/longprefix';
  const convA = Multi.extractGeminiDom(mockGeminiDoc([['USER-QUERY', prefix200 + '_END_ONE']]), url);
  const convB = Multi.extractGeminiDom(mockGeminiDoc([['USER-QUERY', prefix200 + '_END_TWO']]), url);
  assert.notEqual(convA.messages[0].id, convB.messages[0].id, 'Mensajes con prefijo >160 chars idéntico y final distinto deben tener IDs distintos');
  const saved = await savePair(convA, convB);
  assert.equal(saved.messages.length, 2, 'Ninguno de los dos mensajes debe sobrescribir al otro en LinerDB');
});

test('R5 P1 A11/A12: same-message collision with md_img_* or ptr_* preserves both resources', async () => {
  // Same-message A11: explicit attachment 'md_img_0_0' + inline markdown image in msg 0
  const convA11 = {
    title: 'SameMsgInline',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: '![inline](data:image/png;base64,' + makePng(22).toString('base64') + ')',
      attachments: [att('md_img_0_0', 11, 'first.png')]
    }]
  };
  const resolvedA11 = AssetResolver.resolveAssetsForEntity(convA11);
  assert.equal(resolvedA11.length, 2, 'Debe conservar tanto el adjunto explícito como la imagen Markdown inline');
  assert.equal(new Set(resolvedA11.map(a => a.assetId)).size, 2);
  const expA11 = await new ExportCenter().exportSingle(convA11, 'md', 'ai', { imageStrategy: 'package' });
  const zipA11 = await Zip.unzip(expA11.data);
  assert.equal(enc(zipA11['assets/first.png']), enc(makePng(11)));

  // Same-message A12: explicit attachment 'ptr_0_0' + image_asset_pointer in msg 0
  const convA12 = {
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Pointer msg',
      attachments: [att('ptr_0_0', 11)],
      content: { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-remote-xyz' }] }
    }]
  };
  const resolvedA12 = AssetResolver.resolveAssetsForEntity(convA12);
  assert.equal(resolvedA12.length, 2, 'Debe conservar tanto el adjunto explícito como el puntero en content.parts');
  assert.equal(new Set(resolvedA12.map(a => a.assetId)).size, 2);
});

test('R5 P2 Import: non-string asset_pointer in content.parts rejects at import boundary and never crashes export', async () => {
  await assert.rejects(() =>
    readSignedPkg({
      canonicalId: 'bad-part-ptr',
      title: 'Bad Part Pointer',
      messages: [{ role: 'assistant', text: 'Hi', content: { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 123 }] } }]
    })
  );
  await assert.doesNotReject(() =>
    new ExportCenter().exportSingle(
      { canonicalId: 'mem-bad-part', title: 'Direct', messages: [{ role: 'assistant', text: 'Hi', content: { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 123 }] } }] },
      'md',
      'ai',
      { imageStrategy: 'package' }
    )
  );
});

test('R5 P2 CommonMark: tilde fences no duplication, blockquoted fences preserve literals, images in code never fetch', async () => {
  // 1. Tilde fence does not duplicate stored codeBlocks in Markdown export
  const mdTilde = await new ExportCenter().exportSingle(
    {
      messages: [{
        role: 'assistant',
        text: '~~~js\nUNIQUE_TILDE_CODE\n~~~',
        codeBlocks: [{ language: 'js', code: 'UNIQUE_TILDE_CODE' }]
      }]
    },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.equal((mdTilde.data.match(/UNIQUE_TILDE_CODE/g) || []).length, 1);

  // 2. Blockquoted fenced code preserves literal <Cite/>
  const mdBq = await new ExportCenter().exportSingle(
    {
      messages: [{
        role: 'assistant',
        text: '> ```xml\n> <Cite href="BQ_LITERAL"/>\n> ```'
      }]
    },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.ok(mdBq.data.includes('<Cite href="BQ_LITERAL"/>'), 'Debe preservar literales dentro de cercas en blockquote');

  // 3. Images inside fenced code or inline code never produce assets or network fetches
  const fetchedUrls = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetchedUrls.push(String(url));
      throw new Error('should not fetch');
    };
    const codeImgEntity = {
      canonicalId: 'code_imgs',
      messages: [{
        id: 'm0',
        role: 'assistant',
        text: 'Inline: `![inline](https://evil.test/inline.png)`\n\n```md\n![fenced](https://evil.test/fenced.png)\n```\n\n> ~~~md\n> ![bq](https://evil.test/bq.png)\n> ~~~'
      }]
    };
    const res = await AssetResolver.resolveAssetBinaries(codeImgEntity, { imageStrategy: 'package' });
    assert.equal(res.assets.length, 0, 'No debe descubrir imágenes escritas dentro de código literal');
    assert.deepEqual(fetchedUrls, [], 'No debe emitir peticiones de red por imágenes dentro de código literal');
  } finally {
    globalThis.fetch = origFetch;
  }
});
