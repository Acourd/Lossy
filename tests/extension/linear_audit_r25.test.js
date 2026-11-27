'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');

test('R25 P2 tabuladores: paridad CommonMark en citas anidadas y listas con tabuladores (>  > -\\t)', async () => {
  const cases = [
    ['>  > -\t`A\n    B`', '<code>A B</code>'],
    ['>  > -\t`A\n     B`', '<code>A B</code>'],
    ['>  > -\t`A\n      B`', '<code>A  B</code>'],
    ['>  > -\t`A\n>  > \tB`', '<code>A B</code>'],
    ['>  > -\t`A\n\tB`', '<code>A B</code>'],
    ['> > -\t`A\n    B`', '<code>A   B</code>'],
    ['> > -\t`A\n> >   B`', '<code>A B</code>'],
    ['> > -\t`A\n> >    B`', '<code>A  B</code>'],
    ['> >\t-\t`A\n     B`', '<code>A    B</code>'],
    ['- > -\t`A\n     B`', '<code>A  B</code>'],
    ['-  > -\t`A\n     B`', '<code>A   B</code>'],
    ['-\t> -\t`A\n       B`', '<code>A      B</code>'],
    ['-\t>  -\t`A\n       B`', '<code>A  B</code>'],
    ['>   >   -\t`A\n     B`', '<code>A  B</code>'],
  ];

  for (const [mdInput, expectedCode] of cases) {
    const html = HtmlBuilder.renderSimpleMarkdownToHtml(mdInput);
    const actual = (html.match(/<code>[\s\S]*?<\/code>/) || [])[0] || '';
    assert.equal(actual, expectedCode, `Entrada ${JSON.stringify(mdInput)} produjo ${actual}, esperado ${expectedCode}`);
  }

  // Verificar también aislamiento de bloques y cero fetch en ExportCenter / AssetResolver para el caso tabulado
  const guarded = '>  > -\t`LITERAL\n    ![literal](https://audit.invalid/keep.png)\n>  > ![literal2](https://audit.invalid/keep2.png) <Cite id="KEEP_CITE"/>`';
  let fetchCalls = 0;
  const conv = { canonicalId: 'r25_tab_guard', title: 'R25 Tabs', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: guarded }] };
  const resolved = await AssetResolver.resolveAssetBinaries(conv, { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } });
  assert.equal(fetchCalls, 0);
  assert.equal(resolved.assets.length, 0);
  const mdOmit = await new ExportCenter().exportSingle(conv, 'md', 'ai', { imageStrategy: 'omit' });
  assert.equal(mdOmit.data.includes('KEEP_CITE'), true);
  assert.equal(mdOmit.data.includes('https://audit.invalid/keep.png'), true);
});
