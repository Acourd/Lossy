'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { LinerDB } = require('../../extension/src/core/storage/liner_db');
const { JobEngine, JOB_STATUS, ITEM_STATUS } = require('../../extension/src/core/jobs/job_engine');
const { GenericTargetAdapter } = require('../../extension/src/targets/generic_target_adapter');
const { createZip } = require('../../extension/src/core/portability/zip_builder');
const { readProjectPackage, planRestore } = require('../../extension/src/core/portability/project_bundle');
const transferBundle = require('../../extension/src/core/portability/transfer_bundle');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const PdfBuilder = require('../../extension/src/core/portability/pdf_builder');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');
const MultiPlatform = require('../../extension/src/platforms/multi_platform_adapter');

function makePngBytes(tag = 1) {
  return new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, tag, 0, 0, 0]);
}

function makeJpegBytes(tag = 1) {
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, tag, 0xFF, 0xD9]);
}

test('R32 P1-1 & P2-UI-1: JobEngine preserva conversationId y bloquea arranques concurrentes sin corromper contadores', async () => {
  const engine = new JobEngine({ db: new LinerDB(), concurrency: 1, itemPacingMs: 10, maxRetries: 0 });
  const job = engine.createJob('BULK_ACQUISITION', [
    { id: 'conv_chatgpt_convA', title: 'A', conversationId: 'convA', url: 'https://chatgpt.com/c/convA', platform: 'chatgpt' },
    { id: 'conv_chatgpt_convB', title: 'B', conversationId: 'convB', url: 'https://chatgpt.com/c/convB', platform: 'chatgpt' }
  ]);
  assert.equal(job.items[0].conversationId, 'convA');
  assert.equal(job.items[0].canonicalId, 'conv_chatgpt_convA');
  assert.equal(job.items[1].conversationId, 'convB');

  let activeWorkerCalls = 0;
  const firstRun = engine.start(job, async (item) => {
    activeWorkerCalls++;
    await new Promise(r => setTimeout(r, 40));
    return { canonicalId: item.id };
  });

  await assert.rejects(
    engine.start({ jobId: 'foreign', items: [{ id: 'x', status: ITEM_STATUS.PENDING, retries: 0 }] }, async () => ({ id: 'x' })),
    /concurrente/i
  );
  await assert.rejects(engine.run(async () => ({})), /concurrente/i);

  const finished = await firstRun;
  assert.equal(finished.jobId, job.jobId);
  assert.equal(finished.status, JOB_STATUS.COMPLETED);
  assert.equal(finished.completedItems, 2);
  assert.equal(finished.failedItems, 0);
  assert.equal(activeWorkerCalls, 2);
});

test('R32 P1-2: LinerDB.clearAll invalida escrituras iniciadas antes del borrado', async () => {
  const db = new LinerDB();
  await db.saveConversation({ canonicalId: 'conv_old', title: 'Sensible', messages: [{ id: 'm1', role: 'user', content: { text: 'Secreto' } }] });
  const epochBeforeClear = db.getWipeEpoch();

  const clearPromise = db.clearAll();
  await assert.rejects(
    db.saveConversation({ canonicalId: 'conv_inflight', title: 'Inflight', messages: [{ id: 'm1', role: 'assistant', content: { text: 'Fuga' } }] }, { expectedWipeEpoch: epochBeforeClear }),
    /WRITE_ABORTED_BY_CLEAR_ALL/
  );
  await clearPromise;

  await assert.rejects(
    db.saveClip({ canonicalId: 'clip_inflight', title: 'Clip Inflight', selectedMessages: [{ id: 'm1', role: 'assistant', content: { text: 'Fuga' } }] }, { expectedWipeEpoch: epochBeforeClear }),
    /WRITE_ABORTED_BY_CLEAR_ALL/
  );

  assert.equal(await db.getConversation('conv_old'), null);
  assert.equal(await db.getConversation('conv_inflight'), null);
  assert.equal(await db.getConversation('clip_inflight'), null);
  assert.equal((await db.listMetadata()).length, 0);
});

test('R32 P1-3: multi_platform_content rechaza desajuste de conversationId y DOM obsoleto tras navegación SPA', async () => {
  const listeners = [];
  let currentHref = 'https://claude.ai/chat/11111111-1111-1111-1111-111111111111';
  let domText = 'Respuesta privada de A';
  let domConvAttr = '11111111-1111-1111-1111-111111111111';

  const makeMockAdapter = () => ({
    detectPlatform(u) {
      const m = String(u || '').match(/\/chat\/([a-f0-9-]+)/i);
      return m ? { platform: 'claude', conversationId: m[1] } : null;
    },
    extractClaudeDom(_doc, u) {
      const m = String(u || '').match(/\/chat\/([a-f0-9-]+)/i);
      return {
        canonicalId: `conv_claude_${m[1]}`,
        title: 'Claude',
        source: { platform: 'claude', conversationId: m[1], url: u },
        messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: domText, content: { text: domText }, attachments: [] }],
        attachments: []
      };
    },
    extractGeminiDom(_doc, u) { return this.extractClaudeDom(_doc, u); }
  });

  const sandbox = {
    window: {
      location: { get href() { return currentHref; } },
      addEventListener() {}
    },
    history: { pushState() {}, replaceState() {} },
    document: {
      querySelector(sel) {
        if (sel === '[data-conversation-id]') return { getAttribute: () => domConvAttr };
        return null;
      }
    },
    chrome: {
      runtime: {
        id: 'test-ext',
        onMessage: { addListener(fn) { listeners.push(fn); } }
      }
    },
    globalThis: null,
    Lossy: { MultiPlatform: makeMockAdapter() },
    AbortController,
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/multi_platform_content.js'), 'utf8');
  vm.runInNewContext(code, sandbox);

  const callMsg = msg => new Promise(resolve => {
    const keepOpen = listeners[0](msg, { id: 'test-ext' }, resolve);
    if (!keepOpen) { /* resolved synchronously */ }
  });

  // 1. Captura correcta en A registra firma de A
  const resA = await callMsg({ action: 'ACQUIRE_CONVERSATION', conversationId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(resA.success, true);

  // 2. Identidad solicitada distinta debe fallar explícitamente
  const resMismatch = await callMsg({ action: 'ACQUIRE_CONVERSATION', conversationId: '22222222-2222-2222-2222-222222222222' });
  assert.equal(resMismatch.success, false);
  assert.match(resMismatch.error, /MISMATCH/i);

  // 3. Navegación SPA a URL B mientras DOM aún refleja texto/ID de A sin converger -> rechaza
  currentHref = 'https://claude.ai/chat/22222222-2222-2222-2222-222222222222';
  const resStale = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
  assert.equal(resStale.success, false);

  // 4. Cuando DOM converge a B -> captura exitosa bajo B
  domConvAttr = '22222222-2222-2222-2222-222222222222';
  domText = 'Respuesta nueva de B';
  const resB = await callMsg({ action: 'ACQUIRE_CONVERSATION', conversationId: '22222222-2222-2222-2222-222222222222' });
  assert.equal(resB.success, true);
  assert.equal(resB.data.messages[0].text, 'Respuesta nueva de B');
});

test('R32 P1-4 & P2-Cap-1..5: content_script convergencia virtualizada 180ms, navegación inicio->conv, roles system/tool, rowspan, ol/blockquote y JPEG', async () => {
  let activeHref = 'https://chatgpt.com/';
  let scrollTop = 1000;
  let allTurns = Array.from({ length: 12 }, (_, idx) => ({
    id: `m_${idx + 1}`,
    role: idx === 0 ? 'system' : (idx === 1 ? 'tool' : (idx % 2 === 0 ? 'user' : 'assistant')),
    text: `Turno ${idx + 1}`
  }));
  let windowRange = [8, 12]; // Al inicio solo los últimos 4 turnos visibles
  let topMounted = false;

  const makeTurnNode = t => ({
    tagName: 'DIV',
    nodeType: 1,
    style: {},
    setAttribute() {},
    hasAttribute() { return false; },
    appendChild() {},
    getAttribute(attr) {
      if (attr === 'data-message-author-role') return t.role;
      if (attr === 'data-message-id') return t.id;
      return null;
    },
    querySelector(sel) {
      if (sel === '.markdown') return this;
      return null;
    },
    querySelectorAll() { return []; },
    cloneNode() {
      return {
        nodeType: 1,
        tagName: 'DIV',
        textContent: t.text,
        childNodes: [{ nodeType: 3, textContent: t.text }],
        querySelectorAll() { return []; },
        querySelector() { return null; }
      };
    }
  });

  const scrollEl = {
    tagName: 'DIV',
    className: 'thread-scroll-container',
    get scrollTop() { return scrollTop; },
    set scrollTop(val) {
      scrollTop = val;
      if (val === 0 && !topMounted) {
        setTimeout(() => {
          topMounted = true;
          windowRange = [0, 8];
        }, 180);
      } else if (val > 0 && topMounted) {
        const start = Math.min(8, Math.floor((val / 1000) * 8));
        windowRange = [start, Math.min(12, start + 6)];
      }
    },
    get scrollHeight() { return topMounted ? 1800 : 1200; },
    clientHeight: 800
  };

  const sandbox = {
    window: {
      location: {
        get href() { return activeHref; },
        get pathname() { return new URL(activeHref).pathname; }
      },
      addEventListener() {}
    },
    document: {
      scrollingElement: scrollEl,
      documentElement: scrollEl,
      body: { appendChild() {}, querySelectorAll() { return []; } },
      querySelector(sel) {
        if (sel === '.thread-scroll-container') return scrollEl;
        if (sel === 'title') return { textContent: 'ChatGPT' };
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-message-author-role]') {
          return allTurns.slice(windowRange[0], windowRange[1]).map(makeTurnNode);
        }
        return [];
      },
      createElement() {
        return { className: '', innerHTML: '', style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {} };
      },
      createTextNode(text) { return { nodeType: 3, textContent: text }; }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: { storage: { local: { get: async () => ({}) } } },
    module: { exports: {} },
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {}, group() {}, groupEnd() {}, table() {} },
    Liner: {},
    Lossy: {}
  };
  const csCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/content_script.js'), 'utf8');
  vm.runInNewContext(csCode, sandbox);
  const exportsCs = sandbox.module.exports;

  // P2-Cap-1: inicio -> conversación incrementa época
  exportsCs.resetNavigationEpochForTest();
  assert.equal(exportsCs.checkNavigationEpoch(), 0);
  activeHref = 'https://chatgpt.com/c/conv_123';
  assert.equal(exportsCs.checkNavigationEpoch(), 1);

  // P1-4: virtualización diferida 180ms captura los 12 turnos con integridad 'harvested' y preserva system/tool
  const harvested = await exportsCs.harvestAllConversationTurns('conv_123', 1);
  assert.equal(harvested.integrity, 'harvested');
  assert.equal(harvested.turns.length, 12);
  assert.equal(harvested.turns[0].role, 'system');
  assert.equal(harvested.turns[1].role, 'tool');

  // P2-Cap-3 & P2-Cap-4: tabla rowspan y ol/blockquote en messageDomText
  const cell = (txt, attrs = {}) => ({
    nodeType: 1, tagName: 'TD',
    getAttribute: k => attrs[k] ?? null,
    childNodes: [{ nodeType: 3, textContent: txt }]
  });
  const tr = cells => ({ nodeType: 1, tagName: 'TR', querySelectorAll: () => cells });
  const fakeTable = {
    nodeType: 1,
    tagName: 'TABLE',
    querySelectorAll: sel => sel === 'tr' ? [
      tr([cell('Grupo', { rowspan: '2' }), cell('Valor')]),
      tr([cell('B')])
    ] : []
  };
  const mdTable = exportsCs.messageDomText(fakeTable);
  assert.match(mdTable, /\| Grupo \| Valor \|/);
  assert.match(mdTable, /\|  \| B \|/);

  const fakeOl = {
    nodeType: 1,
    tagName: 'OL',
    getAttribute: k => (k === 'start' ? '3' : null),
    childNodes: [
      { nodeType: 1, tagName: 'LI', childNodes: [{ nodeType: 3, textContent: 'Tres' }] },
      { nodeType: 1, tagName: 'LI', childNodes: [{ nodeType: 3, textContent: 'Cuatro' }] }
    ]
  };
  const fakeBq = {
    nodeType: 1,
    tagName: 'BLOCKQUOTE',
    childNodes: [{ nodeType: 3, textContent: 'Cita A\nCita B' }]
  };
  assert.match(exportsCs.messageDomText(fakeOl), /3\. Tres/);
  assert.match(exportsCs.messageDomText(fakeOl), /4\. Cuatro/);
  assert.match(exportsCs.messageDomText(fakeBq), /> Cita A\n> Cita B/);

  // P2-Cap-5: JPEG en MultiPlatform
  const jpegDom = {
    title: 'Gemini JPG',
    querySelectorAll(sel) {
      if (sel.includes('model-response')) {
        return [{
          tagName: 'MODEL-RESPONSE',
          className: '',
          getAttribute: () => null,
          querySelector: () => null,
          querySelectorAll(sub) {
            if (sub === 'img') {
              return [{
                currentSrc: 'https://lh3.googleusercontent.com/pic.jpg',
                getAttribute: k => k === 'src' ? 'https://lh3.googleusercontent.com/pic.jpg' : 'foto',
                naturalWidth: 200,
                naturalHeight: 200,
                complete: false
              }];
            }
            return [];
          },
          childNodes: [{ nodeType: 3, textContent: 'Mira esto' }]
        }];
      }
      return [];
    }
  };
  const gemConv = MultiPlatform.extractGeminiDom(jpegDom, 'https://gemini.google.com/app/g123');
  assert.equal(gemConv.attachments[0].mimeType, 'image/jpeg');
  assert.match(gemConv.attachments[0].filename, /\.jpg$/);
});

test('R32 P1-5 & P2-Exp-1: proyecto ZIP/JSON preserva ArrayBuffer, Buffer y Blob (fail-closed síncrono, completo asíncrono)', async () => {
  const pngBytes = makePngBytes(7);
  const convAb = {
    canonicalId: 'conv_ab',
    title: 'ArrayBuffer & Buffer',
    source: { platform: 'chatgpt' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      content: { text: 'Adjuntos' },
      attachments: [
        { id: 'att_ab', name: 'ab.png', mimeType: 'image/png', data: pngBytes.buffer.slice(0) },
        { id: 'att_buf', name: 'buf.png', mimeType: 'image/png', data: Buffer.from(makePngBytes(8)) }
      ]
    }],
    integrity: { status: 'captured' }
  };

  // ArrayBuffer & Buffer sobreviven generatePackage -> ZIP -> readProjectPackage -> resolveAssetBinaries
  const pkgAb = new GenericTargetAdapter().generatePackage([convAb], {
    projectTitle: 'Proj Bin',
    projectContext: { goal: 'Keep bins', decisions: '', openQuestions: '', nextStep: '', status: 'active' }
  });
  const bundleAb = await readProjectPackage(createZip(pkgAb.files));
  const resolvedAb = await AssetResolver.resolveAssetBinaries(bundleAb.sources[0]);
  assert.deepEqual(resolvedAb.assetBinaryMap.get('att_ab'), pngBytes);
  assert.deepEqual(resolvedAb.assetBinaryMap.get('att_buf'), makePngBytes(8));

  // ExportCenter JSON serializa y AssetResolver recupera Uint8Array / ArrayBuffer / Buffer / Blob
  const center = new ExportCenter();
  const jsonOut = await center.exportSingle(convAb, 'json');
  const parsedJson = JSON.parse(jsonOut.data);
  const resolvedJson = await AssetResolver.resolveAssetBinaries(parsedJson);
  assert.deepEqual(resolvedJson.assetBinaryMap.get('att_ab'), pngBytes);

  // Blob sin materializar en flujo síncrono debe fallar cerrado (sin recibo falso)
  const blobConv = {
    canonicalId: 'conv_blob',
    title: 'Blob',
    source: { platform: 'chatgpt' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      content: { text: 'Con blob' },
      attachments: [{ id: 'att_blob', name: 'b.png', mimeType: 'image/png', data: new Blob([makePngBytes(9)], { type: 'image/png' }) }]
    }],
    integrity: { status: 'captured' }
  };
  assert.throws(() => new GenericTargetAdapter().generatePackage([blobConv], {
    projectTitle: 'FailBlob',
    projectContext: { goal: 'Fail sync', decisions: '', openQuestions: '', nextStep: '', status: 'active' }
  }), /Blob/);

  // generatePackageAsync materializa Blob y el ciclo ZIP -> leer -> AssetResolver conserva los bytes exactos
  const pkgAsync = await new GenericTargetAdapter().generatePackageAsync([blobConv], {
    projectTitle: 'AsyncBlob',
    projectContext: { goal: 'Keep blob', decisions: '', openQuestions: '', nextStep: '', status: 'active' }
  });
  const bundleBlob = await readProjectPackage(createZip(pkgAsync.files));
  const resolvedBlob = await AssetResolver.resolveAssetBinaries(bundleBlob.sources[0]);
  assert.deepEqual(resolvedBlob.assetBinaryMap.get('att_blob'), makePngBytes(9));
  assert.ok(transferBundle);
});

test('R32 P2-Wid-1..3: separadores temáticos, definiciones de referencia, {@body} anidado y listas de 64+ elementos', () => {
  const payload = '![LIT](https://audit.invalid/keep.png) <Cite id="KEEP"/>';

  // P2-Wid-1: tras '- - -' y definiciones de referencia [foo]: url
  for (const sample of [
    `- - -\n    ${payload}`,
    `[foo]: https://example.com\n    ${payload}`,
    `[foo]:\nhttps://example.com\n    ${payload}`
  ]) {
    const segs = ChatGPTWidgets.splitFencedCodeSegments(sample);
    assert.equal(segs.some(s => s.isCode && s.text.includes('KEEP')), true, sample);
    assert.equal(ChatGPTWidgets.renderWidgetsToMarkdown(sample).includes('KEEP'), true);
  }

  // P2-Wid-2: {@body ...} con objetos anidados no trunca en la primera '}'
  const dilObj = `{@body const cfg = { meta: { label: 'OK' } }}<card><title>{cfg.meta.label}</title></card>`;
  const renderedHtml = ChatGPTWidgets.renderWidgetsToHtml(dilObj);
  assert.equal(renderedHtml.includes('OK'), true);
  assert.equal(renderedHtml.includes('<card>'), false);

  // P2-Wid-3: lista plana de 64+ elementos evalúa completa sin agotar depth
  const items64 = Array.from({ length: 64 }, (_, i) => i + 1).join(',');
  const listRes = ChatGPTWidgets.safeEvalExpr(`[${items64}]`, {});
  assert.equal(Array.isArray(listRes), true);
  assert.equal(listRes.length, 64);
  assert.equal(listRes[63], 64);
});

test('R32 P2-Exp-2..5: JPEG Markdown, desambiguación TXT ZIP, PDF literales en código y HTML codeBlocks separados', async () => {
  const center = new ExportCenter();
  const jpgBytes = makeJpegBytes(3);

  // P2-Exp-2: Markdown JPEG explícito y sin extensión en URL aceptan JPEG real; .png explícito falsificado rechaza
  const mdJpg = {
    canonicalId: 'r32_jpg',
    title: 'JPG',
    source: { platform: 'chatgpt' },
    messages: [{ id: 'm1', role: 'assistant', text: '![ext](https://audit.invalid/pic.jpg) ![noext](https://audit.invalid/pic) ![spoof](https://audit.invalid/fake.png)' }]
  };
  const resJpg = await AssetResolver.resolveAssetBinaries(mdJpg, {
    fetch: async () => new Response(jpgBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
  });
  assert.equal(resJpg.assets[0].availability, 'downloaded');
  assert.equal(resJpg.assets[1].availability, 'downloaded');
  assert.equal(resJpg.assets[1].mimeType, 'image/jpeg');
  assert.equal(resJpg.assets[2].availability, 'unavailable');

  // P2-Exp-3: imágenes distintas con mismo filename 'foto.png' (mismo mensaje y distintos mensajes) en TXT empaquetado
  const convSharedName = {
    canonicalId: 'r32_txt_dup',
    title: 'TXT Dup',
    source: { platform: 'chatgpt' },
    messages: [
      {
        id: 'm1', role: 'assistant', text: 'Uno',
        attachments: [
          { id: 'a1', assetId: 'a1', filename: 'foto.png', mimeType: 'image/png', kind: 'image', data: makePngBytes(11) },
          { id: 'a1b', assetId: 'a1b', filename: 'foto.png', mimeType: 'image/png', kind: 'image', data: makePngBytes(12) }
        ]
      },
      { id: 'm2', role: 'assistant', text: 'Dos', attachments: [{ id: 'a2', assetId: 'a2', filename: 'foto.png', mimeType: 'image/png', kind: 'image', data: makePngBytes(22) }] }
    ]
  };
  const txtPkg = await center.exportSingle(convSharedName, 'txt', 'ai', { imageStrategy: 'package' });
  const { parseZip } = require('../../extension/src/core/portability/zip_builder');
  const txtFiles = parseZip(txtPkg.data);
  const txtEntry = Object.entries(txtFiles).find(([name]) => name.endsWith('.txt'));
  assert.ok(txtEntry);
  const txtText = new TextDecoder().decode(txtEntry[1]);
  const linkedPaths = Array.from(txtText.matchAll(/\[IMAGE: (assets\/[^\]]+)\]/g)).map(m => m[1]);
  assert.equal(linkedPaths.length, 3);
  assert.equal(new Set(linkedPaths).size, 3);
  assert.deepEqual(Array.from(txtFiles[linkedPaths[0]]), Array.from(makePngBytes(11)));
  assert.deepEqual(Array.from(txtFiles[linkedPaths[1]]), Array.from(makePngBytes(12)));
  assert.deepEqual(Array.from(txtFiles[linkedPaths[2]]), Array.from(makePngBytes(22)));

  // P2-Exp-4: PDF preserva \uE200...\uE201 literales dentro de bloques de código y los limpia en prosa
  const pdfConv = {
    canonicalId: 'r32_pdf',
    title: 'PDFCode',
    source: { platform: 'chatgpt' },
    messages: [{ id: 'm1', role: 'assistant', text: 'Prosa \uE200DROP_PROSE\uE201 fin.\n\n```\nKEEP_\uE200CODE_LIT\uE201\n```' }]
  };
  const pdfBytes = PdfBuilder.buildPdf(pdfConv, { imageStrategy: 'omit' });
  const pdfAscii = Buffer.from(pdfBytes).toString('latin1');
  assert.equal(pdfAscii.includes('DROP_PROSE'), false);
  assert.equal(pdfAscii.includes('CODE_LIT'), true);

  // P2-Exp-5: HtmlBuilder renderiza codeBlocks almacenados por separado
  const htmlWithSeparateCode = HtmlBuilder.buildStandaloneHtml({
    canonicalId: 'r32_html_cb',
    title: 'HTML CB',
    source: { platform: 'chatgpt' },
    messages: [{ id: 'm1', role: 'assistant', text: 'Explicación', codeBlocks: [{ language: 'js', code: 'const separateBlock = 42;' }] }]
  }, { imageStrategy: 'omit' });
  assert.equal(htmlWithSeparateCode.includes('const separateBlock = 42;'), true);
});

test('R32 P2-UI-2 & P2-UI-3: deshacer eliminación restaura carpetas de proyecto y metadatos intactos de clip', async () => {
  const db = new LinerDB();
  await db.saveConversation({
    canonicalId: 'conv_gemini_g1',
    title: 'Origen Gemini',
    source: { platform: 'gemini', conversationId: 'g1' },
    messages: [{ id: 'm1', role: 'assistant', content: { text: 'Hola' } }]
  });
  const clip = {
    canonicalId: 'clip_g1',
    id: 'clip_g1',
    entityType: 'clip',
    title: 'Clip Gemini',
    sourcePlatform: 'gemini',
    sourceModel: 'gemini-2.5',
    sourceConversationCanonicalId: 'conv_gemini_g1',
    sourceConversationTitle: 'Origen Gemini',
    selectionType: 'single-message',
    selectedMessages: [{ id: 'm1', role: 'assistant', content: { text: 'Hola' } }],
    provenance: { sourcePlatform: 'gemini', sourceStatus: 'source_available_locally', sourceConversationCanonicalId: 'conv_gemini_g1' }
  };
  await db.saveClip(clip);

  const col = await db.createCollection('Proyecto Carpetas', '', ['clip_g1']);
  await db.mutateCollection(col.collectionId, c => {
    c.organization = {
      version: 1,
      folders: [{ id: 'fld_root', name: 'Raíz', parentId: null, conversationIds: ['clip_g1'] }]
    };
  });

  await db.deleteClip('clip_g1');
  assert.equal((await db.getCollection(col.collectionId)).organization.folders[0].conversationIds.length, 0);

  await db.restoreConversation(clip, [col.collectionId], { [col.collectionId]: ['fld_root'] });

  const restoredCol = await db.getCollection(col.collectionId);
  assert.deepEqual(restoredCol.conversationIds, ['clip_g1']);
  assert.deepEqual(restoredCol.organization.folders[0].conversationIds, ['clip_g1']);

  const meta = (await db.listMetadata()).find(m => m.canonicalId === 'clip_g1');
  assert.equal(meta.entityType, 'clip');
  assert.equal(meta.platform, 'gemini');
  assert.equal(meta.sourceStatus, 'source_available_locally');
  assert.equal(meta.sourceConversationCanonicalId, 'conv_gemini_g1');
});
