'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const Zip = require('../../extension/src/core/portability/zip_builder');
const ContentScript = require('../../extension/src/content/content_script');
const MultiPlatform = require('../../extension/src/platforms/multi_platform_adapter');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

function extractPdfAscii(pdfBytes) {
  return Buffer.from(pdfBytes)
    .toString('latin1')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

async function extractDocxDocumentXml(docxBytes) {
  const files = await Zip.unzip(docxBytes);
  return Buffer.from(files['word/document.xml']).toString('utf8');
}

function makeMockDomNode({ tagName = 'div', nodeType = 1, textContent = '', attrs = {}, children = [], classList = [] } = {}) {
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
      return makeMockDomNode({
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

test('R22 P2 #1: imageStrategy omit preserva ![literal](...) dentro de código inline en HTML, DOCX y PDF', async () => {
  const sample = [
    'Antes `![literal](https://audit.invalid/keep.png)` y `` `![literal2](https://audit.invalid/keep2.png)` ``.',
    '',
    '    ![literal3](https://audit.invalid/keep3.png)',
    '',
    'Imagen real fuera: ![real](https://audit.invalid/drop.png)'
  ].join('\n');

  const conv = {
    canonicalId: 'r22_omit_code_preserve',
    title: 'R22 Omit Inline',
    messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }]
  };

  const center = new ExportCenter();
  const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
  const docxRes = await center.exportSingle(conv, 'docx', 'ai', { imageStrategy: 'omit' });
  const pdfRes = await center.exportSingle(conv, 'pdf', 'ai', { imageStrategy: 'omit' });

  const docxXml = await extractDocxDocumentXml(docxRes.data);
  const pdfText = extractPdfAscii(pdfRes.data);

  // HTML preserva literales dentro de <code> y <pre>, y omite imagen real
  assert.match(hb, /<code>!\[literal\]\(https:\/\/audit\.invalid\/keep\.png\)<\/code>/);
  assert.match(hb, /<code>`!\[literal2\]\(https:\/\/audit\.invalid\/keep2\.png\)`<\/code>/);
  assert.equal(hb.includes('![literal3](https://audit.invalid/keep3.png)'), true);
  assert.equal(hb.includes('https://audit.invalid/drop.png'), false);

  // DOCX preserva literales dentro de código inline/indentado y omite imagen real fuera de código
  assert.equal(docxXml.includes('![literal](https://audit.invalid/keep.png)'), true);
  assert.equal(docxXml.includes('![literal2](https://audit.invalid/keep2.png)'), true);
  assert.equal(docxXml.includes('![literal3](https://audit.invalid/keep3.png)'), true);
  assert.equal(docxXml.includes('https://audit.invalid/drop.png'), false);

  // PDF preserva literales dentro de código inline/indentado y omite imagen real fuera de código
  assert.equal(pdfText.includes('![literal](https://audit.invalid/keep.png)'), true);
  assert.equal(pdfText.includes('![literal2](https://audit.invalid/keep2.png)'), true);
  assert.equal(pdfText.includes('![literal3](https://audit.invalid/keep3.png)'), true);
  assert.equal(pdfText.includes('https://audit.invalid/drop.png'), false);
});

test('R22 P2 #2: HtmlBuilder preserva span inline multilínea lazy en cita sin dividir bloques ni perder URL con omit', () => {
  const sample = [
    '> `LITERAL',
    '--',
    '> ![literal](https://audit.invalid/keep.png) end`'
  ].join('\n');

  const conv = {
    canonicalId: 'r22_html_lazy_inline',
    title: 'R22 HTML Lazy Inline',
    messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: sample }]
  };

  const hb = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'omit' });
  const hbEmbed = HtmlBuilder.buildStandaloneHtml(conv, { imageStrategy: 'embed' });

  for (const out of [hb, hbEmbed]) {
    assert.match(
      out,
      /<blockquote><code>LITERAL -- !\[literal\]\(https:\/\/audit\.invalid\/keep\.png\) end<\/code><\/blockquote>/,
      'Debe renderizar un único blockquote con un único <code> íntegro'
    );
    assert.equal(out.includes('<p>--</p>'), false, 'No debe partir la línea -- en un párrafo separado');
  }

  // Contraste positivo: cita lazy con imagen real fuera de código mantiene una sola cita y omite la imagen real
  const lazyReal = [
    '> intro',
    '--',
    '> ![real](https://audit.invalid/real.png)'
  ].join('\n');
  const hbReal = HtmlBuilder.buildStandaloneHtml(
    { canonicalId: 'r22_lazy_real', title: 'R22 Lazy Real', messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: lazyReal }] },
    { imageStrategy: 'omit' }
  );
  assert.equal(hbReal.includes('https://audit.invalid/real.png'), false);
  assert.equal((hbReal.match(/<blockquote>/g) || []).length, 1);
});

test('R22 P2 #3: captura DOM serializa cercas mayores que cualquier secuencia interna de backticks sin activar fetch', async () => {
  const origDoc = global.document;
  global.document = {
    createTextNode(text) {
      return makeMockDomNode({ nodeType: 3, textContent: text });
    }
  };

  try {
    const preBody4 = [
      'before',
      '````',
      '![literal](https://audit.invalid/keep4.png)',
      '````',
      'after'
    ].join('\n');

    const preBody5 = [
      'prefix',
      '`````',
      '![literal5](https://audit.invalid/keep5.png)'
    ].join('\n');

    const buildChatGptTurnRoot = (codeBody) => {
      const codeEl = makeMockDomNode({
        tagName: 'code',
        classList: ['language-markdown'],
        children: [makeMockDomNode({ nodeType: 3, textContent: codeBody })]
      });
      const preEl = makeMockDomNode({ tagName: 'pre', children: [codeEl] });
      const inlineCodeEl = makeMockDomNode({
        tagName: 'code',
        children: [makeMockDomNode({ nodeType: 3, textContent: 'a`b' })]
      });
      const inlineEdgeEl = makeMockDomNode({
        tagName: 'code',
        children: [makeMockDomNode({ nodeType: 3, textContent: '`edge`' })]
      });
      const mdEl = makeMockDomNode({ tagName: 'div', classList: ['markdown'], children: [preEl, inlineCodeEl, inlineEdgeEl] });
      const roleEl = makeMockDomNode({
        tagName: 'div',
        attrs: { 'data-message-author-role': 'assistant', 'data-message-id': 'msg-r22-fence' },
        children: [mdEl]
      });
      return makeMockDomNode({ tagName: 'main', children: [roleEl] });
    };

    for (const [label, body, expectedFencePrefix] of [
      ['four_ticks', preBody4, '`````markdown'],
      ['five_ticks', preBody5, '``````markdown']
    ]) {
      const root = buildChatGptTurnRoot(body);
      const turns = ContentScript.extractVisibleTurns(root);
      assert.equal(turns.length, 1, `${label}: debe extraer 1 turno`);
      assert.equal(turns[0].text.includes(expectedFencePrefix), true, `${label}: cerca debe superar secuencia interna`);
      assert.equal(turns[0].text.includes('``a`b``'), true, `${label}: código inline con backtick interno seguro`);
      assert.equal(turns[0].text.includes('`` `edge` ``'), true, `${label}: código inline con backticks en bordes con padding`);

      let fetchCalls = 0;
      const conv = { canonicalId: `r22_dom_${label}`, title: label, messages: turns };
      const resolved = await AssetResolver.resolveAssetBinaries(conv, {
        fetch: async () => { fetchCalls++; return new Response('', { status: 404 }); }
      });
      assert.equal(fetchCalls, 0, `${label}: contenido dentro de <pre> jamás dispara fetch`);
      assert.equal(resolved.assets.length, 0);

      const segs = ChatGPTWidgets.splitFencedCodeSegments(turns[0].text);
      const codeSegs = segs.filter(s => s.isCode);
      assert.equal(codeSegs.length, 1, `${label}: debe mantenerse como un único segmento de código`);
      assert.equal(codeSegs[0].text.includes('https://audit.invalid/keep'), true);
    }

    // También MultiPlatformAdapter (Claude / Gemini DOM) usa cercas seguras > secuencia interna
    const mpPre = makeMockDomNode({
      tagName: 'pre',
      children: [
        makeMockDomNode({
          tagName: 'code',
          classList: ['language-md'],
          children: [makeMockDomNode({ nodeType: 3, textContent: preBody4 })]
        })
      ]
    });
    const mpMd = MultiPlatform.serializeDomToMarkdown(mpPre);
    assert.equal(mpMd.includes('`````md\n'), true, 'MultiPlatformAdapter debe usar cerca de 5 backticks para bloque con 4 internos');
    let mpFetch = 0;
    const mpRes = await AssetResolver.resolveAssetBinaries(
      { canonicalId: 'r22_mp_dom', title: 'MP DOM', messages: [{ id: 'm1', role: 'assistant', text: mpMd }] },
      { fetch: async () => { mpFetch++; return new Response('', { status: 404 }); } }
    );
    assert.equal(mpFetch, 0);
    assert.equal(mpRes.assets.length, 0);
  } finally {
    global.document = origDoc;
  }
});
