'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LinerDB } = require('../../extension/src/core/storage/liner_db.js');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder.js');
const Widgets = require('../../extension/src/core/chatgpt_widgets.js');
const ExportCenterMod = require('../../extension/src/core/portability/export_center.js');
const DocumentModel = require('../../extension/src/core/portability/document_model.js');
const DocxBuilder = require('../../extension/src/core/portability/docx_builder.js');
const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
const MultiPlatform = require('../../extension/src/platforms/multi_platform_adapter.js');
const ProjectBundle = require('../../extension/src/core/portability/project_bundle.js');
const ContentScript = require('../../extension/src/content/content_script.js');

// P1-1: Una captura parcial nunca sobrescribe silenciosamente una captura completa
test('P1-1: LinerDB prevents a partial capture from silently overwriting a complete capture', async () => {
  const db = new LinerDB();
  const fullConv = {
    canonicalId: 'conv_chatgpt_p1_1',
    title: 'Full Chat',
    source: { platform: 'chatgpt', conversationId: 'p1_1' },
    integrity: { status: 'captured' },
    messages: [
      { id: 'm1', role: 'user', text: 'Msg 1', content: { text: 'Msg 1' } },
      { id: 'm2', role: 'assistant', text: 'Msg 2', content: { text: 'Msg 2' } }
    ]
  };
  await db.saveConversation(fullConv);

  const partialConv = {
    canonicalId: 'conv_chatgpt_p1_1',
    title: 'Full Chat',
    source: { platform: 'chatgpt', conversationId: 'p1_1' },
    integrity: { status: 'partial' },
    messages: [
      { id: 'm1', role: 'user', text: 'Msg 1', content: { text: 'Msg 1' } }
    ]
  };
  await db.saveConversation(partialConv);

  const stored = await db.getConversation('conv_chatgpt_p1_1');
  assert.equal(stored.messages.length, 2, 'Complete capture must be preserved against partial overwrite');
  assert.equal(stored.integrity.status, 'captured');

  // Explicit forceOverwrite is honored when requested
  await db.saveConversation({ ...partialConv, forceOverwrite: true });
  const forced = await db.getConversation('conv_chatgpt_p1_1');
  assert.equal(forced.messages.length, 1, 'Explicit forceOverwrite must be respected');
});

// P1-3: Deduplicación preserva turnos distintos con solo imagen y recursos entre ventanas
test('P1-3: areTurnsEqual distinguishes image-only turns and different IDs; ExportCenter scopes asset keys per message', () => {
  const t1 = { id: 'm1', role: 'user', text: '', codeBlocks: [], attachments: [{ id: 'a1', sourceURL: 'https://img/1.png' }] };
  const t2 = { id: 'm2', role: 'user', text: '', codeBlocks: [], attachments: [{ id: 'a2', sourceURL: 'https://img/2.png' }] };
  assert.equal(ContentScript.areTurnsEqual(t1, t2), false, 'Distinct IDs/images must not be equal');

  const aligned = ContentScript.alignAndAppendTurns([t1], [t2]);
  assert.equal(aligned.length, 2, 'Two distinct image-only turns must both survive alignment');

  const conv = {
    canonicalId: 'conv_chatgpt_p1_3',
    title: 'Multi-window Images',
    messages: [
      { id: 'm1', role: 'user', text: '', attachments: [{ id: 'dom_att_img_0_0', kind: 'image', mimeType: 'image/png', dataURI: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] },
      { id: 'm2', role: 'assistant', text: '', attachments: [{ id: 'dom_att_img_0_0', kind: 'image', mimeType: 'image/png', dataURI: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] }
    ]
  };
  const assets = ExportCenterMod.AssetResolver.resolveAssetsForEntity(conv);
  assert.equal(assets.length, 2, 'Attachments in distinct messages with colliding IDs must both be preserved');
});

// P1-5: Detección de roles no confunde "ChatGPT said:" ni encabezados Markdown con usuario
test('P1-5: extractVisibleTurns preserves roles for "You said:" / "ChatGPT said:" and ignores content headings', () => {
  const mkEl = (tag, text, parent = null, attrs = {}) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    textContent: text,
    innerText: text,
    parentElement: parent,
    childNodes: [{ nodeType: 3, textContent: text }],
    getAttribute: k => attrs[k] ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode() { return { ...this, querySelector: () => null, querySelectorAll: () => [] }; }
  });

  const userWrap = {
    nodeType: 1, tagName: 'DIV',
    getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    childNodes: [{ nodeType: 3, textContent: 'How do I deploy?' }],
    cloneNode() { return { ...this, querySelector: () => null, querySelectorAll: () => [] }; }
  };
  const aiWrap = {
    nodeType: 1, tagName: 'DIV',
    getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    childNodes: [{ nodeType: 3, textContent: 'Run npm run build.' }],
    cloneNode() { return { ...this, querySelector: () => null, querySelectorAll: () => [] }; }
  };
  const h4User = mkEl('h4', 'You said:', userWrap);
  const h4Content = mkEl('h4', 'How you deploy', aiWrap);
  const h4Ai = mkEl('h4', 'ChatGPT said:', aiWrap);

  const mockRoot = {
    querySelectorAll: sel => (sel === 'h4' ? [h4User, h4Content, h4Ai] : [])
  };
  const turns = ContentScript.extractVisibleTurns(mockRoot);
  assert.equal(turns.length, 2, 'Content heading "How you deploy" must be ignored');
  assert.equal(turns[0].role, 'user');
  assert.equal(turns[1].role, 'assistant', '"ChatGPT said:" must map to assistant, never user');
});

// P1-7 & P2-5: HtmlBuilder no se cuelga en "| ordinary text" y "omit" elimina inline Base64
test('P1-7 & P2-5: HtmlBuilder terminates cleanly on stray leading pipes and strips inline Base64 when imageStrategy is omit', () => {
  const safePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const html = HtmlBuilder.buildStandaloneHtml({
    title: 'Pipe & Omit Test',
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: `| ordinary text\n\nAnother line\n\n![pic](${safePng})`
    }]
  }, { imageStrategy: 'omit' });
  assert.ok(html.includes('| ordinary text'), 'Stray leading pipe must be preserved as paragraph text without infinite loop');
  assert.ok(!html.includes('data:image/png;base64,'), 'imageStrategy=omit must strip inline Base64 images');
});

// P2-2: DIL evaluator no abandona tokens en cortocircuito || / &&
test('P2-2: ChatGPTWidgets DIL evaluator evaluates "true || false ? 1 : 2" to 1 without skipping tokens', () => {
  const html = Widgets.renderWidgetBlockToHtml('<card><text>{true || false ? 1 : 2}</text><text>{false && true ? 10 : 20}</text></card>');
  assert.ok(html.includes('>1<'), 'true || false ? 1 : 2 must evaluate to 1');
  assert.ok(html.includes('>20<'), 'false && true ? 10 : 20 must evaluate to 20');
});

// P2-4: MultiPlatform preserva rowspan y la indentación de código con fences dinámicos
test('P2-4: MultiPlatform preserves rowspan alignment, code indentation, and backtick fences', () => {
  const txt = v => ({ nodeType: 3, textContent: v });
  const el = (tag, attrs = {}, children = []) => ({
    nodeType: 1, tagName: tag.toUpperCase(), className: attrs.class || '',
    childNodes: children,
    textContent: children.map(c => c.textContent || '').join(''),
    getAttribute: k => attrs[k] ?? null,
    querySelector: sel => (sel === 'code' ? children.find(c => c.tagName === 'CODE') || null : null),
    querySelectorAll: sel => {
      const want = sel.split(',').map(s => s.trim().toLowerCase());
      const out = [];
      const walk = n => { if (!n || n.nodeType !== 1) return; if (want.includes(n.tagName.toLowerCase())) out.push(n); (n.childNodes || []).forEach(walk); };
      children.forEach(walk);
      return out;
    }
  });
  const tbl = el('table', {}, [
    el('tr', {}, [el('th', {}, [txt('Group')]), el('th', {}, [txt('Val')])]),
    el('tr', {}, [el('td', { rowspan: '2' }, [txt('G1')]), el('td', {}, [txt('A')])]),
    el('tr', {}, [el('td', {}, [txt('B')])])
  ]);
  const mdTbl = MultiPlatform.serializeDomToMarkdown(tbl);
  assert.ok(mdTbl.includes('| G1 | A |') && mdTbl.includes('|  | B |'), 'rowspan must align second row column cleanly');

  const pre = el('pre', {}, [el('code', { class: 'language-md' }, [txt('    indented\n```nested```')])]);
  const mdCode = MultiPlatform.serializeDomToMarkdown(pre);
  assert.ok(mdCode.includes('````md\n    indented\n```nested```\n````'), 'Indentation and nested backticks must be preserved');
});

// P2-6 & P2-7: DOCX/PDF preservan orden de bloques, DOCX limpia controles XML y PDF preserva Unicode explícitamente
test('P2-6 & P2-7: DOCX/PDF preserve interleaved prose-code-prose order, strip illegal XML control chars, and mark non-WinAnsi Unicode', async () => {
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');
  const conv = {
    canonicalId: 'conv_gemini_order',
    title: 'Orden\x00 & Unicode',
    source: { platform: 'gemini' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: 'BEFORE_CODE\n\n```js\nconst x = 1;\n```\n\nAFTER_CODE 日本語 🚀'
    }]
  };

  const docxFiles = await ZipBuilder.unzip(DocxBuilder.buildDocx(conv, {}));
  const docXml = Buffer.from(docxFiles['word/document.xml']).toString('utf8');
  const coreXml = Buffer.from(docxFiles['docProps/core.xml']).toString('utf8');
  assert.ok(!docXml.includes('\x00') && !coreXml.includes('\x00'), 'Illegal XML control char 0x00 must be stripped from DOCX XML parts');
  assert.ok(docXml.indexOf('BEFORE_CODE') < docXml.indexOf('const x = 1;'), 'BEFORE_CODE must precede code in DOCX');
  assert.ok(docXml.indexOf('const x = 1;') < docXml.indexOf('AFTER_CODE'), 'Code must precede AFTER_CODE in DOCX');

  const pdfStr = Buffer.from(PdfBuilder.buildPdf(conv, {})).toString('latin1');
  assert.ok(pdfStr.indexOf('BEFORE_CODE') < pdfStr.indexOf('const x = 1;'), 'BEFORE_CODE must precede code in PDF');
  assert.ok(pdfStr.indexOf('const x = 1;') < pdfStr.indexOf('AFTER_CODE'), 'Code must precede AFTER_CODE in PDF');
  assert.ok(pdfStr.includes('[U+65E5]') && pdfStr.includes('[U+1F680]'), 'Non-WinAnsi Unicode must be preserved explicitly instead of blanked');
});

// P2-8: Mensajes JSON legítimos del usuario no son descartados por heurística interna
test('P2-8: Legitimate user JSON examples mentioning /Automations/ are preserved across DocumentModel and ExportCenter', async () => {
  const conv = {
    canonicalId: 'conv_chatgpt_json_user',
    title: 'User JSON Example',
    source: { platform: 'chatgpt' },
    messages: [
      { id: 'm1', role: 'user', isConversational: true, text: '{"path": "/Automations/daily.json", "note": "example"}' },
      { id: 'm2', role: 'assistant', isConversational: true, text: 'Looks valid.' }
    ]
  };
  const prepared = await DocumentModel.prepare([conv], { title: conv.title, includeImages: false });
  assert.equal(prepared.messageCount, 2, 'User JSON message must not be dropped by DocumentModel');

  const center = new ExportCenterMod.ExportCenter();
  const obs = await center.exportSingle(conv, 'md', 'obsidian', { imageStrategy: 'omit' });
  assert.ok(obs.data.includes('/Automations/daily.json'), 'User JSON message must be preserved in Obsidian export');
});

// P2-1: ProjectBundle rechaza métricas mal tipadas y plataformas desconocidas
test('P2-1: ProjectBundle rejects malformed entity metrics and invalid platforms', async () => {
  const zip = require('../../extension/src/core/portability/zip_builder.js');
  const crypto = require('../../extension/src/core/crypto_util.js');
  const badConv = {
    canonicalId: 'conv_bad_1',
    source: { platform: '<img src=x onerror=alert(1)>' },
    conversationMessageCount: '<script>1</script>',
    messages: [{ id: 'm1', role: 'user', content: { text: 'hi' } }]
  };
  const files = {
    'project.json': JSON.stringify({ version: '1.1', name: 'Test', sourceIds: ['conv_bad_1'], sources: [{ canonicalId: 'conv_bad_1', path: 'conversations/conv_bad_1.json' }] }),
    'conversations/conv_bad_1.json': JSON.stringify(badConv)
  };
  const fileHashes = {};
  for (const [k, v] of Object.entries(files)) fileHashes[k] = crypto.sha256(Buffer.from(v, 'utf8'));
  files['portability/receipt.json'] = JSON.stringify({ fileHashes });
  const zipBytes = zip.createZip(files);
  await assert.rejects(() => ProjectBundle.readProjectPackage(zipBytes), /Plataforma de fuente inválida|Métrica numérica inválida/);
});
