'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');

test('R24 P2 #2: consumo parcial de contenedores lazy preserva prefijo consumido (> > y > - sin reinyectar >)', () => {
  const cases = [
    ['> > `A\n> B`', '<code>A B</code>'],
    ['> > `A\n>   B`', '<code>A   B</code>'],
    ['> > `A\n>     B`', '<code>A     B</code>'],
    ['> - `A\n> B`', '<code>A B</code>'],
    ['> - `A\n>   B`', '<code>A B</code>'],
    ['- > > `A\n  > B`', '<code>A B</code>'],
    ['- > > `A\n  >   B`', '<code>A   B</code>'],
    ['- > > `A\n    B`', '<code>A     B</code>'],
    ['> - > `A\n>   B`', '<code>A   B</code>'],
    ['> - > `A\n>     B`', '<code>A     B</code>'],
    ['- > `A\n    B`', '<code>A     B</code>'],
    ['- - `A\n  B`', '<code>A B</code>'],
    ['- - `A\n    B`', '<code>A B</code>'],
  ];

  for (const [mdInput, expectedCode] of cases) {
    const html = HtmlBuilder.buildStandaloneHtml({
      canonicalId: 'r24_partial_lazy',
      title: 'R24 Partial Lazy',
      messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: mdInput }]
    });
    const actual = (html.match(/<code>[\s\S]*?<\/code>/) || [])[0] || '';
    assert.equal(actual, expectedCode, `Entrada ${JSON.stringify(mdInput)} produjo ${actual}, esperado ${expectedCode}`);
  }
});
