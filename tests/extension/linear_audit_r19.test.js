'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R19 P2 #1: 2. fuera de una cita separa bloques (no es continuación lazy), activa widget y limpia DROP_CITE', async () => {
  const sample = [
    '> `<grid><card><text>REAL</text></card></grid>',
    '2. <Cite id="DROP_CITE"/> middle',
    '> end`'
  ].join('\n');

  assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true);
  const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
  assert.match(htmlW, /class="lossy-widget-root"/);
  assert.match(htmlW, /REAL/);
  assert.equal(htmlW.includes('DROP_CITE'), false);

  const conv = { canonicalId: 'r19_2dot_outside_bq', title: '2dot outside bq', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
  const center = new ExportCenter();
  const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const hb = HtmlBuilder.buildStandaloneHtml(conv);
  const dm = await DocumentModel.prepare([conv], { includeImages: false });

  assert.equal(md.data.includes('DROP_CITE'), false);
  assert.equal(txt.data.includes('DROP_CITE'), false);
  assert.match(hb, /class="lossy-widget-root"/);
  assert.equal(hb.includes('DROP_CITE'), false);
  assert.match(dm.html, /class="lossy-widget-root"/);
  assert.equal(dm.html.includes('DROP_CITE'), false);
});

test('R19 P2 #2: continuación lazy combinada de lista y cita conserva span inline (0 fetch y KEEP_CITE intacto)', async () => {
  const sample = [
    '- > `![literal](https://evil.test/literal.png)',
    '<Cite id="KEEP_CITE"/> middle',
    '  > end`'
  ].join('\n');

  let fetchCalls = 0;
  const fakeFetch = async () => { fetchCalls++; return new Response(''); };
  const conv = { canonicalId: 'r19_lazy_list_bq', title: 'Lazy list+bq', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };

  const res = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetch });
  assert.equal(fetchCalls, 0, 'Imagen dentro de continuación lazy lista+cita no debe disparar fetch');
  assert.equal(res.assets.length, 0);

  const center = new ExportCenter();
  const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const hb = HtmlBuilder.buildStandaloneHtml(conv);
  const dm = await DocumentModel.prepare([conv], { includeImages: false });

  assert.match(md.data, /KEEP_CITE/);
  assert.match(txt.data, /KEEP_CITE/);
  assert.match(hb, /KEEP_CITE/);
  assert.match(dm.html, /KEEP_CITE/);
});

test('R19 P2 #3: contexto tras extraer un widget en el mismo segmento conserva código inline posterior con KEEP_CITE', async () => {
  const sample = [
    '> ~~~',
    '> fenced',
    '> ~~~',
    '> <grid><card><text>REAL</text></card></grid> `literal',
    '> <Cite id="KEEP_CITE"/> end`'
  ].join('\n');

  const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
  assert.match(htmlW, /class="lossy-widget-root"/);
  assert.match(htmlW, /REAL/);
  assert.match(htmlW, /KEEP_CITE/);

  const conv = { canonicalId: 'r19_post_widget', title: 'Post widget inline', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
  const center = new ExportCenter();
  const md = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txt = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const hb = HtmlBuilder.buildStandaloneHtml(conv);
  const dm = await DocumentModel.prepare([conv], { includeImages: false });

  assert.match(md.data, /KEEP_CITE/);
  assert.match(txt.data, /KEEP_CITE/);
  assert.match(hb, /class="lossy-widget-root"/);
  assert.match(hb, /KEEP_CITE/);
  assert.match(dm.html, /class="lossy-widget-root"/);
  assert.match(dm.html, /KEEP_CITE/);
});
