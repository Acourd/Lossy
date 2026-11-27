'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 7 — AMD-56)
 * Cubre las 6 regresiones reproducidas en la Ronda 7:
 * 1. P1 assetId/fileId: un adjunto independiente cuyo assetId coincide con fileId de otro NO hereda sus bytes ni desaparece, incluso si el primero carece de bytes locales
 * 2. P1 top-level dataURI: un duplicado en entity.attachments con la única dataURI local hidrata el recurso de mensaje en lugar de descartarse
 * 3. P1 merge de bloques: ['FIRST'] -> ['SECOND_LONG_UNIQUE'] conserva ambos y el emparejamiento ambiguo por contención no corrompe bloques previos
 * 4. P2 cierre de cercas CommonMark: líneas indentadas 4+ espacios o con `>` dentro de una cerca top-level NO cierran la cerca ni exponen literales/fetch
 * 5. P2 imagen escapada: `\![literal](URL)` no descubre recursos, no dispara fetch y permanece intacta en Markdown
 * 6. P2 inline span: `` !`code`[link](URL) `` no colapsa en `![link](URL)` ni dispara fetch
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
const turn = (id, text, extra = {}) => ({ id, role: 'assistant', text, ...extra });

async function savePair(a, b) {
  const db = new LinerDB();
  await db.saveConversation(a);
  await db.saveConversation(b);
  return db.getConversation(a.canonicalId);
}

test('R7 P1 assetId/fileId: distinct asset matching another asset fileId keeps both assets intact even when first lacks bytes', async () => {
  const conv = {
    title: 'CrossIdBytes',
    messages: [{
      id: 'm0',
      role: 'assistant',
      text: 'Two separate images',
      attachments: [
        { id: 'img_1', assetId: 'img_1', fileId: 'file-shared', kind: 'image', mimeType: 'image/png', filename: 'first.png' },
        { id: 'file-shared', assetId: 'file-shared', kind: 'image', mimeType: 'image/png', filename: 'second.png', data: new Uint8Array(makePng(77)) }
      ]
    }]
  };
  const resolved = AssetResolver.resolveAssetsForEntity(conv);
  assert.equal(resolved.length, 2, 'Deben conservarse ambos recursos');
  assert.equal(resolved[0].data, null);
  assert.equal(enc(resolved[1].data), enc(makePng(77)));

  const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
  const zip = await Zip.unzip(exp.data);
  assert.equal(enc(zip['assets/second.png']), enc(makePng(77)));
});

test('R7 P1 top-level dataURI: duplicate entity.attachments entry carrying sole local dataURI hydrates message asset into ZIP', async () => {
  const pngBytes = makePng(88);
  const dataURI = 'data:image/png;base64,' + pngBytes.toString('base64');
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 410 });
    const conv = {
      title: 'TopDataUri',
      messages: [{
        id: 'm0',
        role: 'assistant',
        text: 'Image with expired remote URL',
        attachments: [{ id: 'a1', assetId: 'a1', kind: 'image', mimeType: 'image/png', filename: 'photo.png', sourceURL: 'https://expired.test/photo.png' }]
      }],
      attachments: [{ id: 'a1', assetId: 'a1', kind: 'image', mimeType: 'image/png', filename: 'photo.png', sourceURL: 'https://expired.test/photo.png', dataURI }]
    };
    const exp = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
    const zip = await Zip.unzip(exp.data);
    assert.ok(zip['assets/photo.png'], 'La imagen hidratada desde entity.attachments.dataURI debe empaquetarse en el ZIP');
    assert.equal(enc(zip['assets/photo.png']), enc(pngBytes));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('R7 P1 codeBlocks merge: [FIRST] -> [SECOND_LONG_UNIQUE] preserves both and ambiguous containment never corrupts', async () => {
  // 1. Unrelated 1-to-1 different blocks preserve both
  const savedUnrelated = await savePair(
    { canonicalId: 'r7_cb1', messages: [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'FIRST' }] }] },
    { canonicalId: 'r7_cb1', messages: [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'SECOND_LONG_UNIQUE' }] }] }
  );
  assert.deepEqual(savedUnrelated.messages[0].codeBlocks.map(b => b.code), ['FIRST', 'SECOND_LONG_UNIQUE']);

  const csUnrelated = CS.alignAndAppendTurns(
    [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'FIRST' }] }],
    [{ ...turn('m1', 'Code'), codeBlocks: [{ language: 'js', code: 'SECOND_LONG_UNIQUE' }] }]
  );
  assert.deepEqual(csUnrelated[0].codeBlocks.map(b => b.code), ['FIRST', 'SECOND_LONG_UNIQUE']);

  // 2. Ambiguous containment: full [x\nalpha, x\nbeta] + stale recapture [x] preserves both without corrupting or duplicating
  const fullBlocks = [{ language: 'js', code: 'shared()\n// alpha' }, { language: 'js', code: 'shared()\n// beta' }];
  const staleAmbiguous = [{ language: 'js', code: 'shared()' }];
  const savedAmbig = await savePair(
    { canonicalId: 'r7_cb_ambig', messages: [{ ...turn('m1', 'Code'), codeBlocks: fullBlocks }] },
    { canonicalId: 'r7_cb_ambig', messages: [{ ...turn('m1', 'Code'), codeBlocks: staleAmbiguous }] }
  );
  assert.deepEqual(savedAmbig.messages[0].codeBlocks.map(b => b.code), ['shared()\n// alpha', 'shared()\n// beta']);

  const csAmbig = CS.alignAndAppendTurns(
    [{ ...turn('m1', 'Code'), codeBlocks: fullBlocks }],
    [{ ...turn('m1', 'Code'), codeBlocks: staleAmbiguous }]
  );
  assert.deepEqual(csAmbig[0].codeBlocks.map(b => b.code), ['shared()\n// alpha', 'shared()\n// beta']);
});

test('R7 P2 CommonMark: indented/blockquote lines inside fence never close it, escaped \\![...] and !`code`[...] never fetch', async () => {
  const fetchedUrls = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetchedUrls.push(String(url));
      throw new Error('should not fetch');
    };
    const text = [
      '```md',
      '    ```',
      '> ```',
      '![inside_indented_or_bq_close](https://evil.test/fenced.png)',
      '<Cite href="INSIDE_FENCE"/>',
      '```',
      '',
      'Escaped: \\![literal](https://evil.test/escaped.png)',
      '',
      'Split span: !`code`[link](https://evil.test/span.png)'
    ].join('\n');

    const res = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'cm_r7', messages: [{ id: 'm0', role: 'assistant', text }] },
      { imageStrategy: 'package' }
    );
    assert.equal(res.assets.length, 0, 'Cero recursos descubiertos');
    assert.deepEqual(fetchedUrls, [], 'Cero llamadas fetch interceptadas');

    const md = await new ExportCenter().exportSingle(
      { messages: [{ role: 'assistant', text }] },
      'md',
      'ai',
      { imageStrategy: 'omit' }
    );
    assert.ok(md.data.includes('<Cite href="INSIDE_FENCE"/>'));
    assert.ok(md.data.includes('\\![literal](https://evil.test/escaped.png)'));
    assert.ok(md.data.includes('!`code`[link](https://evil.test/span.png)'));
  } finally {
    globalThis.fetch = origFetch;
  }
});
