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
