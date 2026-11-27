'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R18 P2 #1: reaparición de > tras continuación implícita conserva span inline, bloque literal y KEEP_CITE', async () => {
  const sample = [
    '> `<grid cols="2"><card><text>LITERAL</text></card></grid>',
    '    <Cite id="KEEP_CITE"/> middle',
    '> end`'
  ].join('\n');

  assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false);
  const mdW = ChatGPTWidgets.renderWidgetsToMarkdown(sample);
  assert.match(mdW, /KEEP_CITE/);
  assert.match(ChatGPTWidgets.renderWidgetsToPlainText(sample), /KEEP_CITE/);
  assert.equal(ChatGPTWidgets.renderWidgetsToHtml(sample).includes('lossy-widget-root'), false);

  const conv = { canonicalId: 'r18_reappear_bq', title: 'Reappear BQ', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
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

  // Control imágenes Markdown dentro del mismo patrón: no debe disparar fetch
  let fetchCalls = 0;
  const imgSample = [
    '> `![lit](https://evil.test/reappear.png)',
    '    middle',
    '> end`'
  ].join('\n');
  await AssetResolver.resolveAssetBinaries({ messages: [{ id: 'm1', role: 'assistant', text: imgSample }] }, {
    fetch: async () => { fetchCalls++; return new Response(''); }
  });
  assert.equal(fetchCalls, 0);
});

test('R18 P2 #2 & #3: backticks entre ítems hermanos de lista anidada y tras cerca dentro de lista no emparejan', async () => {
  const nestedSibling = [
    '- 1. `<grid cols="2"><card><text>REAL</text></card></grid>',
    '  2. <Cite id="DROP_CITE"/> end`'
  ].join('\n');

  const afterFenceInList = [
    '1. ~~~',
    '   stuff',
    '   ~~~',
    '   `<grid cols="2"><card><text>REAL</text></card></grid>',
    '2. <Cite id="DROP_CITE"/> end`'
  ].join('\n');

  const center = new ExportCenter();
  for (const [label, sample] of [['nestedList', nestedSibling], ['afterFence', afterFenceInList]]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true, `${label}: debe detectar widget real`);
    const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
    assert.match(htmlW, /class="lossy-widget-root"/, `${label}: renderiza widget`);
    assert.match(htmlW, /REAL/, `${label}: contenido widget`);
    assert.equal(htmlW.includes('DROP_CITE'), false, `${label}: limpia DROP_CITE`);

    const conv = { canonicalId: `r18_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv);
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(md.data.includes('DROP_CITE'), false, `${label}: Markdown limpia DROP_CITE`);
    assert.equal(txt.data.includes('DROP_CITE'), false, `${label}: TXT limpia DROP_CITE`);
    assert.match(hb, /class="lossy-widget-root"/, `${label}: HtmlBuilder renderiza widget`);
    assert.equal(hb.includes('DROP_CITE'), false, `${label}: HtmlBuilder limpia DROP_CITE`);
    assert.match(dm.html, /class="lossy-widget-root"/, `${label}: DocumentModel renderiza widget`);
    assert.equal(dm.html.includes('DROP_CITE'), false, `${label}: DocumentModel limpia DROP_CITE`);
  }
});
