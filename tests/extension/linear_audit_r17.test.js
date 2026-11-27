'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R17 P2 #1: continuación implícita de cita (lazy blockquote con 4 espacios) preserva span inline, widget literal y KEEP_CITE', async () => {
  const sample = [
    '> `<grid cols="2"><card><text>LITERAL</text></card></grid>',
    '    <Cite id="KEEP_CITE"/> end`'
  ].join('\n');

  assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false, 'Lazy blockquote continuation mantiene código inline completo');
  assert.match(ChatGPTWidgets.renderWidgetsToMarkdown(sample), /KEEP_CITE/);
  assert.match(ChatGPTWidgets.renderWidgetsToPlainText(sample), /KEEP_CITE/);
  assert.equal(ChatGPTWidgets.renderWidgetsToHtml(sample).includes('lossy-widget-root'), false);

  const conv = { canonicalId: 'r17_lazy_bq', title: 'Lazy BQ', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
  const center = new ExportCenter();
  const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const hb = HtmlBuilder.buildStandaloneHtml(conv);
  const dm = await DocumentModel.prepare([conv], { includeImages: false });

  assert.match(md.data, /KEEP_CITE/);
  assert.match(txt.data, /KEEP_CITE/);
  assert.match(hb, /KEEP_CITE/);
  assert.match(dm.html, /KEEP_CITE/);
  assert.equal(hb.includes('<div class="lossy-widget-root"'), false);
  assert.equal(dm.html.includes('class="lossy-widget-root"'), false);

  // Control: si continúa un segundo párrafo no citado tras línea en blanco, indented sí aplica
  const blankAfterBq = [
    '> cita previa',
    '',
    '    <grid cols="2"><card><text>IND</text></card></grid> <Cite id="KEEP_AFTER"/>'
  ].join('\n');
  assert.equal(ChatGPTWidgets.hasVisualWidgets(blankAfterBq), false);
  assert.match(ChatGPTWidgets.renderWidgetsToMarkdown(blankAfterBq), /KEEP_AFTER/);
});

test('R17 P2 #2: código inline no atraviesa dos elementos de lista (tight y loose), renderiza widget real y limpia KEEP_CITE', async () => {
  const tightSample = [
    '1. intro',
    '   `<grid cols="2"><card><text>LITERAL</text></card></grid>',
    '2. <Cite id="KEEP_CITE"/> end`'
  ].join('\n');

  const looseSample = [
    '1. intro',
    '',
    '   `<grid cols="2"><card><text>LITERAL</text></card></grid>',
    '',
    '2. <Cite id="KEEP_CITE"/> end`'
  ].join('\n');

  const center = new ExportCenter();
  for (const [label, sample] of [['tight', tightSample], ['loose', looseSample]]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true, `${label}: elementos de lista distintos no forman inline span`);
    const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
    assert.match(htmlW, /class="lossy-widget-root"/, `${label}: ChatGPTWidgets renderiza widget real`);
    assert.match(htmlW, /LITERAL/, `${label}: contenido del widget presente`);
    assert.equal(htmlW.includes('KEEP_CITE'), false, `${label}: Cite fuera de inline debe limpiarse`);

    const conv = { canonicalId: `r17_list_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv);
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(md.data.includes('KEEP_CITE'), false, `${label}: Markdown limpia Cite fuera de inline`);
    assert.equal(txt.data.includes('KEEP_CITE'), false, `${label}: TXT limpia Cite fuera de inline`);
    assert.match(hb, /class="lossy-widget-root"/, `${label}: HtmlBuilder renderiza widget real`);
    assert.equal(hb.includes('KEEP_CITE'), false, `${label}: HtmlBuilder limpia Cite fuera de inline`);
    assert.match(dm.html, /class="lossy-widget-root"/, `${label}: DocumentModel renderiza widget real`);
    assert.equal(dm.html.includes('KEEP_CITE'), false, `${label}: DocumentModel limpia Cite fuera de inline`);
  }
});
