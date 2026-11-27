'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const DocumentModel = require('../../extension/src/core/portability/document_model');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R27/R28 P2: alineación prevBsCol+t y tabAdj tras citas anidadas y listas cercadas con tabuladores', async () => {
  const payloadKeep = '![LITERAL](https://audit.invalid/keep.png) <Cite id="KEEP_CITE"/>';
  const payloadDrop = '![REAL](https://audit.invalid/real.png) <Cite id="DROP_CITE"/>';

  const codeCases = [
    ['bq_bq_list_tab_fence_step', `> > -\t~~~\n>  > \t${payloadKeep}`],
    ['bq_bq_list_tab_fence_indent5', `>  > -\t~~~\n>  > \t  ${payloadKeep}`],
    ['bq_tight_bq_sp_tab', `>> > \t${payloadKeep}`],
    ['bq_tight_3_double_tab', `>>>\t\t${payloadKeep}`],
    ['bq_tight_2_double_tab', `>>\t\t${payloadKeep}`],
    ['bq_tab_sp2_bq_tab', `>\t  > \t${payloadKeep}`],
    ['bq_sp_bq_tab_bq_double_tab', `> >\t>\t\t${payloadKeep}`],
    ['bq_tight_3_tab_list_fence_indented_exit', `>>>\t-\t~~~\n>>>\t    ${payloadKeep}\n>>>\t~~~`],
    ['bq_tight_3_tab_list_fence_stay', `>>>\t-\t~~~\n>>>\t     ${payloadKeep}\n>>>\t~~~`],
    ['list_bq_sp_tab', `- > \t${payloadKeep}`],
    ['bq_bq_tab_bq_sp_tab', `> >\t> \t${payloadKeep}`],
    ['bq_bq_list_tab_fence_exit_to_indented', `>  > -\t~~~\n>  > \t ${payloadKeep}`],
    ['bq_overindent_tab_fence_keep', `> > ~~~\n>\t  > ${payloadKeep}\n>\t  > ~~~`],
    ['bq_list_fence_blank_bq_overindent_sp4', `> - ~~~\n>\n    > \t${payloadKeep}`],
    ['bq_list_fence_blank_bq_overindent_tab', `> - ~~~\n>\n\t> \t${payloadKeep}`],
    ['bq_list_fence_blank_bq_spaces_tab', `> - ~~~\n>   \n>  \t${payloadKeep}`],
    ['bq_list_fence_blank_bq_close_later', `> - ~~~\n>\n    > \t${payloadKeep}\n    > ~~~`]
  ];

  const proseCases = [
    ['bq_tight_3_sp_tab', `>>> \t${payloadDrop}`],
    ['bq_tight_3_single_tab', `>>>\t${payloadDrop}`],
    ['bq_tab_sp1_bq_tab', `>\t > \t${payloadDrop}`],
    ['bq_sp2_bq_bq_tab', `>  > > \t${payloadDrop}`],
    ['bq_bq_sp2_bq_tab', `> >  > \t${payloadDrop}`],
    ['list_tab_bq_sp_tab', `-\t> \t${payloadDrop}`],
    ['bq_bq_tab_bq_tab', `> >\t>\t${payloadDrop}`],
    ['bq_bq_list_tab_fence_exit_to_prose', `>  > -\t~~~\n>  > \t${payloadDrop}`],
    ['bq_list_fence_blank_bq_exit_underindent', `> - ~~~\n> \n>  ${payloadDrop}`],
    ['bq_list_bq_fence_blank_bq_exits', `> - > ~~~\n>\n>   > ${payloadDrop}`],
    ['list_bq_fence_blank_list_exits', `- > ~~~\n  \n  > ${payloadDrop}`]
  ];

  const center = new ExportCenter();

  for (const [label, sample] of codeCases) {
    const segs = ChatGPTWidgets.splitFencedCodeSegments(sample);
    assert.equal(segs.some(s => s.isCode && s.text.includes('KEEP_CITE')), true, `${label}: debe clasificarse como código`);

    let fetchCalls = 0;
    const conv = { canonicalId: `r28_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
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
    const conv = { canonicalId: `r28_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
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

test('R28 P2: espaciado exacto en spans inline multilínea con getLines bsCol en renderInlineCodeSpanPayload y HtmlBuilder', async () => {
  const inlineCases = [
    ['bq_sp2_list_tab_sp1', '> > -\t`A\n>  > \t B`', 'A B'],
    ['bq_sp2_list_tab_sp2', '> > -\t`A\n>  > \t  B`', 'A  B'],
    ['bq_sp2_list_tab_nosp', '> > -\t`A\n>  > \tB`', 'A B'],
    ['bq_list_tab_same_bs_sp1', '> > -\t`A\n> > \t B`', 'A  B'],
    ['bq_lazy_list_indent5', '> > -    `A\n>  > \t B`', 'A B'],
    ['list_bq_list_tab_sp1', '- > -\t`A\n  >  \t B`', 'A  B'],
    ['bq_overindent_tab_sp2', '> > `A\n>\t  > B`', 'A B'],
    ['bq_overindent_4sp', '> `A\n    > B`', 'A B'],
    ['list_bq_overindent_4sp', '- > `A\n      > B`', 'A B']
  ];

  for (const [label, sample, expected] of inlineCases) {
    const openTick = sample.indexOf('`');
    const payload = ChatGPTWidgets.renderInlineCodeSpanPayload(sample, openTick, sample.length);
    assert.equal(payload, expected, `${label}: renderInlineCodeSpanPayload espaciado exacto`);

    const conv = { canonicalId: `r28_inline_${label}`, title: label, messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }] };
    const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
    assert.equal(hb.includes(`<code>${expected}</code>`), true, `${label}: HtmlBuilder <code>${expected}</code> exacto`);
    const dm = await DocumentModel.prepare([conv], { includeImages: false });
    assert.equal(dm.html.includes(`<code>${expected}</code>`), true, `${label}: DocumentModel <code>${expected}</code> exacto`);
  }

  const protectedSample = '> > -\t`<Cite id="INLINE_KEEP"/>\n>  > \t <svg width="10" height="10"/></svg>`';
  const cleanedMd = ChatGPTWidgets.renderWidgetsToMarkdown(protectedSample);
  assert.equal(cleanedMd.includes('INLINE_KEEP'), true);
  assert.equal(HtmlBuilder.buildStandaloneHtml({ canonicalId: 'r28_keep', title: 'Keep', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: protectedSample }] }, { imageStrategy: 'omit' }).includes('INLINE_KEEP'), true);

  // Interrupción tras bq sobreindentado con marcador de lista no queda atrapada como código inline
  const brokenByList = '> > `A\n>     > - <Cite id="BREAK_DROP"/> B`';
  const brokenMd = await (new ExportCenter()).exportSingle(
    { canonicalId: 'r28_brk', title: 'Brk', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: brokenByList }] },
    'md',
    'ai',
    { imageStrategy: 'omit' }
  );
  assert.equal(brokenMd.data.includes('BREAK_DROP'), false);
});
