'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R21 P2: subrayado Setext (--, =, ===) fuera del contenedor no interrumpe continuación lazy de span inline', async () => {
  const underlineVariants = [
    ['double_dash_bq', [
      '> `LITERAL',
      '--',
      '> <grid><card><text>KEEP_WIDGET</text></card></grid> ![literal](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/> end`'
    ].join('\n')],
    ['single_eq_bq', [
      '> `LITERAL',
      '=',
      '> <grid><card><text>KEEP_WIDGET</text></card></grid> ![literal](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/> end`'
    ].join('\n')],
    ['triple_eq_bq', [
      '> `LITERAL',
      '===',
      '> <grid><card><text>KEEP_WIDGET</text></card></grid> ![literal](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/> end`'
    ].join('\n')],
    ['nested_list_bq_exit_dash', [
      '- > `LITERAL',
      '  --',
      '  > <grid><card><text>KEEP_WIDGET</text></card></grid> ![literal](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/> end`'
    ].join('\n')],
    ['bq_list_exit_list_dash', [
      '> - `LITERAL',
      '> --',
      '>   <grid><card><text>KEEP_WIDGET</text></card></grid> ![literal](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/> end`'
    ].join('\n')]
  ];

  const center = new ExportCenter();
  for (const [label, sample] of underlineVariants) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false, `${label}: no debe activar widget`);
    const htmlW = ChatGPTWidgets.renderWidgetsToHtml(sample);
    assert.equal(htmlW.includes('class="lossy-widget-root"'), false, `${label}: renderWidgetsToHtml sin widget`);
    assert.equal(htmlW.includes('KEEP_CITE'), true, `${label}: preserva KEEP_CITE en widgets html`);

    let fetchCalls = 0;
    const conv = { canonicalId: `r21_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
    assert.equal(fetchCalls, 0, `${label}: 0 llamadas fetch para imagen dentro de código`);
    assert.equal(resolved.assets.length, 0, `${label}: 0 assets descubiertos`);

    const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txtOmit = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(mdOmit.data.includes('KEEP_CITE'), true, `${label}: Markdown preserva KEEP_CITE`);
    assert.equal(mdOmit.data.includes('https://audit.invalid/keep.png'), true, `${label}: Markdown preserva enlace literal`);
    assert.equal(txtOmit.data.includes('KEEP_CITE'), true, `${label}: TXT preserva KEEP_CITE`);
    assert.equal(hb.includes('class="lossy-widget-root"'), false, `${label}: HtmlBuilder sin widget`);
    assert.equal(hb.includes('KEEP_CITE'), true, `${label}: HtmlBuilder preserva KEEP_CITE`);
    assert.equal(dm.html.includes('class="lossy-widget-root"'), false, `${label}: DocumentModel sin widget`);
    assert.equal(dm.html.includes('KEEP_CITE'), true, `${label}: DocumentModel preserva KEEP_CITE`);
  }
});

test('R21 P2 contraste: Setext dentro del mismo contenedor sí rompe el span inline; = tras no-párrafo no cierra párrafo', async () => {
  const center = new ExportCenter();
  for (const [label, underline] of [['same_bq_dd', '--'], ['same_bq_eq', '='], ['same_bq_eq3', '===']]) {
    const sample = [
      '> `LITERAL',
      `> ${underline}`,
      '> <grid><card><text>REAL</text></card></grid> ![real](https://audit.invalid/real.png) <Cite id="DROP_CITE"/> end`'
    ].join('\n');

    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), true, `${label}: Setext en mismo contenedor activa widget`);
    let fetchCalls = 0;
    const conv = { canonicalId: `r21_pos_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
    assert.equal(fetchCalls, 1, `${label}: descubre imagen tras Setext del mismo contenedor`);
    assert.equal(resolved.assets.length, 1);

    const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(mdOmit.data.includes('DROP_CITE'), false, `${label}: Markdown limpia DROP_CITE`);
    assert.equal(mdOmit.data.includes('https://audit.invalid/real.png'), false, `${label}: omit quita imagen`);
    assert.match(hb, /class="lossy-widget-root"/, `${label}: HtmlBuilder activa widget`);
    assert.equal(hb.includes('DROP_CITE'), false, `${label}: HtmlBuilder limpia DROP_CITE`);
    assert.match(dm.html, /class="lossy-widget-root"/, `${label}: DocumentModel activa widget`);
    assert.equal(dm.html.includes('DROP_CITE'), false, `${label}: DocumentModel limpia DROP_CITE`);
  }

  // `===` tras encabezado `# H1` no es Setext, inicia párrafo: la línea siguiente con 4 espacios es continuación, NO código indentado
  const afterHeading = [
    '# Título',
    '===',
    '    <grid><card><text>REAL_PARA</text></card></grid> <Cite id="DROP_CITE"/>'
  ].join('\n');
  assert.equal(ChatGPTWidgets.hasVisualWidgets(afterHeading), true);
  const mdAfter = await center.exportSingle({ canonicalId: 'r21_eq_para', title: 'R21 eq para', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: afterHeading }] }, 'md', 'ai');
  assert.equal(mdAfter.data.includes('DROP_CITE'), false);
});
