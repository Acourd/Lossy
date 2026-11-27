'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R26 P2 #1: matchFenceContainers preserva cercas en listas/citas combinadas con tabuladores (- > -\\t~~~)', async () => {
  const fencedCases = [
    '- > -\t~~~\n  > \t![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>',
    '- > -\t~~~\n  > \t![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>\n  > \t~~~',
    '> > -\t~~~\n> > \t![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>\n> > ~~~',
    '>  > -\t~~~\n>  > \t    ![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>\n>  > ~~~'
  ];

  const center = new ExportCenter();
  for (const [idx, sample] of fencedCases.entries()) {
    const label = `fence_tab_${idx}`;
    const segs = ChatGPTWidgets.splitFencedCodeSegments(sample);
    assert.equal(segs.some(s => s.isCode && s.text.includes('KEEP_CITE')), true, `${label}: debe mantenerse como bloque de código`);

    let fetchCalls = 0;
    const conv = { canonicalId: `r26_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
    assert.equal(fetchCalls, 0, `${label}: 0 llamadas fetch`);
    assert.equal(resolved.assets.length, 0, `${label}: 0 assets descubiertos`);

    const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txtOmit = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(mdOmit.data.includes('KEEP_CITE'), true, `${label}: MD preserva KEEP_CITE`);
    assert.equal(mdOmit.data.includes('https://audit.invalid/keep.png'), true, `${label}: MD omit preserva literal`);
    assert.equal(txtOmit.data.includes('KEEP_CITE'), true, `${label}: TXT preserva KEEP_CITE`);
    assert.equal(hb.includes('KEEP_CITE'), true, `${label}: HTML preserva KEEP_CITE`);
    assert.equal(dm.html.includes('KEEP_CITE'), true, `${label}: DocumentModel preserva KEEP_CITE`);
  }
});

test('R26 P2 #2: tabuladores tras citas anidadas distinguen código indentado (> > \\t) de prosa (>  >  \\t)', async () => {
  const indented = '> > \t![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>';
  const prose = '>  >  \t![REAL](https://audit.invalid/real.png) <Cite id="DROP_CITE"/>';

  const center = new ExportCenter();

  // Caso código indentado: 0 fetch, preserva literal y KEEP_CITE
  let indFetch = 0;
  const indConv = { canonicalId: 'r26_ind_tab', title: 'IndTab', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: indented }] };
  const indRes = await AssetResolver.resolveAssetBinaries(indConv, { fetch: async () => { indFetch++; return new Response('', { status: 404 }); } });
  assert.equal(indFetch, 0, 'Indented > > \\t debe dar 0 fetch');
  assert.equal(indRes.assets.length, 0);
  const indMd = await center.exportSingle(indConv, 'md', 'ai', { imageStrategy: 'omit' });
  const indHb = HtmlBuilder.buildStandaloneHtml(indConv, { imageStrategy: 'omit' });
  assert.equal(indMd.data.includes('KEEP_CITE'), true);
  assert.equal(indMd.data.includes('https://audit.invalid/keep.png'), true);
  assert.equal(indHb.includes('KEEP_CITE'), true);
  assert.equal(indHb.includes('https://audit.invalid/keep.png'), true);

  // Caso prosa: 1 fetch, descubre imagen real y limpia DROP_CITE
  let proseFetch = 0;
  const proseConv = { canonicalId: 'r26_prose_tab', title: 'ProseTab', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: prose }] };
  const proseRes = await AssetResolver.resolveAssetBinaries(proseConv, { fetch: async () => { proseFetch++; return new Response('', { status: 404 }); } });
  assert.equal(proseFetch, 1, 'Prosa >  >  \\t debe descubrir imagen real');
  assert.equal(proseRes.assets.length, 1);
  const proseMd = await center.exportSingle(proseConv, 'md', 'ai', { imageStrategy: 'omit' });
  const proseHb = HtmlBuilder.buildStandaloneHtml(proseConv, { imageStrategy: 'omit' });
  assert.equal(proseMd.data.includes('DROP_CITE'), false);
  assert.equal(proseMd.data.includes('https://audit.invalid/real.png'), false);
  assert.equal(proseHb.includes('DROP_CITE'), false);
  assert.equal(proseHb.includes('https://audit.invalid/real.png'), false);
});
