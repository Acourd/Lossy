'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R20 P2 #1: cita explícita fuera de lista (- > `LITERAL \\n> <grid>...) separa contenedores, activa widget, limpia DROP_CITE y descubre imagen', async () => {
  const sample = [
    '- > `LITERAL',
    '> <grid><card><text>REAL</text></card></grid> ![real](https://audit.invalid/real.png) <Cite id="DROP_CITE"/>',
    '  > end`'
  ].join('\n');

  assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true);
  const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
  assert.match(htmlW, /class="lossy-widget-root"/);
  assert.match(htmlW, /REAL/);
  assert.equal(htmlW.includes('DROP_CITE'), false);

  let fetchCalls = 0;
  const fakeFetch = async url => {
    fetchCalls++;
    assert.equal(url, 'https://audit.invalid/real.png');
    return new Response('', { status: 404 });
  };

  const conv = { canonicalId: 'r20_quote_out_list', title: 'R20 #1', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
  const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: fakeFetch });
  assert.equal(fetchCalls, 1, 'La imagen fuera del span inline debe descubrirse');
  assert.equal(resolved.assets.length, 1);

  const center = new ExportCenter();
  const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  const txtOmit = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
  const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
  const dm = await DocumentModel.prepare([conv], { includeImages: false });

  assert.equal(mdOmit.data.includes('DROP_CITE'), false);
  assert.equal(mdOmit.data.includes('https://audit.invalid/real.png'), false, 'imageStrategy:omit debe eliminar imagen activa en Markdown');
  assert.equal(txtOmit.data.includes('DROP_CITE'), false);
  assert.match(hb, /class="lossy-widget-root"/);
  assert.equal(hb.includes('DROP_CITE'), false);
  assert.match(dm.html, /class="lossy-widget-root"/);
  assert.equal(dm.html.includes('DROP_CITE'), false);
});

test('R20 P2 #2: marcador ordenado vacío (2. con o sin espacio) fuera de cita interrumpe el bloque', async () => {
  const withSpace = [
    '> `<grid><card><text>REAL</text></card></grid>',
    '2. ',
    '<Cite id="DROP_CITE"/> ![real](https://audit.invalid/real.png) middle',
    '> end`'
  ].join('\n');

  const withoutSpace = [
    '> `<grid><card><text>REAL</text></card></grid>',
    '2.',
    '<Cite id="DROP_CITE"/> ![real](https://audit.invalid/real.png) middle',
    '> end`'
  ].join('\n');

  const center = new ExportCenter();
  for (const [label, sample] of [['empty_2_space', withSpace], ['empty_2_nospace', withoutSpace]]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true, `${label}: widget debe activarse`);
    const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
    assert.match(htmlW, /class="lossy-widget-root"/, `${label}: Html widget`);
    assert.equal(htmlW.includes('DROP_CITE'), false, `${label}: limpia DROP_CITE`);

    let fetchCalls = 0;
    const conv = { canonicalId: `r20_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
    assert.equal(fetchCalls, 1, `${label}: descubre imagen fuera de código`);
    assert.equal(resolved.assets.length, 1);

    const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txtOmit = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(mdOmit.data.includes('DROP_CITE'), false, `${label}: Markdown limpia DROP_CITE`);
    assert.equal(mdOmit.data.includes('https://audit.invalid/real.png'), false, `${label}: imageStrategy:omit omite imagen activa en Markdown`);
    assert.equal(txtOmit.data.includes('DROP_CITE'), false, `${label}: TXT limpia DROP_CITE`);
    assert.match(hb, /class="lossy-widget-root"/, `${label}: HtmlBuilder widget`);
    assert.equal(hb.includes('DROP_CITE'), false, `${label}: HtmlBuilder limpia DROP_CITE`);
    assert.match(dm.html, /class="lossy-widget-root"/, `${label}: DocumentModel widget`);
    assert.equal(dm.html.includes('DROP_CITE'), false, `${label}: DocumentModel limpia DROP_CITE`);
  }
});
