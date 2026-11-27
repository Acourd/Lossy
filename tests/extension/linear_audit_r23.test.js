'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const MarkdownSerializer = require('../../extension/src/core/markdown_serializer');
const ContentScript = require('../../extension/src/content/content_script');
const MultiPlatform = require('../../extension/src/platforms/multi_platform_adapter');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

function makeNode({ tagName = 'div', nodeType = 1, textContent = '', attrs = {}, children = [], classList = [] } = {}) {
  const node = {
    nodeType,
    tagName: nodeType === 1 ? tagName.toUpperCase() : undefined,
    className: classList.join(' '),
    classList: [...classList],
    childNodes: [],
    parentNode: null,
    get textContent() {
      if (this.nodeType === 3) return textContent;
      return this.childNodes.map(c => c.textContent).join('');
    },
    set textContent(v) {
      textContent = String(v ?? '');
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
    closest() { return null; },
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx !== -1) this.parentNode.childNodes.splice(idx, 1);
      }
    },
    replaceChild(newChild, oldChild) {
      const idx = this.childNodes.indexOf(oldChild);
      if (idx !== -1) {
        this.childNodes[idx] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
      }
    },
    querySelectorAll(selector) {
      const wantPre = selector === 'pre';
      const wantRole = selector === '[data-message-author-role]';
      const wantImg = selector === 'img';
      const out = [];
      const walk = cur => {
        if (cur.nodeType !== 1) return;
        if (wantPre && cur.tagName === 'PRE') out.push(cur);
        if (wantRole && cur.getAttribute('data-message-author-role')) out.push(cur);
        if (wantImg && cur.tagName === 'IMG') out.push(cur);
        cur.childNodes.forEach(walk);
      };
      this.childNodes.forEach(walk);
      return out;
    },
    querySelector(selector) {
      const wantDot = selector.startsWith('.') ? selector.slice(1) : null;
      const wantTag = selector.toUpperCase();
      let found = null;
      const walk = cur => {
        if (found || cur.nodeType !== 1) return;
        if (wantDot && cur.classList.includes(wantDot)) { found = cur; return; }
        if (!wantDot && cur.tagName === wantTag) { found = cur; return; }
        cur.childNodes.forEach(walk);
      };
      this.childNodes.forEach(walk);
      return found;
    },
    cloneNode(deep = true) {
      const clonedChildren = deep ? this.childNodes.map(c => c.cloneNode(true)) : [];
      return makeNode({
        tagName: this.tagName,
        nodeType: this.nodeType,
        textContent,
        attrs: { ...attrs },
        children: clonedChildren,
        classList: [...this.classList]
      });
    }
  };
  for (const ch of children) {
    ch.parentNode = node;
    node.childNodes.push(ch);
  }
  return node;
}

test('R23 P2 #1: nodos <code> adyacentes en DOM nunca concatenan backticks ni activan imagen literal', async () => {
  const origDoc = global.document;
  global.document = {
    createTextNode(text) {
      return makeNode({ nodeType: 3, textContent: text });
    }
  };

  try {
    const buildAdjacentDom = (wrapInSpans) => {
      const c1 = makeNode({ tagName: 'code', children: [makeNode({ nodeType: 3, textContent: '`edge`' })] });
      const c2 = makeNode({ tagName: 'code', children: [makeNode({ nodeType: 3, textContent: '![L](https://a.invalid/keep.png)' })] });
      const inlineNodes = wrapInSpans
        ? [makeNode({ tagName: 'span', children: [c1] }), makeNode({ tagName: 'span', children: [c2] })]
        : [c1, c2];
      const p = makeNode({ tagName: 'p', children: inlineNodes });
      const mdDiv = makeNode({ tagName: 'div', classList: ['markdown'], children: [p] });
      const roleDiv = makeNode({
        tagName: 'div',
        attrs: { 'data-message-author-role': 'assistant', 'data-message-id': 'msg-r23-adj' },
        children: [mdDiv]
      });
      return { root: makeNode({ tagName: 'main', children: [roleDiv] }), container: p };
    };

    for (const wrapInSpans of [false, true]) {
      const { root, container } = buildAdjacentDom(wrapInSpans);
      const turns = ContentScript.extractVisibleTurns(root);
      assert.equal(turns.length, 1);
      assert.equal(turns[0].text.includes('```'), false, 'Delimitadores adyacentes no deben fusionarse en 3 backticks');

      let fetchCalls = 0;
      const res = await AssetResolver.resolveAssetBinaries(
        { canonicalId: `r23_cs_${wrapInSpans}`, title: 'Adj CS', messages: turns },
        { fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); } }
      );
      assert.equal(fetchCalls, 0, 'ContentScript: 0 fetch para imagen en segundo <code>');
      assert.equal(res.assets.length, 0);

      const mpMd = MultiPlatform.serializeDomToMarkdown(container);
      assert.equal(mpMd.includes('```'), false, 'MultiPlatform: delimitadores no fusionados');
      let mpFetch = 0;
      const mpRes = await AssetResolver.resolveAssetBinaries(
        { canonicalId: `r23_mp_${wrapInSpans}`, title: 'Adj MP', messages: [{ id: 'm1', role: 'assistant', text: mpMd }] },
        { fetch: async () => { mpFetch++; return new Response('', { status: 404 }); } }
      );
      assert.equal(mpFetch, 0, 'MultiPlatform: 0 fetch para imagen en segundo <code>');
      assert.equal(mpRes.assets.length, 0);
    }
  } finally {
    global.document = origDoc;
  }
});

test('R23 P2 #2: normalización CommonMark preserva espacios literales exactos en continuaciones lazy', () => {
  const cases = [
    ['- > `A\n    B`', '<code>A     B</code>'],
    ['- > `A\n  B`', '<code>A   B</code>'],
    ['> - `A\n    B`', '<code>A   B</code>'],
    ['- > - `A\n    B`', '<code>A   B</code>'],
    ['> `A\n    B`', '<code>A     B</code>'],
    ['1. `A\n B`', '<code>A B</code>'],
    ['1. `A\n     B`', '<code>A   B</code>'],
  ];

  for (const [mdInput, expectedCodeHtml] of cases) {
    const html = HtmlBuilder.buildStandaloneHtml({
      canonicalId: 'r23_lazy_sp',
      title: 'Lazy spaces',
      messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: mdInput }]
    });
    assert.equal(
      html.includes(expectedCodeHtml),
      true,
      `Para ${JSON.stringify(mdInput)} se esperaba ${expectedCodeHtml}`
    );
  }
});

test('R23 P2 #3: cercas dinámicas acotadas manejan <pre> con 130000 secuencias backtick (260KB) sin RangeError', async () => {
  const origDoc = global.document;
  global.document = {
    createTextNode(text) {
      return makeNode({ nodeType: 3, textContent: text });
    }
  };

  try {
    const hugeBody = 'a`'.repeat(130000);
    const codeEl = makeNode({
      tagName: 'code',
      classList: ['language-txt'],
      children: [makeNode({ nodeType: 3, textContent: hugeBody })]
    });
    const preEl = makeNode({ tagName: 'pre', children: [codeEl] });
    const mdDiv = makeNode({ tagName: 'div', classList: ['markdown'], children: [preEl] });
    const roleDiv = makeNode({
      tagName: 'div',
      attrs: { 'data-message-author-role': 'assistant', 'data-message-id': 'msg-huge' },
      children: [mdDiv]
    });
    const root = makeNode({ tagName: 'main', children: [roleDiv] });

    const turns = ContentScript.extractVisibleTurns(root);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].text.includes('```txt\n'), true);

    const mpMd = MultiPlatform.serializeDomToMarkdown(
      makeNode({
        tagName: 'pre',
        children: [makeNode({ tagName: 'code', classList: ['language-txt'], children: [makeNode({ nodeType: 3, textContent: hugeBody })] })]
      })
    );
    assert.equal(mpMd.includes('```txt\n'), true);

    const conv = {
      canonicalId: 'r23_huge_fence',
      title: 'Huge Fence',
      messages: [{
        id: 'm1',
        role: 'assistant',
        isConversational: true,
        text: 'Resumen sin cerca inline',
        content: { text: 'Resumen sin cerca inline', codeBlocks: [{ language: 'txt', code: hugeBody }] },
        codeBlocks: [{ language: 'txt', code: hugeBody }]
      }]
    };
    const serialized = MarkdownSerializer.serializeToMarkdown(conv);
    assert.equal(serialized.includes('```txt\n'), true);

    const center = new ExportCenter();
    for (const profile of ['ai', 'human', 'obsidian']) {
      const mdOut = await center.exportSingle(conv, 'md', profile);
      assert.equal(mdOut.data.includes('```txt\n'), true, `ExportCenter md (${profile}) sin RangeError`);
    }
  } finally {
    global.document = origDoc;
  }
});
