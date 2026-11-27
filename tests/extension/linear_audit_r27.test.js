'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R27 P2: alineación prevBsCol+t tras citas anidadas y listas cercadas con tabuladores', async () => {
  const payloadKeep = '![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>';
  const payloadDrop = '![REAL](https://audit.invalid/real.png) <Cite id="DROP_CITE"/>';

  const codeCases = [
    ['bq_bq_list_tab_fence_step', `> > -\t~~~\n>  > \t${payloadKeep}`],
    ['bq_bq_list_tab_fence_indent5', `>  > -\t~~~\n>  > \t  ${payloadKeep}`],
    ['bq_tight_bq_sp_tab', `>> > \t${payloadKeep}`],
    ['list_bq_sp_tab', `- > \t${payloadKeep}`],
    ['bq_bq_tab_bq_sp_tab', `> >\t> \t${payloadKeep}`],
    ['bq_bq_list_tab_fence_exit_to_indented', `>  > -\t~~~\n>  > \t ${payloadKeep}`]
  ];

  const proseCases = [
    ['bq_tight_3_tab', `>>> \t${payloadDrop}`],
    ['bq_sp2_bq_bq_tab', `>  > > \t${payloadDrop}`],
    ['bq_bq_sp2_bq_tab', `> >  > \t${payloadDrop}`],
    ['list_tab_bq_sp_tab', `-\t> \t${payloadDrop}`],
    ['bq_bq_tab_bq_tab', `> >\t>\t${payloadDrop}`],
    ['bq_bq_list_tab_fence_exit_to_prose', `>  > -\t~~~\n>  > \t${payloadDrop}`]
  ];

  const center = new ExportCenter();

  for (const [label, sample] of codeCases) {
    const segs = ChatGPTWidgets.splitFencedCodeSegments(sample);
    assert.equal(segs.some(s => s.isCode && s.text.includes('KEEP_CITE')), true, `${label}: debe clasificarse como código`);

    let fetchCalls = 0;
    const conv = { canonicalId: `r27_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
    assert.equal(fetchCalls, 0, `${label}: 0 fetch`);
    assert.equal(resolved.assets.length, 0, `${label}: 0 assets`);

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

  for (const [label, sample] of proseCases) {
    let fetchCalls = 0;
    const conv = { canonicalId: `r27_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), { status: 200, headers: { 'content-type': 'image/png' } }); } });
    assert.equal(fetchCalls, 1, `${label}: prosa debe disparar 1 fetch`);
    assert.equal(resolved.assets.length, 1, `${label}: prosa debe extraer 1 asset`);

    const mdOmit = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    const txtOmit = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    const dm = await DocumentModel.prepare([conv], { includeImages: false });

    assert.equal(mdOmit.data.includes('DROP_CITE'), false, `${label}: MD elimina DROP_CITE en prosa`);
    assert.equal(mdOmit.data.includes('https://audit.invalid/real.png'), false, `${label}: MD omit elimina imagen en prosa`);
    assert.equal(txtOmit.data.includes('DROP_CITE'), false, `${label}: TXT elimina DROP_CITE en prosa`);
    assert.equal(hb.includes('DROP_CITE'), false, `${label}: HTML elimina DROP_CITE en prosa`);
    assert.equal(dm.html.includes('DROP_CITE'), false, `${label}: DocumentModel elimina DROP_CITE en prosa`);
  }
});

test('R27 P2: span inline multilínea tras cita+lista con tabulador preserva etiquetas literales', async () => {
  const samples = [
    '> > -\t`<Cite id="INLINE_KEEP"/>\n>  > \t <svg width="10" height="10"/></svg>`',
    '> > -    `<Cite id="INLINE_KEEP"/>\n>  > \t <svg width="10" height="10"/></svg>`'
  ];
  const center = new ExportCenter();
  for (const [idx, sample] of samples.entries()) {
    const cleanedMd = ChatGPTWidgets.renderWidgetsToMarkdown(sample);
    assert.equal(cleanedMd.includes('INLINE_KEEP'), true, `renderWidgetsToMarkdown[${idx}]`);
    const cleanedHtml = ChatGPTWidgets.renderWidgetsToHtml(sample);
    assert.equal(cleanedHtml.includes('INLINE_KEEP'), true, `renderWidgetsToHtml[${idx}]`);
    const conv = { canonicalId: `r27_inline_${idx}`, title: 'InlineTab', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const exp = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
    assert.equal(exp.data.includes('INLINE_KEEP'), true, `ExportCenter[${idx}]`);
  }
});
