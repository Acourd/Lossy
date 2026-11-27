'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const { parseZip } = require('../../extension/src/core/portability/zip_builder');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

function toUtf16(str, endian = 'le', withBom = true) {
  const buf = Buffer.from(str, 'utf16le');
  if (endian === 'be') {
    for (let i = 0; i < buf.length; i += 2) {
      const tmp = buf[i];
      buf[i] = buf[i + 1];
      buf[i + 1] = tmp;
    }
  }
  if (!withBom) return new Uint8Array(buf);
  const bom = Buffer.from(endian === 'le' ? [0xFF, 0xFE] : [0xFE, 0xFF]);
  return new Uint8Array(Buffer.concat([bom, buf]));
}

test('R16 P2 Recursos: DOCTYPE engañoso <!DOCTYPE html SYSTEM "svg"> se rechaza bajo original.svg', async () => {
  const badHtml = Buffer.from('<!DOCTYPE html SYSTEM "svg"><html><body><script>1</script></body></html>', 'utf8');
  const uri = `data:application/octet-stream;base64,${badHtml.toString('base64')}`;
  const channels = [
    { name: 'Blob', att: { id: 'd1', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', data: new Uint8Array(badHtml) } },
    { name: 'dataURI', att: { id: 'd2', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', dataURI: uri } },
    { name: 'fetch', att: { id: 'd3', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', sourceURL: 'https://example.com/deceptive.svg' } }
  ];
  const fakeFetch = async () => new Response(badHtml, { headers: { 'content-type': 'application/octet-stream' } });

  for (const ch of channels) {
    const conv = { canonicalId: `r16_doc_${ch.name}`, title: ch.name, messages: [{ id: 'm1', role: 'assistant', text: 'svg', attachments: [structuredClone(ch.att)] }] };
    const res = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetch });
    assert.equal(res.assetBinaryMap.has(ch.att.id), false, `${ch.name}: HTML con SYSTEM "svg" no debe aceptarse`);
    const zip = parseZip((await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package', fetch: fakeFetch })).data);
    assert.equal(Object.prototype.hasOwnProperty.call(zip, 'assets/original.svg'), false, `${ch.name}: no debe emitir assets/original.svg`);
  }
});

test('R16 P2 Recursos: HTML y JSON en UTF-16 (LE/BE, con y sin BOM) no se aceptan como imágenes', async () => {
  const htmlStr = '<!DOCTYPE html><html><body>not an image</body></html>';
  const jsonStr = '{"error":"forbidden","code":403}';

  const payloads = [
    { label: 'HTML-UTF16LE-BOM', bytes: toUtf16(htmlStr, 'le', true) },
    { label: 'HTML-UTF16BE-BOM', bytes: toUtf16(htmlStr, 'be', true) },
    { label: 'HTML-UTF16LE-NOBOM', bytes: toUtf16(htmlStr, 'le', false) },
    { label: 'HTML-UTF16BE-NOBOM', bytes: toUtf16(htmlStr, 'be', false) },
    { label: 'JSON-UTF16LE-BOM', bytes: toUtf16(jsonStr, 'le', true) },
    { label: 'JSON-UTF16BE-NOBOM', bytes: toUtf16(jsonStr, 'be', false) }
  ];

  for (const p of payloads) {
    const uri = `data:image/png;base64,${Buffer.from(p.bytes).toString('base64')}`;
    const variants = [
      { kind: 'Blob', att: { id: 'u_b', filename: 'original.png', mimeType: 'image/png', data: new Uint8Array(p.bytes) } },
      { kind: 'ArrayBuffer', att: { id: 'u_a', filename: 'original.png', mimeType: 'image/png', data: p.bytes.buffer.slice(p.bytes.byteOffset, p.bytes.byteOffset + p.bytes.byteLength) } },
      { kind: 'dataURI', att: { id: 'u_u', filename: 'original.png', mimeType: 'image/png', dataURI: uri } },
      { kind: 'fetch', att: { id: 'u_f', filename: 'original.png', mimeType: 'image/png', sourceURL: `https://example.com/${p.label}.png` } }
    ];
    const fakeFetch = async () => new Response(p.bytes, { headers: { 'content-type': 'image/png' } });
    for (const v of variants) {
      const conv = { canonicalId: `r16_${p.label}_${v.kind}`, title: p.label, messages: [{ id: 'm1', role: 'assistant', text: 'img', attachments: [structuredClone(v.att)] }] };
      const res = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetch });
      assert.equal(res.assetBinaryMap.has(v.att.id), false, `${p.label}/${v.kind}: no debe retener payload en assetBinaryMap`);
      assert.ok(res.assets[0].warnings.length > 0, `${p.label}/${v.kind}: debe registrar advertencia`);
      const zip = parseZip((await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package', fetch: fakeFetch })).data);
      assert.equal(Object.prototype.hasOwnProperty.call(zip, 'assets/original.png'), false, `${p.label}/${v.kind}: no debe generar assets/original.png`);
    }
  }
});

test('R16 P2 Código: inline multilínea dentro de citas o con continuación 2. preserva widgets literales y KEEP_CITE', async () => {
  const quoteSample = [
    '> `<grid cols="2"><card><text>LITERAL_QUOTE</text></card></grid>',
    '> <Cite id="KEEP_CITE"/> fin`'
  ].join('\n');

  const twoDotSample = [
    'Intro `<grid cols="2"><card><text>LITERAL_TWO</text></card></grid>',
    '2. <Cite id="KEEP_CITE"/> fin`'
  ].join('\n');

  const center = new ExportCenter();
  for (const [label, sample] of [['cita', quoteSample], ['2.', twoDotSample]]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false, `${label}: no debe detectar widgets`);
    const stripOut = ChatGPTWidgets.stripControlTokensOnly(sample);
    assert.match(stripOut, /KEEP_CITE/, `${label}: stripControlTokensOnly conserva KEEP_CITE`);

    const conv = { canonicalId: `r16_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv);
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.match(md.data, /KEEP_CITE/, `${label}: Markdown conserva KEEP_CITE`);
    assert.match(txt.data, /KEEP_CITE/, `${label}: TXT conserva KEEP_CITE`);
    assert.match(hb, /KEEP_CITE/, `${label}: HtmlBuilder conserva KEEP_CITE`);
    assert.match(dm.html, /KEEP_CITE/, `${label}: DocumentModel conserva KEEP_CITE`);
    assert.equal(hb.includes('<div class="lossy-widget-root"'), false, `${label}: HtmlBuilder no renderiza widget`);
    assert.equal(dm.html.includes('class="lossy-widget-root"'), false, `${label}: DocumentModel no renderiza widget`);
  }

  // Control mixto: tras span multi-línea con 2., un bloque indentado posterior también conserva KEEP_CITE
  const mixedTwoDot = [
    'Intro `<grid>',
    '2. end`',
    '',
    '    <Cite id="KEEP_CITE"/>'
  ].join('\n');
  assert.match(ChatGPTWidgets.renderWidgetsToMarkdown(mixedTwoDot), /KEEP_CITE/);
});

test('R16 P2 Código: bloque indentado 4 espacios tras encabezado, separador o cerca cerrada se aísla como código', async () => {
  const afterHeading = '# Encabezado\n    <grid cols="2"><card><text>IND_H1</text></card></grid> <Cite id="KEEP_IND"/>';
  const afterHr = '---\n    <grid cols="2"><card><text>IND_HR</text></card></grid> <Cite id="KEEP_IND"/>';
  const afterFence = '```\nconst x = 1;\n```\n    <grid cols="2"><card><text>IND_FN</text></card></grid> <Cite id="KEEP_IND"/>';

  const center = new ExportCenter();
  for (const [label, sample] of [['heading', afterHeading], ['hr', afterHr], ['fence', afterFence]]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false, `${label}: no debe activar widget`);
    const conv = { canonicalId: `r16_ind_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv);
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.match(md.data, /KEEP_IND/, `${label}: Markdown conserva KEEP_IND`);
    assert.match(txt.data, /KEEP_IND/, `${label}: TXT conserva KEEP_IND`);
    assert.equal(hb.includes('<div class="lossy-widget-root"'), false, `${label}: HtmlBuilder no renderiza widget`);
    assert.match(hb, /KEEP_IND/, `${label}: HtmlBuilder conserva KEEP_IND`);
    assert.equal(dm.html.includes('class="lossy-widget-root"'), false, `${label}: DocumentModel no renderiza widget`);
    assert.match(dm.html, /<pre><code>/, `${label}: DocumentModel produce <pre><code>`);
    assert.match(dm.html, /KEEP_IND/, `${label}: DocumentModel conserva KEEP_IND`);
  }
});
