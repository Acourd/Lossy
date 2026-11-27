'use strict';

/**
 * Lossy — Suite Permanente de Regresión (Auditoría @Linear Ronda 4 — AMD-56)
 * Cubre los 6 clústeres de defectos adversariales (A06–A28):
 * 1. P1: Persistencia / LinerDB (A06 adjuntos omitidos, A07 ventana desplazada, A08 bloques de código, A27 Gemini sin cruce de roles)
 * 2. P1: Identidad de activos / ExportCenter (A10 colisión ID vs filename, A11 md_img_*, A12 ptr_*)
 * 3. P1: Validación en frontera de importación + defensa en profundidad (A21, A22, A25, A26)
 * 4. P2: Escáner CommonMark unificado en Markdown/HTML/DOCX/PDF (A15, A16, A17, A18, A19, A28)
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
const Html = load('core/portability/html_builder');
const Docx = load('core/portability/docx_builder');
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

async function buildDocxXml(text, codeBlocks = []) {
  const files = await Zip.unzip(Docx.buildDocx({ title: 'Test', messages: [{ role: 'user', text, codeBlocks }] }));
  return Buffer.from(files['word/document.xml']).toString('utf8');
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

test('R4 A06: recapture omitting local hydrated attachments preserves bytes without forceOverwrite', async () => {
  const dataURI = 'data:image/png;base64,' + makePng(11).toString('base64');
  const first = {
    canonicalId: 'r4_a06',
    messages: [{ ...turn('a', 'Text'), attachments: [{ id: 'att_a', url: 'https://x.test/a', dataURI }] }]
  };
  const second = { ...first, messages: [{ ...turn('a', 'Text'), attachments: [] }] };
  const saved = await savePair(first, second);
  assert.equal(saved.messages[0].attachments.length, 1);
  assert.equal(saved.messages[0].attachments[0].dataURI, dataURI);
});

test('R4 A07: equal-sized shifted window [a,b] -> [b,c] retains prior message a', async () => {
  const first = {
    canonicalId: 'r4_a07',
    integrity: { status: 'captured' },
    messages: [turn('a', 'Original prompt'), turn('b', 'Original answer')]
  };
  const second = {
    ...first,
    messages: [turn('b', 'Original answer'), turn('c', 'New prompt')]
  };
  const saved = await savePair(first, second);
  assert.ok(saved.messages.some(m => m.id === 'a'), 'Debe conservar el mensaje previo a');
  assert.ok(saved.messages.some(m => m.id === 'b'), 'Debe conservar el mensaje superpuesto b');
  assert.ok(saved.messages.some(m => m.id === 'c'), 'Debe anexar el mensaje nuevo c');
});

test('R4 A08: same-count codeBlocks never regress to shorter stale capture', () => {
  const prev = { ...turn('a', 'Text'), codeBlocks: [{ language: 'js', code: 'FIRST\nIMPORTANT_LAST' }] };
  const stale = { ...turn('a', 'Text'), codeBlocks: [{ language: 'js', code: 'FIRST' }] };
  const merged = CS.alignAndAppendTurns([prev], [stale]);
  assert.equal(merged[0].codeBlocks[0].code, 'FIRST\nIMPORTANT_LAST');
});

test('R4 A27: Gemini extractor uses content-anchored IDs and LinerDB never assigns user prompt to assistant', async () => {
  const url = 'https://gemini.google.com/app/abc123';
  const first = Multi.extractGeminiDom(
    mockGeminiDoc([
      ['USER-QUERY', 'ORIGINAL_PRIVATE_USER_PROMPT_LONG'],
      ['MODEL-RESPONSE', 'ANSWER']
    ]),
    url
  );
  const second = Multi.extractGeminiDom(
    mockGeminiDoc([
      ['MODEL-RESPONSE', 'ANSWER'],
      ['USER-QUERY', 'NEXT']
    ]),
    url
  );
  const saved = await savePair(first, second);
  assert.ok(
    !saved.messages.some(m => m.role === 'assistant' && m.text === 'ORIGINAL_PRIVATE_USER_PROMPT_LONG'),
    'Un prompt de usuario nunca puede terminar asignado al rol assistant'
  );
  assert.ok(
    saved.messages.some(m => m.role === 'user' && m.text === 'ORIGINAL_PRIVATE_USER_PROMPT_LONG'),
    'El prompt original del usuario debe preservarse con rol user'
  );
});

test('R4 A10/A11/A12: assetId vs filename, md_img_* and ptr_* never collide or overwrite bytes', async () => {
  // A10: assetId 'b.png' with filename 'a.png' vs assetId 'b' with filename 'b.png'
  const convA10 = {
    title: 'Alias',
    messages: [
      { ...turn('m0', 'A'), attachments: [att('b.png', 11, 'a.png')] },
      { ...turn('m1', 'B'), attachments: [att('b', 22, 'b.png')] }
    ]
  };
  const expA10 = await new ExportCenter().exportSingle(convA10, 'md', 'ai', { imageStrategy: 'package' });
  const zipA10 = await Zip.unzip(expA10.data);
  assert.equal(enc(zipA10['assets/a.png']), enc(makePng(11)));
  assert.equal(enc(zipA10['assets/b.png']), enc(makePng(22)));

  // A11: explicit attachment ID matching generated md_img_1_0
  const convA11 = {
    title: 'Inline',
    messages: [
      { ...turn('m0', 'A'), attachments: [att('md_img_1_0', 11, 'first.png')] },
      turn('m1', '![inline](data:image/png;base64,' + makePng(22).toString('base64') + ')')
    ]
  };
  const expA11 = await new ExportCenter().exportSingle(convA11, 'md', 'ai', { imageStrategy: 'package' });
  const zipA11 = await Zip.unzip(expA11.data);
  assert.equal(enc(zipA11['assets/first.png']), enc(makePng(11)));

  // A12: explicit attachment ID matching generated ptr_1_0
  const convA12 = {
    messages: [
      { ...turn('m0', 'A'), attachments: [att('ptr_1_0', 11)] },
      { ...turn('m1', 'B'), content: { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-remote' }] } }
    ]
  };
  const resolvedA12 = AssetResolver.resolveAssetsForEntity(convA12);
  assert.equal(new Set(resolvedA12.map(a => a.assetId)).size, resolvedA12.length);
});

test('R4 A15/A16/A17/A18/A19/A28: unified CommonMark fenced code across Markdown, HTML, DOCX and PDF', async () => {
  // A15: indented fence preserves literal Cite
  const mdIndented = await new ExportCenter().exportSingle(
    { messages: [{ role: 'user', text: '  ````xml\n<Cite href="LITERAL"/>\n  `````' }] },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.ok(mdIndented.data.includes('<Cite href="LITERAL"/>'));

  // A16: tilde fence preserves literal Cite
  const mdTilde = await new ExportCenter().exportSingle(
    { messages: [{ role: 'user', text: '~~~~xml\n<Cite href="LITERAL"/>\n~~~~~' }] },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.ok(mdTilde.data.includes('<Cite href="LITERAL"/>'));

  // A17: DOCX closing fence with trailing spaces does not duplicate stored codeBlocks
  const xmlTrailing = await buildDocxXml('```js\nUNIQUE_TRAILING_LINE\n````   ', [
    { language: 'js', code: 'UNIQUE_TRAILING_LINE' }
  ]);
  assert.equal((xmlTrailing.match(/UNIQUE_TRAILING_LINE/g) || []).length, 1);

  // A18: DOCX never backtracks 4-backtick opening to 3-backtick
  const xmlUnclosed = await buildDocxXml('````md\nOUTER\n```\nSTILL_CODE');
  assert.doesNotMatch(xmlUnclosed, /\[`MD\]/);
  assert.equal((xmlUnclosed.match(/w:pStyle w:val="CodeBlock"/g) || []).length, 3);

  // A19: HTML CommonMark fence with info string stays code
  const html = Html.buildStandaloneHtml({
    messages: [{ role: 'user', text: '```js title="example"\nUNIQUE_INFO\n```' }]
  });
  assert.match(html, /<pre><code>UNIQUE_INFO<\/code><\/pre>/);

  // A28: PDF closing fence with trailing spaces does not duplicate stored codeBlocks
  const pdfBytes = Pdf.buildPdf({
    title: 'Test',
    messages: [
      {
        role: 'user',
        text: '```js\nUNIQUE_TRAILING_LINE\n````   ',
        codeBlocks: [{ language: 'js', code: 'UNIQUE_TRAILING_LINE' }]
      }
    ]
  });
  assert.equal((Buffer.from(pdfBytes).toString('latin1').match(/UNIQUE_TRAILING_LINE/g) || []).length, 1);
});

test('R4 A21/A22/A25/A26: import boundary rejects invalid codeBlocks/fileId/assetPointer AND exporters degrade safely', async () => {
  // Import boundary rejections
  assert.throws(() =>
    Bundle.validateEntity({
      canonicalId: 'v1',
      title: 'Bad codeBlock',
      messages: [{ role: 'user', text: 'ok', codeBlocks: [{ language: 1, code: 'hello' }] }]
    })
  );
  assert.throws(() =>
    Bundle.validateEntity({
      canonicalId: 'v2',
      title: 'Bad fileId',
      messages: [{ role: 'user', text: 'ok', attachments: [{ kind: 'image', fileId: { bad: true } }] }]
    })
  );
  await assert.rejects(() =>
    readSignedPkg({
      canonicalId: 'bad-language',
      title: 'Bad language',
      messages: [{ role: 'user', text: 'Text', codeBlocks: [{ language: 1, code: 'test' }] }]
    })
  );
  await assert.rejects(() =>
    readSignedPkg({
      canonicalId: 'bad-pointer',
      title: 'Bad pointer',
      messages: [{ role: 'user', text: 'Text', attachments: [{ kind: 'image', id: 'p', mimeType: 'image/png', assetPointer: 123 }] }]
    })
  );

  // Defense in depth: direct exporter calls on malformed in-memory entities still never crash
  await assert.doesNotReject(() =>
    new ExportCenter().exportSingle(
      { canonicalId: 'mem-bad-lang', title: 'Direct', messages: [{ role: 'user', text: 'Text', codeBlocks: [{ language: 1, code: 'test' }] }] },
      'docx'
    )
  );
  await assert.doesNotReject(() =>
    new ExportCenter().exportSingle(
      { canonicalId: 'mem-bad-ptr', title: 'Direct', messages: [{ role: 'user', text: 'Text', attachments: [{ kind: 'image', id: 'p', mimeType: 'image/png', assetPointer: 123 }] }] },
      'md',
      'ai',
      { imageStrategy: 'package' }
    )
  );
});
