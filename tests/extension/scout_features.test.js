'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ExportCenterMod = require('../../extension/src/core/portability/export_center.js');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder.js');
const MultiPlatform = require('../../extension/src/platforms/multi_platform_adapter.js');

const SAMPLE_CONV = {
  canonicalId: 'conv_chatgpt_scout1',
  title: 'Investigación de Límites',
  source: { platform: 'chatgpt', conversationId: 'scout1', url: 'https://chatgpt.com/c/scout1' },
  model: 'gpt-6-2',
  createdAt: '2026-11-26T18:00:00.000Z',
  updatedAt: '2026-11-26T18:05:00.000Z',
  messages: [
    {
      id: 'm1',
      role: 'user',
      isConversational: true,
      text: 'Explícame los límites con gráficas.'
    },
    {
      id: 'm2',
      role: 'assistant',
      isConversational: true,
      text: [
        'Aquí tienes el resumen. <Cite refs={["s1"]}/>',
        '',
        '<grid columns={2}><grid-item><card>Usuario A<caption>Límite</caption><box height={7} background="#e5e7eb"><box height={7} width="80%" background="#16a34a"/></box></card></grid-item><grid-item><card>Usuario B<caption>Límite</caption><box height={7} background="#e5e7eb"><box height={7} width="90%" background="#16a34a"/></box></card></grid-item></grid>'
      ].join('\n'),
      content: {
        citations: [
          { title: 'OpenAI Docs', url: 'https://platform.openai.com/docs' },
          { title: 'OpenAI Docs Dup', url: 'https://platform.openai.com/docs' },
          { title: 'Bad Scheme', url: 'javascript:alert(1)' }
        ]
      }
    }
  ]
};

test('HtmlBuilder & ExportCenter generate offline self-contained HTML with widgets, search, theme toggle, and clickable citations', async () => {
  const center = new ExportCenterMod.ExportCenter();
  const res = await center.exportSingle(SAMPLE_CONV, 'html', 'human', { imageStrategy: 'omit' });
  assert.equal(res.format, 'html');
  assert.equal(res.mimeType, 'text/html;charset=utf-8');
  assert.ok(res.filename.endsWith('.html'));
  assert.ok(res.data.includes('<!doctype html>'));
  assert.ok(res.data.includes('id="l-search"') && res.data.includes('id="l-theme"'));
  assert.ok(res.data.includes('lossy-widget-grid') && res.data.includes('width:80%;background:#16a34a'));
  assert.ok(res.data.includes('https://platform.openai.com/docs') && !res.data.includes('javascript:alert'));
  assert.ok(!res.data.includes('<Cite'));
});

test('Obsidian profile generates valid YAML frontmatter, tags, callout, and clickable citations', async () => {
  const center = new ExportCenterMod.ExportCenter();
  const res = await center.exportSingle(SAMPLE_CONV, 'md', 'obsidian', { imageStrategy: 'omit' });
  assert.ok(res.data.startsWith('---\n'));
  assert.ok(res.data.includes('tags: [lossy, ai-chat, chatgpt]'));
  assert.ok(res.data.includes('> [!info] Exportado localmente con Lossy'));
  assert.ok(res.data.includes('[1] [OpenAI Docs](<https://platform.openai.com/docs>)'));
  assert.ok(!res.data.includes('javascript:alert'));
  assert.ok(!res.data.includes('<Cite'));
});

test('MultiPlatform detects ChatGPT, Claude.ai, and Gemini URLs accurately', () => {
  assert.deepEqual(MultiPlatform.detectPlatform('https://chatgpt.com/c/abc-123'), {
    platform: 'chatgpt', label: 'ChatGPT', conversationId: 'abc-123'
  });
  assert.deepEqual(MultiPlatform.detectPlatform('https://claude.ai/chat/550e8400-e29b'), {
    platform: 'claude', label: 'Claude', conversationId: '550e8400-e29b'
  });
  assert.deepEqual(MultiPlatform.detectPlatform('https://gemini.google.com/app/9f8e7d6c'), {
    platform: 'gemini', label: 'Gemini', conversationId: '9f8e7d6c'
  });
  assert.equal(MultiPlatform.detectPlatform('https://example.com/other'), null);
});

test('MultiPlatform extracts Claude and Gemini DOM turns cleanly to canonical Lossy schema', () => {
  const mkNode = (tag, attrs, cls, text) => ({
    nodeType: 1,
    tagName: tag,
    className: cls,
    textContent: text,
    childNodes: [{ nodeType: 3, textContent: text }],
    getAttribute: k => attrs[k] || null,
    contains: () => false
  });

  const claudeDoc = {
    title: 'Diseño de arquitectura - Claude',
    querySelectorAll: () => [
      mkNode('div', { 'data-testid': 'user-message' }, '', 'Hola Claude'),
      mkNode('div', { 'data-testid': 'chat-message-content' }, '', 'Hola, revisemos la arquitectura.')
    ]
  };
  const claudeConv = MultiPlatform.extractClaudeDom(claudeDoc, 'https://claude.ai/chat/cl1');
  assert.equal(claudeConv.canonicalId, 'conv_claude_cl1');
  assert.equal(claudeConv.title, 'Diseño de arquitectura');
  assert.equal(claudeConv.messages.length, 2);
  assert.equal(claudeConv.messages[0].role, 'user');
  assert.equal(claudeConv.messages[1].author, 'Claude');

  const geminiDoc = {
    title: 'Plan semanal - Gemini',
    querySelectorAll: () => [
      mkNode('user-query', {}, '', 'Haz un plan'),
      mkNode('model-response', {}, '', 'Aquí tienes el plan.')
    ]
  };
  const geminiConv = MultiPlatform.extractGeminiDom(geminiDoc, 'https://gemini.google.com/app/gm1');
  assert.equal(geminiConv.canonicalId, 'conv_gemini_gm1');
  assert.equal(geminiConv.title, 'Plan semanal');
  assert.equal(geminiConv.messages.length, 2);
  assert.equal(geminiConv.messages[1].author, 'Gemini');
});

test('Manifest registers Claude.ai and Gemini and popup exposes HTML, Obsidian, and Copy Clean', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://claude.ai/*'));
  assert.ok(manifest.host_permissions.includes('https://gemini.google.com/*'));
  assert.ok(manifest.content_scripts.some(cs => cs.matches.includes('https://claude.ai/*') && cs.matches.includes('https://gemini.google.com/*')));

  const popupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'src', 'popup', 'popup.html'), 'utf8');
  assert.ok(popupHtml.includes('data-format="html"'));
  assert.ok(popupHtml.includes('data-format="obsidian"'));
  assert.ok(popupHtml.includes('id="btn-popup-copy-clean"'));
  assert.ok(popupHtml.includes('id="btn-quick-copy"'));
});

test('Gemini extraction preserves HTML tables as Markdown, strips thinking/sr-only noise, captures images, and labels role as Gemini', async () => {
  const DocumentModel = require('../../extension/src/core/portability/document_model.js');
  const txt = value => ({ nodeType: 3, textContent: value });
  const el = (tag, attrs = {}, cls = '', children = []) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: cls,
    childNodes: children,
    textContent: children.map(c => c.textContent || '').join(''),
    getAttribute: k => attrs[k] ?? null,
    closest: () => null,
    contains: () => false,
    querySelector: sel => {
      if (sel.includes('tr')) return null;
      return null;
    },
    querySelectorAll: sel => {
      const want = sel.split(',').map(s => s.trim().toLowerCase());
      const out = [];
      const walk = n => {
        if (!n || n.nodeType !== 1) return;
        if (want.includes(n.tagName.toLowerCase())) out.push(n);
        (n.childNodes || []).forEach(walk);
      };
      (children || []).forEach(walk);
      return out;
    }
  });

  const tableNode = el('table', {}, '', [
    el('tr', {}, '', [el('th', {}, '', [txt('#')]), el('th', {}, '', [txt('Respuesta')])]),
    el('tr', {}, '', [el('td', {}, '', [txt('1')]), el('td', {}, '', [txt('A. can\'t')])])
  ]);
  const userImg = {
    nodeType: 1, tagName: 'IMG', className: '',
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 400, height: 300,
    getAttribute: k => (k === 'alt' ? 'Pregunta 1' : null),
    closest: () => null
  };
  const userTurn = el('user-query', {}, '', [
    el('h2', {}, 'cdk-visually-hidden', [txt('Tú dijiste Aún faltan más preguntas')]),
    el('p', {}, '', [txt('Aún faltan más preguntas')]),
    userImg
  ]);
  const modelTurn = el('model-response', {}, '', [
    el('model-thoughts', {}, 'thoughts-container', [txt('Google Search · Analizando tus preguntas')]),
    el('h2', {}, 'cdk-visually-hidden', [txt('Gemini dijo')]),
    el('p', {}, '', [txt('Aquí tienes las respuestas:')]),
    tableNode
  ]);

  const doc = {
    title: 'Registro parcial de preguntas - Gemini',
    querySelectorAll: () => [userTurn, modelTurn]
  };
  const conv = MultiPlatform.extractGeminiDom(doc, 'https://gemini.google.com/app/gem99');
  assert.equal(conv.source.platform, 'gemini');
  assert.equal(conv.messages.length, 2);
  assert.ok(!conv.messages[0].text.includes('Tú dijiste'));
  assert.equal(conv.messages[0].attachments.length, 1, 'Gemini uploaded image must be extracted');
  assert.ok(!conv.messages[1].text.includes('Google Search'), 'Gemini thinking trace must be stripped');
  assert.ok(!conv.messages[1].text.includes('Gemini dijo'), 'Gemini sr-only prefix must be stripped');
  assert.ok(conv.messages[1].text.includes('| # | Respuesta |') && conv.messages[1].text.includes('| 1 | A. can\'t |'), 'HTML table must become Markdown table');

  const prepared = await DocumentModel.prepare([conv], { title: conv.title, includeImages: true });
  assert.ok(prepared.html.includes('>Gemini</h3>'), 'PDF/Document role label must say Gemini, not Asistente');
  assert.ok(prepared.html.includes('<table>') && prepared.html.includes("<td>A. can't</td>"), 'Table must render as real HTML table in PDF');
  assert.equal(prepared.imageCount, 1, 'Gemini image must be included in prepared PDF document');
});

test('Enterprise hardening: HtmlBuilder preserves query-param URLs, blocks SVG data URIs, handles escaped-pipe tables, ordered lists, and null entity', () => {
  const safePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const evilSvg = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+';
  const html = HtmlBuilder.buildStandaloneHtml({
    title: 'Hardening Test',
    source: { platform: 'gemini' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: [
        'Ver [Docs](https://example.com/search?q=lossy&lang=es)',
        '',
        '1. Primero',
        '2. Segundo',
        '',
        '| Col A | Col B |',
        '| --- | --- |',
        '| a \\| b | ok |',
        '',
        `![evil](${evilSvg})`,
        `![good](${safePng})`
      ].join('\n'),
      attachments: [{ id: 'a1', kind: 'image', mimeType: 'image/png', filename: 'att.png', dataURI: safePng }]
    }]
  });
  assert.ok(html.includes('href="https://example.com/search?q=lossy&amp;lang=es"'), 'Query-param URLs must remain clickable links');
  assert.ok(html.includes('<ol><li>Primero</li><li>Segundo</li></ol>'), 'Ordered lists must render as <ol>');
  assert.ok(html.includes('<td>a | b</td><td>ok</td>'), 'Escaped pipes in tables must stay inside cell');
  assert.ok(!html.includes('<img src="data:image/svg+xml'), 'SVG data URIs must never render as <img>');
  assert.ok(html.includes('src="' + safePng + '"'), 'Safe raster PNG data URIs must render');
  assert.ok(HtmlBuilder.buildStandaloneHtml(null).includes('<!doctype html>'), 'Null entity must not throw');
});

test('Enterprise hardening: ChatGPTWidgets blocks prototype chain lookups, handles object literals in @body, and survives deep nesting', () => {
  const Widgets = require('../../extension/src/core/chatgpt_widgets.js');
  const protoHtml = Widgets.renderWidgetBlockToHtml('<card>{@body const o = { ok: 42 }}<text>{o["toString"]}</text><text>{o["prototype"]}</text><text>{o["ok"]}</text></card>');
  assert.ok(protoHtml.includes('42'), 'Balanced-brace object literal in @body must evaluate');
  assert.ok(!protoHtml.includes('function toString'), 'Inherited prototype property must not be readable');

  const deepNest = '<box>'.repeat(120) + '<text>Safe</text>' + '</box>'.repeat(120);
  const deepHtml = Widgets.renderWidgetBlockToHtml(deepNest);
  assert.ok(deepHtml.includes('Safe'), 'Deeply nested widget must not overflow stack');
});

test('Enterprise hardening: MultiPlatform null safety, PDF/DOCX/MD dynamic Gemini labels, LinerDB image retention, and icon PNG integrity', async () => {
  const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
  const DocxBuilder = require('../../extension/src/core/portability/docx_builder.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');
  const { LinerDB } = require('../../extension/src/core/storage/liner_db.js');

  assert.equal(MultiPlatform.extractClaudeDom(null, 'https://claude.ai/chat/x').messages.length, 0);
  assert.equal(MultiPlatform.extractGeminiDom(null, 'https://gemini.google.com/app/x').messages.length, 0);

  const geminiConv = {
    canonicalId: 'conv_gemini_ent1',
    title: 'Auditoría Gemini',
    source: { platform: 'gemini', conversationId: 'ent1', url: 'https://gemini.google.com/app/ent1' },
    messages: [
      { id: 'm1', role: 'user', isConversational: true, text: 'Hola', attachments: [{ id: 'att_gemini_1_1', kind: 'image', mimeType: 'image/png', sourceURL: 'https://lh3.googleusercontent.com/test', dataURI: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] },
      { id: 'm2', role: 'assistant', isConversational: true, text: 'Respuesta de Gemini.' }
    ]
  };

  const mdHuman = ExportCenterMod.formatAsMarkdown(geminiConv, 'human', { imageStrategy: 'omit' });
  assert.ok(mdHuman.includes('### Gemini'), 'Human Markdown must label Gemini, not ChatGPT');

  const docxBytes = DocxBuilder.buildDocx(geminiConv, {});
  const docXml = Buffer.from(docxBytes).toString('utf8');
  assert.ok(docXml.includes('>GEMINI<') && !docXml.includes('>CHATGPT<'), 'DOCX must label assistant as GEMINI');

  const pdfBytes = PdfBuilder.buildPdf(geminiConv, {});
  const pdfStr = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(pdfStr.includes('(GEMINI)'), 'PDF must label assistant as GEMINI');

  const db = new LinerDB();
  await db.saveConversation(geminiConv);
  const recaptureWithoutDataUri = structuredClone(geminiConv);
  recaptureWithoutDataUri.messages[0].attachments[0].dataURI = null;
  await db.saveConversation(recaptureWithoutDataUri);
  const stored = await db.getConversation('conv_gemini_ent1');
  assert.ok(stored.messages[0].attachments[0].dataURI?.startsWith('data:image/png;base64,'), 'LinerDB must retain hydrated Gemini dataURI across re-captures');

  const iconDir = path.join(__dirname, '..', '..', 'extension', 'icons');
  const expectedDims = { 'icon16.png': 16, 'icon32.png': 32, 'icon48.png': 48, 'icon128.png': 128, 'logo-lossy.png': 512 };
  for (const [file, dim] of Object.entries(expectedDims)) {
    const buf = fs.readFileSync(path.join(iconDir, file));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} must have valid PNG magic bytes`);
    assert.equal(buf.readUInt32BE(16), dim, `${file} width must be ${dim}`);
    assert.equal(buf.readUInt32BE(20), dim, `${file} height must be ${dim}`);
  }
});
