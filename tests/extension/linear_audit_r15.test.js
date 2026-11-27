'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const { parseZip } = require('../../extension/src/core/portability/zip_builder');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R15 P2 Recursos A1: HTML con application/octet-stream, kind image y original.svg se rechaza en Blob, ArrayBuffer, dataURI y fetch', async () => {
  const htmlBytes = Buffer.from('<!DOCTYPE html><html><body>fake svg</body></html>', 'utf8');
  const htmlUri = `data:application/octet-stream;base64,${htmlBytes.toString('base64')}`;

  const cases = [
    { name: 'Blob', att: { id: 'a1', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', data: new Uint8Array(htmlBytes) } },
    { name: 'ArrayBuffer', att: { id: 'a2', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', data: Uint8Array.from(htmlBytes).buffer } },
    { name: 'dataURI', att: { id: 'a3', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', dataURI: htmlUri } },
    { name: 'fetch', att: { id: 'a4', kind: 'image', filename: 'original.svg', mimeType: 'application/octet-stream', sourceURL: 'https://example.com/fake.svg' } }
  ];

  const fakeFetch = async () => new Response(htmlBytes, { headers: { 'content-type': 'text/html' } });
  for (const c of cases) {
    const conv = { canonicalId: `r15_${c.name}`, title: c.name, messages: [{ id: 'm1', role: 'assistant', text: 'img', attachments: [structuredClone(c.att)] }] };
    const res = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetch });
    assert.notEqual(res.assets[0].availability, 'downloaded', `${c.name}: fetch HTML bajo .svg no debe descargarse`);
    assert.notEqual(res.assets[0].availability, 'embedded', `${c.name}: embedded HTML bajo .svg no debe aceptarse`);
    assert.equal(res.assetBinaryMap.has(c.att.id), false, `${c.name}: assetBinaryMap no debe contener payload`);
    assert.ok(res.assets[0].warnings.length > 0, `${c.name}: debe emitir advertencia explícita`);

    const zipRes = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package', fetch: fakeFetch });
    const files = parseZip(zipRes.data);
    assert.equal(Object.prototype.hasOwnProperty.call(files, 'assets/original.svg'), false, `${c.name}: ZIP no debe contener assets/original.svg`);
  }
});

test('R15 P2 Recursos A2: JSON declarado image/png se rechaza en Blob, ArrayBuffer, dataURI y fetch', async () => {
  const jsonBytes = Buffer.from('{"error":"unauthorized","ok":false}', 'utf8');
  const jsonUri = `data:image/png;base64,${jsonBytes.toString('base64')}`;

  const cases = [
    { name: 'Blob', att: { id: 'j1', filename: 'original.png', mimeType: 'image/png', data: new Uint8Array(jsonBytes) } },
    { name: 'ArrayBuffer', att: { id: 'j2', filename: 'original.png', mimeType: 'image/png', data: Uint8Array.from(jsonBytes).buffer } },
    { name: 'dataURI', att: { id: 'j3', filename: 'original.png', mimeType: 'image/png', dataURI: jsonUri } },
    { name: 'fetch', att: { id: 'j4', filename: 'original.png', mimeType: 'image/png', sourceURL: 'https://example.com/api.json' } }
  ];

  const fakeFetchJson = async () => new Response(jsonBytes, { headers: { 'content-type': 'image/png' } });
  for (const c of cases) {
    const conv = { canonicalId: `r15j_${c.name}`, title: c.name, messages: [{ id: 'm1', role: 'assistant', text: 'img', attachments: [structuredClone(c.att)] }] };
    const res = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetchJson });
    assert.equal(res.assetBinaryMap.has(c.att.id), false, `${c.name}: JSON bajo image/png no debe aceptarse`);
    assert.ok(res.assets[0].warnings.length > 0, `${c.name}: debe emitir advertencia`);

    const zipRes = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'package', fetch: fakeFetchJson });
    const files = parseZip(zipRes.data);
    assert.equal(Object.prototype.hasOwnProperty.call(files, 'assets/original.png'), false, `${c.name}: ZIP no debe contener assets/original.png`);
  }
});

test('R15 P2 Recursos A3: XHTML válido con prólogo XML conserva paridad entre embebido y fetch', async () => {
  const xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>X</title></head><body><p>Ok</p></body></html>';
  const xhtmlBytes = Buffer.from(xhtml, 'utf8');
  const xhtmlUri = `data:application/xhtml+xml;base64,${xhtmlBytes.toString('base64')}`;

  const embConv = {
    canonicalId: 'r15_xhtml_emb',
    title: 'XHTML Emb',
    messages: [{ id: 'm1', role: 'assistant', text: 'doc', attachments: [{ id: 'x1', filename: 'doc.xhtml', mimeType: 'application/xhtml+xml', dataURI: xhtmlUri }] }]
  };
  const fetchConv = {
    canonicalId: 'r15_xhtml_fetch',
    title: 'XHTML Fetch',
    messages: [{ id: 'm1', role: 'assistant', text: 'doc', attachments: [{ id: 'x2', filename: 'doc.xhtml', mimeType: 'application/xhtml+xml', sourceURL: 'https://example.com/doc.xhtml' }] }]
  };

  const embRes = await AssetResolver.resolveAssetBinaries(embConv);
  const fetchRes = await AssetResolver.resolveAssetBinaries(fetchConv, {
    fetch: async () => new Response(xhtmlBytes, { headers: { 'content-type': 'application/xhtml+xml' } })
  });

  assert.equal(embRes.assets[0].availability, 'embedded');
  assert.equal(embRes.assetBinaryMap.has('x1'), true);
  assert.equal(fetchRes.assets[0].availability, 'downloaded');
  assert.equal(fetchRes.assetBinaryMap.has('x2'), true);
  assert.deepEqual(Array.from(embRes.assetBinaryMap.get('x1')), Array.from(fetchRes.assetBinaryMap.get('x2')));
});

test('R15 P2 Código B1: Literal \\<Cite id="KEEP_LITERAL"/> fin preserva etiqueta en Markdown, TXT y HTML', async () => {
  const text = 'Literal \\<Cite id="KEEP_LITERAL"/> fin';
  const conv = { canonicalId: 'r15_cite', title: 'Cite Escape', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text }] };

  const center = new ExportCenter();
  const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const htmlDoc = HtmlBuilder.buildStandaloneHtml(conv);
  const prep = await DocumentModel.prepare([conv], { includeImages: false });

  assert.match(md.data, /KEEP_LITERAL/, 'Markdown debe conservar KEEP_LITERAL');
  assert.match(txt.data, /KEEP_LITERAL/, 'TXT debe conservar KEEP_LITERAL');
  assert.match(htmlDoc, /KEEP_LITERAL/, 'HtmlBuilder HTML debe conservar KEEP_LITERAL');
  assert.match(prep.html, /KEEP_LITERAL/, 'DocumentModel HTML debe conservar KEEP_LITERAL');
  assert.match(prep.markdown, /KEEP_LITERAL/, 'DocumentModel Markdown debe conservar KEEP_LITERAL');
});

test('R15 P2 Código B2 & B3: <grid> con 4 espacios y cercas ~~~ en citas/listas no se transforman en widgets en ChatGPTWidgets, HtmlBuilder ni DocumentModel', async () => {
  const indented = 'Intro:\n\n    <grid cols="2"><card title="IND"/></grid>';
  assert.equal(ChatGPTWidgets.hasVisualWidgets(indented), false);
  assert.equal(ChatGPTWidgets.renderWidgetsToHtml(indented), indented);
  assert.equal(HtmlBuilder.buildStandaloneHtml({ title: 'Indented', messages: [{ id: 'm1', role: 'assistant', text: indented }] }).includes('<div class="lossy-widget-root"'), false);
  const prepInd = await DocumentModel.prepare([{ canonicalId: 'ind', title: 'Ind', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: indented }] }], { includeImages: false });
  assert.equal(prepInd.html.includes('class="lossy-widget-root"'), false);
  assert.match(prepInd.html, /<pre><code>/);

  const tildeInQuote = '> ~~~\n> <grid cols="2"><card title="Q_TILDE"/></grid>\n> ~~~';
  const tildeInList = '- item\n\n  ~~~\n  <grid cols="2"><card title="L_TILDE"/></grid>\n  ~~~';
  for (const sample of [tildeInQuote, tildeInList]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false);
    const hb = HtmlBuilder.buildStandaloneHtml({ title: 'Tilde', messages: [{ id: 'm1', role: 'assistant', text: sample }] });
    assert.equal(hb.includes('<div class="lossy-widget-root"'), false);
    const dm = await DocumentModel.prepare([{ canonicalId: 'td', title: 'Tilde', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] }], { includeImages: false });
    assert.equal(dm.html.includes('class="lossy-widget-root"'), false);
  }
});

test('R15 P2 Código B4: backticks separados por encabezado, lista, cita o separador no suprimen widgets reales', async () => {
  const separators = ['# Título', '- elemento de lista', '> cita en bloque', '---'];
  for (const sep of separators) {
    const md = [
      'Texto con `backtick sin cerrar',
      sep,
      '<grid cols="2"><card><text>REAL_WIDGET</text></card></grid>',
      'y cierre `'
    ].join('\n');

    assert.equal(ChatGPTWidgets.hasVisualWidgets(md), true, `Separador "${sep}" debe cortar el span inline y detectar widget`);
    const htmlW = ChatGPTWidgets.renderWidgetsToHtml(md);
    assert.match(htmlW, /class="lossy-widget-root"/, `Widgets HTML con separador "${sep}"`);
    assert.match(htmlW, /REAL_WIDGET/, `Contenido widget presente con separador "${sep}"`);

    const hb = HtmlBuilder.buildStandaloneHtml({ title: 'Break', messages: [{ id: 'm1', role: 'assistant', text: md }] });
    assert.match(hb, /class="lossy-widget-root"/, `HtmlBuilder debe renderizar widget tras "${sep}"`);

    const dm = await DocumentModel.prepare([{ canonicalId: 'b4', title: 'Break', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: md }] }], { includeImages: false });
    assert.match(dm.html, /class="lossy-widget-root"/, `DocumentModel debe renderizar widget tras "${sep}"`);
  }
});
