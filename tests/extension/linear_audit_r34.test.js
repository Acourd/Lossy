'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const zlib = require('node:zlib');
const { LinerDB } = require('../../extension/src/core/storage/liner_db');
const { JobEngine, JOB_STATUS, ITEM_STATUS } = require('../../extension/src/core/jobs/job_engine');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const MarkdownIt = require('../../extension/vendor/markdown-it.min.js');

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makeSolidPngDataUri(r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rawScanline = Buffer.from([0, r, g, b]);
  const idat = zlib.deflateSync(rawScanline, { level: 0 });
  const png = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeElement(tag, attrs = {}, children = []) {
  const normalizedTag = String(tag || 'div').toUpperCase();
  const el = {
    nodeType: 1,
    tagName: normalizedTag,
    childNodes: [],
    parentNode: null,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false, [Symbol.iterator]: function* () {} },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    addEventListener() {},
    removeEventListener() {},
    appendChild(ch) { if (ch) el.childNodes.push(ch); return ch; },
    closest() { return null; },
    querySelector(sel) {
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue;
        if (sel === 'code' && c.tagName === 'CODE') return c;
        const nested = c.querySelector?.(sel);
        if (nested) return nested;
      }
      return null;
    },
    querySelectorAll() { return []; },
    cloneNode() { return el; }
  };
  for (const ch of children) {
    const childNode = typeof ch === 'string'
      ? { nodeType: 3, textContent: ch, parentNode: el }
      : ch;
    childNode.parentNode = el;
    el.childNodes.push(childNode);
  }
  return el;
}

function createSharedMockIndexedDB() {
  const stores = {
    conversations: new Map(),
    metadata_index: new Map(),
    collections: new Map(),
    transfers: new Map(),
    jobs: new Map(),
    diagnostics: new Map()
  };
  const keyPaths = {
    conversations: 'canonicalId',
    metadata_index: 'canonicalId',
    collections: 'collectionId',
    transfers: 'transferId',
    jobs: 'jobId',
    diagnostics: 'id'
  };

  let txQueue = Promise.resolve();

  const makeStoreNames = () => ({
    contains: (name) => Object.prototype.hasOwnProperty.call(stores, name)
  });

  const dbConn = {
    objectStoreNames: makeStoreNames(),
    close() {},
    transaction(names, _mode) {
      const storeList = Array.isArray(names) ? names : [names];
      const tx = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        _aborted: false,
        abort() {
          if (tx._aborted) return;
          tx._aborted = true;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name) {
          if (!storeList.includes(name)) throw new Error(`Unknown store ${name}`);
          const backing = stores[name];
          const kp = keyPaths[name];
          return {
            get(key) {
              const req = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (tx._aborted) return;
                const val = backing.get(key);
                req.result = val !== undefined ? structuredClone(val) : undefined;
                req.onsuccess?.({ target: req });
              });
              return req;
            },
            put(val) {
              const req = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (tx._aborted) return;
                const cloned = structuredClone(val);
                backing.set(cloned[kp], cloned);
                req.result = cloned[kp];
                req.onsuccess?.({ target: req });
              });
              return req;
            },
            clear() {
              const req = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (tx._aborted) return;
                backing.clear();
                req.onsuccess?.({ target: req });
              });
              return req;
            }
          };
        }
      };
      // Simulate IDB transaction completion after microtasks flush cleanly
      txQueue = txQueue.then(() => new Promise(resolve => {
        setTimeout(() => {
          if (!tx._aborted) tx.oncomplete?.();
          resolve();
        }, 12);
      }));
      return tx;
    }
  };

  return {
    stores,
    indexedDB: {
      open() {
        const req = { result: dbConn, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        queueMicrotask(() => {
          req.onupgradeneeded?.({ target: req });
          req.onsuccess?.({ target: req });
        });
        return req;
      }
    }
  };
}

function createWorkspaceHarness({ db, tabsQueryFn, sendMessageFn }) {
  const clickHandlers = new Map();
  const makeElem = (id) => ({
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    style: {},
    disabled: false,
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      toggle(c, f) { if (f === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (f) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    addEventListener(ev, fn) {
      if (ev === 'click') clickHandlers.set(id, fn);
    },
    removeEventListener() {},
    focus() {},
    click() {
      if (typeof elems.get(id)?.onclick === 'function') return elems.get(id).onclick({ target: elems.get(id) });
      return clickHandlers.get(id)?.({ target: elems.get(id) });
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    appendChild() {},
    removeChild() {},
    setAttribute() {}
  });
  const elems = new Map();
  const getEl = (id) => {
    if (!elems.has(id)) elems.set(id, makeElem(id));
    return elems.get(id);
  };
  let domLoadedCb = null;

  const engineMod = require('../../extension/src/core/jobs/job_engine');
  class FastJobEngine extends engineMod.JobEngine {
    constructor(opts = {}) {
      super({ ...opts, maxRetries: 0, itemPacingMs: 5 });
    }
  }

  const trackedTimeout = (fn, ms) => {
    const t = setTimeout(fn, ms);
    if (typeof t.unref === 'function') t.unref();
    return t;
  };
  const sandbox = {
    console,
    setTimeout: trackedTimeout,
    clearTimeout,
    URL,
    Blob,
    Intl,
    Map,
    Set,
    Promise,
    Error,
    Lossy: {
      JobEngine: FastJobEngine,
      MigrationPanel: function () { return { init() {}, refresh() {} }; }
    },
    Liner: { JobEngine: FastJobEngine },
    JobEngine: FastJobEngine,
    __LOSSY_DB__: db,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    document: {
      body: getEl('__body__'),
      documentElement: getEl('__docElement__'),
      getElementById: getEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => makeElem('_dyn'),
      addEventListener(ev, fn) {
        if (ev === 'DOMContentLoaded') domLoadedCb = fn;
      },
      removeEventListener() {}
    },
    window: {
      location: { href: 'chrome-extension://test/workspace.html', search: '' },
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      Lossy: null,
      Liner: null,
      __LOSSY_DB__: db
    },
    chrome: {
      tabs: {
        query: tabsQueryFn,
        sendMessage(tabId, message, cb) {
          Promise.resolve(sendMessageFn(tabId, message)).then(res => cb?.(res));
        },
        create: async () => ({})
      },
      scripting: { executeScript: async () => [] },
      runtime: { lastError: null, getURL: (p) => `chrome-extension://test/${p}` }
    }
  };
  sandbox.window.Lossy = sandbox.Lossy;
  sandbox.window.Liner = sandbox.Liner;
  sandbox.globalThis = sandbox;

  const code = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  // Expose internal capture/clear helpers gently for verification hooks inside the test VM only
  const instrumented = code.replace(
    'window.addEventListener(\'unhandledrejection\'',
    'globalThis.__TEST_HOOKS__ = { startBulkCapture: (...a) => startBulkCapture(...a), startSingleCapture: (...a) => startSingleCapture(...a), selectIds: (ids) => { selectedConversationIds.clear(); ids.forEach(i => selectedConversationIds.add(i)); }, getActiveEngine: () => activeJobEngine }; window.addEventListener(\'unhandledrejection\''
  );
  vm.runInNewContext(instrumented, sandbox);
  return {
    hooks: sandbox.__TEST_HOOKS__,
    triggerDomLoaded: () => domLoadedCb?.(),
    click: (id) => {
      const el = getEl(id);
      if (typeof el.onclick === 'function') return el.onclick({ target: el });
      return clickHandlers.get(id)?.({ target: el });
    },
    getEl
  };
}

test('R34 P1-1: captura en lote y simple rechaza respuesta de otro proveedor con UUID coincidente', async () => {
  const db = new LinerDB();
  const sharedUuid = 'same-uuid-1234';
  const claudeCanonicalId = `conv_claude_${sharedUuid}`;
  await db.saveConversation({
    canonicalId: claudeCanonicalId,
    title: 'Original de Claude',
    source: { platform: 'claude', conversationId: sharedUuid, url: `https://claude.ai/chat/${sharedUuid}` },
    messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: 'Contenido original de Claude', content: { text: 'Contenido original de Claude' } }],
    integrity: { status: 'captured' }
  });

  const harness = createWorkspaceHarness({
    db,
    tabsQueryFn: async () => [{ id: 77, url: `https://claude.ai/chat/${sharedUuid}` }],
    sendMessageFn: async () => ({
      success: true,
      data: {
        canonicalId: `conv_chatgpt_${sharedUuid}`,
        title: 'Contaminado desde ChatGPT',
        source: { platform: 'chatgpt', conversationId: sharedUuid, url: `https://chatgpt.com/c/${sharedUuid}` },
        messages: [{ id: 'x1', role: 'assistant', isConversational: true, text: 'Datos mezclados de ChatGPT', content: { text: 'Datos mezclados de ChatGPT' } }],
        integrity: { status: 'captured' }
      }
    })
  });

  harness.hooks.selectIds([claudeCanonicalId]);
  await harness.hooks.startBulkCapture();

  const stored = await db.getConversation(claudeCanonicalId);
  assert.equal(stored.source.platform, 'claude');
  assert.equal(stored.messages[0].text, 'Contenido original de Claude');

  const activeJob = harness.hooks.getActiveEngine().activeJob;
  assert.equal(activeJob.items[0].status, ITEM_STATUS.FAILED);
  assert.match(activeJob.items[0].error, /SOURCE_IDENTITY_MISMATCH/);

  // También verifica defensa directa ante cruce de plataforma o de conversationId con mismo canonicalId
  await assert.rejects(
    db.saveConversation({
      canonicalId: claudeCanonicalId,
      title: 'Inyección directa cross-platform',
      source: { platform: 'chatgpt', conversationId: sharedUuid },
      messages: [{ id: 'x2', role: 'assistant', text: 'Inyectado' }]
    }),
    /SOURCE_IDENTITY_MISMATCH/
  );
  await assert.rejects(
    db.saveConversation({
      canonicalId: claudeCanonicalId,
      title: 'Inyección directa mismo proveedor distinta conv',
      source: { platform: 'claude', conversationId: 'other-uuid-9999' },
      messages: [{ id: 'x3', role: 'assistant', text: 'Mezclado' }]
    }),
    /SOURCE_IDENTITY_MISMATCH/
  );
  await assert.rejects(
    db.saveConversation({
      canonicalId: claudeCanonicalId,
      title: 'Inyección por URL B con conversationId A',
      source: { platform: 'claude', conversationId: sharedUuid, url: 'https://claude.ai/chat/other-B' },
      messages: [{ id: 'x3b', role: 'assistant', text: 'Mezclado B' }]
    }),
    /SOURCE_IDENTITY_MISMATCH/
  );
  await assert.rejects(
    db.saveConversation({
      canonicalId: claudeCanonicalId,
      title: 'Inyección host ChatGPT bajo plataforma Claude',
      source: { platform: 'claude', conversationId: sharedUuid, url: `https://chatgpt.com/c/${sharedUuid}` },
      messages: [{ id: 'x3c', role: 'assistant', text: 'Mezclado host' }]
    }),
    /SOURCE_IDENTITY_MISMATCH/
  );
  const afterDirectSave = await db.getConversation(claudeCanonicalId);
  assert.equal(afterDirectSave.source.platform, 'claude');
  assert.equal(afterDirectSave.messages[0].text, 'Contenido original de Claude');

  // También verifica rechazo cuando la respuesta omite canonicalId o usa host chat.openai.com/example.org/URL B
  for (const badResp of [
    { title: 'Sin canonicalId', source: { platform: 'claude', conversationId: sharedUuid, url: `https://claude.ai/chat/${sharedUuid}` } },
    { canonicalId: claudeCanonicalId, title: 'Host chat.openai', source: { platform: 'claude', conversationId: sharedUuid, url: `https://chat.openai.com/c/${sharedUuid}` } },
    { canonicalId: claudeCanonicalId, title: 'Host example.org', source: { platform: 'claude', conversationId: sharedUuid, url: `https://example.org/c/${sharedUuid}` } },
    { canonicalId: claudeCanonicalId, title: 'URL Claude de B', source: { platform: 'claude', conversationId: sharedUuid, url: 'https://claude.ai/chat/other-B-999' } }
  ]) {
    const h = createWorkspaceHarness({
      db,
      tabsQueryFn: async () => [{ id: 88, url: `https://claude.ai/chat/${sharedUuid}` }],
      sendMessageFn: async () => ({
        success: true,
        data: { ...badResp, messages: [{ id: 'x4', role: 'assistant', isConversational: true, text: 'Rechazar' }] }
      })
    });
    h.hooks.selectIds([claudeCanonicalId]);
    await h.hooks.startBulkCapture();
    assert.equal(h.hooks.getActiveEngine().activeJob.items[0].status, ITEM_STATUS.FAILED);
    assert.match(h.hooks.getActiveEngine().activeJob.items[0].error, /SOURCE_IDENTITY_MISMATCH/);
  }
});

test('R34 P1-2: Eliminar todo no lanza ReferenceError y otra instancia IndexedDB no reintroduce datos tras clearAll()', async () => {
  const { indexedDB, stores } = createSharedMockIndexedDB();
  const dbPrimary = new LinerDB(indexedDB);
  const dbOtherInstance = new LinerDB(indexedDB);
  await dbPrimary.open();
  await dbOtherInstance.open();

  await dbPrimary.saveConversation({
    canonicalId: 'conv_sensitive',
    title: 'Dato sensible',
    source: { platform: 'chatgpt', conversationId: 'conv_sensitive' },
    messages: [{ id: 'm1', role: 'user', content: { text: 'Secreto antes de borrar' } }]
  });

  // 1. Verificar ausencia de ReferenceError en botón "Eliminar todo" de workspace.js
  const harness = createWorkspaceHarness({
    db: dbPrimary,
    tabsQueryFn: async () => [],
    sendMessageFn: async () => ({ success: true })
  });
  harness.triggerDomLoaded();
  const clearClickPromise = harness.click('btn-clear-db');
  await new Promise(r => setTimeout(r, 15));
  await harness.click('app-modal-confirm');
  await clearClickPromise;
  assert.equal(stores.conversations.size, 0);

  // 2. Escritura concurrente desde otra instancia LinerDB sobre el mismo IndexedDB mientras clearAll() ejecuta
  const preWipePromise = dbOtherInstance.saveConversation({
    canonicalId: 'conv_race_other_instance',
    title: 'Reintroducción ilícita',
    source: { platform: 'claude', conversationId: 'r1' },
    messages: [{ id: 'm1', role: 'assistant', content: { text: 'No debe sobrevivir al borrado' } }]
  });
  const clearPromise = dbPrimary.clearAll();

  await assert.rejects(preWipePromise, /WRITE_ABORTED_BY_CLEAR_ALL/);
  await clearPromise;

  assert.equal(stores.conversations.size, 0);
  assert.equal(stores.metadata_index.size, 0);
  assert.ok(stores.diagnostics.get('__lossy_wipe_epoch__')?.epoch >= 2);

  // 3. Simula adquisición desde popup que captura snapshot antes de clearAll() y crea otra instancia nueva LinerDB al recibir respuesta
  const dbPopupStart = new LinerDB(indexedDB);
  const snapAtStart = await dbPopupStart.captureWipeSnapshot();
  await dbPrimary.clearAll();
  const dbPopupFreshSave = new LinerDB(indexedDB);
  await assert.rejects(
    dbPopupFreshSave.saveConversation({
      canonicalId: 'conv_popup_after_wipe',
      title: 'Fuga desde nueva instancia popup',
      source: { platform: 'claude', conversationId: 'pop1' },
      messages: [{ id: 'p1', role: 'assistant', content: { text: 'No debe sobrevivir' } }]
    }, { expectedIdbWipeEpoch: snapAtStart.idbWipeEpoch }),
    /WRITE_ABORTED_BY_CLEAR_ALL/
  );
  assert.equal(stores.conversations.size, 0);

  // 4. Una captura posterior legítima sí persiste limpiamente
  await dbOtherInstance.saveConversation({
    canonicalId: 'conv_fresh_after_wipe',
    title: 'Nueva conversación legítima',
    source: { platform: 'claude', conversationId: 'fresh1' },
    messages: [{ id: 'm1', role: 'user', content: { text: 'Válida tras limpieza' } }]
  });
  assert.equal((await dbPrimary.getConversation('conv_fresh_after_wipe'))?.title, 'Nueva conversación legítima');
});

test('R34 P1-3: primera captura tras navegación SPA A->B en Claude y Gemini rechaza DOM anterior de A', async () => {
  for (const spec of [
    {
      platform: 'claude',
      urlA: 'https://claude.ai/chat/11111111-1111-1111-1111-111111111111',
      urlB: 'https://claude.ai/chat/22222222-2222-2222-2222-222222222222',
      regex: /\/chat\/([a-f0-9-]+)/i
    },
    {
      platform: 'gemini',
      urlA: 'https://gemini.google.com/app/aaaaaaaaaaaa',
      urlB: 'https://gemini.google.com/app/bbbbbbbbbbbb',
      regex: /\/app\/([a-z0-9]+)/i
    }
  ]) {
    const listeners = [];
    let currentHref = spec.urlA;
    let domText = `Mensaje confidencial exclusivo de A (${spec.platform})`;

    const adapter = {
      detectPlatform(u) {
        const m = String(u || '').match(spec.regex);
        return m ? { platform: spec.platform, conversationId: m[1] } : null;
      },
      extractClaudeDom(_doc, u) {
        const m = String(u || '').match(spec.regex);
        return {
          canonicalId: `conv_${spec.platform}_${m[1]}`,
          title: spec.platform,
          source: { platform: spec.platform, conversationId: m[1], url: u },
          messages: [{ id: 'm1', role: 'assistant', isConversational: true, text: domText, content: { text: domText }, attachments: [] }],
          attachments: []
        };
      },
      extractGeminiDom(_doc, u) { return this.extractClaudeDom(_doc, u); }
    };

    const historyObj = {
      pushState(_state, _title, nextUrl) { currentHref = nextUrl; },
      replaceState(_state, _title, nextUrl) { currentHref = nextUrl; }
    };

    const sandbox = {
      window: {
        location: { get href() { return currentHref; } },
        addEventListener() {}
      },
      history: historyObj,
      document: {
        querySelector: () => null,
        body: {}
      },
      chrome: {
        runtime: {
          id: 'test-ext',
          onMessage: { addListener(fn) { listeners.push(fn); } }
        }
      },
      globalThis: null,
      Lossy: { MultiPlatform: adapter },
      AbortController,
      setTimeout,
      clearTimeout
    };
    sandbox.globalThis = sandbox;

    const code = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/multi_platform_content.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    const callMsg = msg => new Promise(resolve => {
      listeners[0](msg, { id: 'test-ext' }, resolve);
    });

    // SIN captura previa en A, navegar SPA A -> B dejando el DOM de A (o actualización parcial de A)
    historyObj.pushState({}, '', spec.urlB);
    const firstCaptureOnB = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(firstCaptureOnB.success, false, `${spec.platform}: la primera captura tras A->B debe rechazar DOM obsoleto`);
    assert.match(firstCaptureOnB.error, /STALE_DOM/);

    // Retirar solo el prefijo "Mensaje " del turno antiguo de A -> sufijo residual sigue rechazándose como obsoleto
    domText = `confidencial exclusivo de A (${spec.platform})`;
    const suffixOnlyA = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(suffixOnlyA.success, false, `${spec.platform}: sufijo sin prefijo de A no puede pasar por B`);
    assert.match(suffixOnlyA.error, /STALE_DOM/);

    // Navegación A -> B -> C sin capturar nunca: DOM se actualiza en B y luego salta a C dejando contenido de B
    domText = `Contenido real pero exclusivo de B (${spec.platform})`;
    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '3').replace(/bbbbbbbbbbbb/, 'cccccccccccc'));
    const skippedBtoC = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(skippedBtoC.success, false, `${spec.platform}: A->B->C sin captura previa no puede aceptar contenido de B como C`);
    assert.match(skippedBtoC.error, /STALE_DOM/);

    // Cuando el DOM sí converge al nuevo contenido de C en ~160ms
    setTimeout(() => { domText = `Contenido fresco de C (${spec.platform})`; }, 160);
    const converged = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(converged.success, true);
    assert.equal(converged.data.messages[0].text, `Contenido fresco de C (${spec.platform})`);

    // Caso sin falso positivo: conversación D comparte la misma pregunta de usuario que C pero con respuesta propia distinta
    const sharedPrompt = 'Explica brevemente qué es un árbol B en bases de datos';
    let multiTurns = [
      { id: 'u1', role: 'user', text: sharedPrompt },
      { id: 'a1', role: 'assistant', text: 'Respuesta única de C sobre discos.' }
    ];
    adapter.extractClaudeDom = (_doc, u) => {
      const m = String(u || '').match(spec.regex);
      return {
        canonicalId: `conv_${spec.platform}_${m[1]}`,
        title: spec.platform,
        source: { platform: spec.platform, conversationId: m[1], url: u },
        messages: multiTurns.map(t => ({ ...t, isConversational: true, content: { text: t.text }, attachments: [] })),
        attachments: []
      };
    };
    const capC = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(capC.success, true);

    // Contrario P1 R36: pregunta nueva de D acompañada de respuesta residual de C debe rechazarse como obsoleta
    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '4').replace(/bbbbbbbbbbbb/, 'dddddddddddd'));
    multiTurns = [
      { id: 'u1d_new', role: 'user', text: 'Pregunta completamente nueva de D sobre índices' },
      { id: 'a1c_stale', role: 'assistant', text: 'Respuesta única de C sobre discos.' }
    ];
    const staleAnswerUnderNewQuestion = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleAnswerUnderNewQuestion.success, false, `${spec.platform}: respuesta obsoleta de C con pregunta nueva de D debe rechazarse`);
    assert.match(staleAnswerUnderNewQuestion.error, /STALE_DOM/);

    // Caso sin falso positivo: conversación E comparte la misma pregunta de usuario que C pero con respuesta propia distinta
    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '5').replace(/bbbbbbbbbbbb/, 'eeeeeeeeeeee'));
    multiTurns = [
      { id: 'u1e', role: 'user', text: sharedPrompt },
      { id: 'a1e', role: 'assistant', text: 'Respuesta completamente nueva de E sobre Postgres.' }
    ];
    const capE = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(capE.success, true, `${spec.platform}: pregunta compartida con respuesta distinta no debe bloquearse`);
    assert.match(capE.data.messages[1].text, /Postgres/);

    // R37 P1: respuesta breve (5 chars "73129") e imagen exclusiva obsoleta con pregunta nueva deben rechazarse
    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '6').replace(/bbbbbbbbbbbb/, 'ffffffffffff'));
    multiTurns = [
      { id: 'u1f', role: 'user', text: 'Elige una capital europea' },
      { id: 'a1f', role: 'assistant', text: '73129' }
    ];
    assert.equal((await callMsg({ action: 'ACQUIRE_CONVERSATION' })).success, true);

    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '7').replace(/bbbbbbbbbbbb/, 'gggggggggggg'));
    multiTurns = [
      { id: 'u1g', role: 'user', text: 'Pregunta completamente distinta' },
      { id: 'a1g_stale', role: 'assistant', text: '73129' }
    ];
    const staleShort = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleShort.success, false, `${spec.platform}: respuesta breve obsoleta (73129) debe rechazarse`);
    assert.match(staleShort.error, /STALE_DOM/);

    // R37 P2: pregunta repetida + respuesta breve nueva ("Roma") debe aceptarse
    setTimeout(() => {
      multiTurns = [
        { id: 'u1g_ok', role: 'user', text: 'Elige una capital europea' },
        { id: 'a1g_ok', role: 'assistant', text: 'Roma' }
      ];
    }, 120);
    const shortFresh = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(shortFresh.success, true, `${spec.platform}: respuesta breve nueva (Roma) con pregunta compartida no debe bloquearse`);
    assert.equal(shortFresh.data.messages[1].text, 'Roma');

    // R37 P1/P2 imágenes exclusivas sin texto: imagen obsoleta rechaza, imagen nueva acepta
    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '8').replace(/bbbbbbbbbbbb/, 'hhhhhhhhhhhh'));
    multiTurns = [
      { id: 'u1img', role: 'user', text: 'Genera gráfico', attachments: [] },
      { id: 'a1img', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/paris.png' }] }
    ];
    adapter.extractClaudeDom = (_doc, u) => {
      const m = String(u || '').match(spec.regex);
      return {
        canonicalId: `conv_${spec.platform}_${m[1]}`,
        title: spec.platform,
        source: { platform: spec.platform, conversationId: m[1], url: u },
        messages: multiTurns.map(t => ({ ...t, isConversational: true, content: { text: t.text, attachments: t.attachments || [] }, attachments: t.attachments || [] })),
        attachments: []
      };
    };
    assert.equal((await callMsg({ action: 'ACQUIRE_CONVERSATION' })).success, true);

    historyObj.pushState({}, '', spec.urlB.replace(/2|b/g, '9').replace(/bbbbbbbbbbbb/, 'iiiiiiiiiiii'));
    multiTurns = [
      { id: 'u2img', role: 'user', text: 'Genera gráfico nuevo', attachments: [] },
      { id: 'a2img_stale', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/paris.png' }] }
    ];
    const staleImgOnly = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleImgOnly.success, false, `${spec.platform}: imagen obsoleta exclusiva sin texto debe rechazarse`);
    assert.match(staleImgOnly.error, /STALE_DOM/);

    setTimeout(() => {
      multiTurns = [
        { id: 'u2img_ok', role: 'user', text: 'Genera gráfico', attachments: [] },
        { id: 'a2img_ok', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/roma.png' }] }
      ];
    }, 120);
    const freshImgOnly = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(freshImgOnly.success, true, `${spec.platform}: imagen nueva exclusiva sin texto debe aceptarse`);
    assert.equal(freshImgOnly.data.messages[1].attachments[0].sourceURL, 'https://cdn.test/roma.png');

    const makeCustomUrl = (hexTag) => spec.urlB.replace(/(?:22222222-2222-2222-2222-222222222222|bbbbbbbbbbbb)/, hexTag);
    // R38 & R39 P1/P2: PNG válidos decodificables rojo vs azul con igual prefijo (64+ chars) y longitud
    const redDataUri = makeSolidPngDataUri(255, 0, 0);
    const blueDataUri = makeSolidPngDataUri(0, 0, 255);
    assert.equal(redDataUri.length, blueDataUri.length);
    assert.equal(redDataUri.slice(0, 64), blueDataUri.slice(0, 64));

    historyObj.pushState({}, '', makeCustomUrl('deadbeef0001'));
    multiTurns = [
      { id: 'u_col', role: 'user', text: 'Genera cuadrado de color', attachments: [] },
      { id: 'a_red', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/pixel.png?w=512', dataURI: redDataUri }] }
    ];
    assert.equal((await callMsg({ action: 'ACQUIRE_CONVERSATION' })).success, true);

    // P1 R38/R39: Misma imagen DataURI anterior pero URL mutada (?w=512 -> ?w=1024) y pregunta nueva -> RECHAZA STALE
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0002'));
    multiTurns = [
      { id: 'u_w1024', role: 'user', text: 'Otra pregunta totalmente distinta', attachments: [] },
      { id: 'a_red_reurl', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/pixel.png?w=1024', dataURI: redDataUri }] }
    ];
    const staleRehostedImg = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleRehostedImg.success, false, `${spec.platform}: misma imagen DataURI con query URL distinto debe rechazarse`);
    assert.match(staleRehostedImg.error, /STALE_DOM/);

    // P2 R38: Imagen nueva azul con igual longitud y prefijo 64-char bajo pregunta repetida -> ACEPTA
    setTimeout(() => {
      multiTurns = [
        { id: 'u_col_blue', role: 'user', text: 'Genera cuadrado de color', attachments: [] },
        { id: 'a_blue', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/pixel.png?w=512', dataURI: blueDataUri }] }
      ];
    }, 120);
    const freshBlueImg = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(freshBlueImg.success, true, `${spec.platform}: PNG distinto con igual prefijo/longitud no debe colisionar`);
    assert.equal(freshBlueImg.data.messages[1].attachments[0].dataURI, blueDataUri);

    // P2 R39: Reutilización legítima de la misma imagen (mismos bytes) con pregunta Y respuesta textual nuevas -> ACEPTA
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0003'));
    multiTurns = [
      { id: 'u_reuse_legit', role: 'user', text: 'Haz un nuevo análisis cromático de esta textura azul', attachments: [] },
      { id: 'a_reuse_legit', role: 'assistant', text: 'Análisis completamente nuevo y válido de D.', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/mirror/blue_copy.png', dataURI: blueDataUri }] }
    ];
    const legitReuse = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(legitReuse.success, true, `${spec.platform}: pregunta y respuesta textual nuevas que reutilizan la imagen deben aceptarse`);

    // P1/P2 R40: URL mutable (C sirve verde, luego cambia a amarillo) + CORS bloqueado (?w=512 -> ?w=1024) sin fetch histórico ni caché obsoleta
    const greenDataUri = makeSolidPngDataUri(0, 255, 0);
    const yellowDataUri = makeSolidPngDataUri(255, 255, 0);
    const greenPngBytes = Buffer.from(greenDataUri.split(',')[1], 'base64');
    const yellowPngBytes = Buffer.from(yellowDataUri.split(',')[1], 'base64');
    let mutablePixelMode = 'green';
    let corsBlockActive = false;
    let fetchCalls = 0;
    sandbox.fetch = async (reqUrl) => {
      fetchCalls++;
      if (corsBlockActive) return { ok: false, status: 403 };
      if (String(reqUrl).includes('mutable_pixel.png')) {
        const bytes = mutablePixelMode === 'green' ? greenPngBytes : yellowPngBytes;
        return {
          ok: true,
          headers: { get: () => String(bytes.length) },
          blob: async () => new Blob([bytes], { type: 'image/png' })
        };
      }
      if (String(reqUrl).includes('unreachable_')) {
        throw new Error('Network unreachable');
      }
      return { ok: false, status: 404 };
    };
    sandbox.FileReader = class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then(ab => {
          this.result = `data:${blob.type};base64,${Buffer.from(ab).toString('base64')}`;
          this.onloadend?.();
        });
      }
    };

    // 1. Capturar C cuando mutable_pixel.png?w=512 sirve VERDE
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0004'));
    mutablePixelMode = 'green';
    multiTurns = [
      { id: 'u_mut_c', role: 'user', text: 'Imagen mutable C', attachments: [] },
      { id: 'a_mut_c', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/mutable_pixel.png?w=512' }] }
    ];
    const capMutC = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(capMutC.success, true);

    // 2. En D el servidor ahora devuelve AMARILLO en la MISMA URL (?w=512): no debe rechazarse por caché previa y debe conservar C=VERDE
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0005'));
    mutablePixelMode = 'yellow';
    multiTurns = [
      { id: 'u_mut_d', role: 'user', text: 'Imagen mutable D nueva', attachments: [] },
      { id: 'a_mut_d', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/mutable_pixel.png?w=512' }] }
    ];
    const capMutD = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(capMutD.success, true, `${spec.platform}: URL mutable con bytes nuevos (amarillo) debe descargarse y aceptarse`);
    assert.equal(capMutD.data.messages[1].attachments[0].dataURI, yellowDataUri);

    // 3. En E reaparece VERDE residual con ?w=1024 -> sigue detectando C=VERDE intacto (no sobreescrito por D=AMARILLO) y RECHAZA STALE
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0006'));
    mutablePixelMode = 'green';
    multiTurns = [
      { id: 'u_mut_e', role: 'user', text: 'Pregunta E distinta', attachments: [] },
      { id: 'a_mut_e_stale', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/mutable_pixel.png?w=1024' }] }
    ];
    const staleMutE = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleMutE.success, false, `${spec.platform}: imagen verde residual histórica debe seguir rechazándose sin contaminarse por D`);
    assert.match(staleMutE.error, /STALE_DOM/);

    // 4. Si CORS/403 impide descargar ?w=512 en F y en G solo muta ?w=1024 bajo 403, falla en cerrado (STALE_DOM) sin re-descargar URLs antiguas
    corsBlockActive = true;
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0007'));
    multiTurns = [
      { id: 'u_cors_f', role: 'user', text: 'Pregunta F', attachments: [] },
      { id: 'a_cors_f', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/cors_403.png?w=512' }] }
    ];
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0008'));
    multiTurns = [
      { id: 'u_cors_g', role: 'user', text: 'Pregunta G', attachments: [] },
      { id: 'a_cors_g', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/cors_403.png?w=1024' }] }
    ];
    const staleCors403 = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(staleCors403.success, false, `${spec.platform}: adjunto bajo CORS/403 con query ?w mutada debe rechazarse en cerrado`);
    assert.match(staleCors403.error, /STALE_DOM/);

    // 5. No debe re-intentar descargas de URLs históricas inaccesibles de conversaciones anteriores al capturar otra válida
    corsBlockActive = false;
    fetchCalls = 0;
    const tBeforeUnreach = Date.now();
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0009'));
    multiTurns = [
      { id: 'u_h_dead', role: 'user', text: 'Cinco URLs muertas', attachments: [] },
      { id: 'a_h_dead', role: 'assistant', text: '', attachments: [1, 2, 3, 4, 5].map(k => ({ kind: 'image', sourceURL: `https://cdn.test/unreachable_${k}.png` })) }
    ];
    historyObj.pushState({}, '', makeCustomUrl('deadbeef0010'));
    multiTurns = [
      { id: 'u_h_fresh', role: 'user', text: 'Nueva conversación rápida', attachments: [] },
      { id: 'a_h_fresh', role: 'assistant', text: '', attachments: [{ kind: 'image', sourceURL: 'https://cdn.test/pixel.png?w=999', dataURI: makeSolidPngDataUri(0, 255, 255) }] }
    ];
    const fastFresh = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(fastFresh.success, true);
    assert.equal(fetchCalls, 0, 'No debe lanzar fetches hacia URLs históricas de conversaciones pasadas');
    assert.ok(Date.now() - tBeforeUnreach < 2000);
  }
});

test('R34 P1-4: content_script con montaje diferido de 400ms recoge exactamente 12 turnos sin duplicar a 16', async () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/content_script.js'), 'utf8');
  const allTurns = Array.from({ length: 12 }, (_, idx) => ({
    id: `m${idx}`,
    role: idx % 2 === 0 ? 'user' : 'assistant',
    text: `Turno real #${idx}`
  }));

  let visibleRange = [8, 12]; // El usuario comienza al final viendo los últimos 4 turnos [8..11]
  let pendingMountTimer = null;
  let internalScrollTop = 1600;

  const makeTurnNode = (t) => makeElement('div', {
    'data-message-author-role': t.role,
    'data-message-id': t.id
  }, [t.text]);

  let dynamicScrollHeight = 2400;
  let pendingHeightTimer = null;

  const container = {
    get scrollTop() { return internalScrollTop; },
    set scrollTop(val) {
      internalScrollTop = val;
      if (pendingHeightTimer) clearTimeout(pendingHeightTimer);
      if (pendingMountTimer) clearTimeout(pendingMountTimer);
      // Simula cambio temprano de altura (skeleton/espaciador a 50ms) seguido por montaje diferido de turnos a 400ms
      pendingHeightTimer = setTimeout(() => {
        dynamicScrollHeight = 2400 + (val > 0 ? 40 : 0);
      }, 50);
      if (typeof pendingHeightTimer.unref === 'function') pendingHeightTimer.unref();
      pendingMountTimer = setTimeout(() => {
        if (val < 300) visibleRange = [0, 4];
        else if (val < 700) visibleRange = [2, 6];
        else if (val < 1100) visibleRange = [4, 8];
        else if (val < 1500) visibleRange = [6, 10];
        else visibleRange = [8, 12];
      }, 400);
      if (typeof pendingMountTimer.unref === 'function') pendingMountTimer.unref();
    },
    get scrollHeight() { return dynamicScrollHeight; },
    clientHeight: 800,
    tagName: 'DIV',
    dataset: {},
    setAttribute() {}
  };

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { group() {}, log() {}, table() {}, groupEnd() {}, warn() {} },
    setTimeout,
    clearTimeout,
    document: {
      documentElement: { dataset: {} },
      body: makeElement('body'),
      createElement: (tag) => makeElement(tag),
      querySelector(sel) { return sel === '.thread-scroll-container' ? container : null; },
      querySelectorAll(sel) {
        if (sel === '[data-message-author-role]') {
          return allTurns.slice(visibleRange[0], visibleRange[1]).map(makeTurnNode);
        }
        return [];
      },
      createTextNode: (t) => ({ nodeType: 3, textContent: t })
    },
    window: {
      location: { href: 'https://chatgpt.com/c/virt_400ms', pathname: '/c/virt_400ms' },
      addEventListener() {}
    },
    globalThis: null
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);

  const res = await sandbox.module.exports.harvestAllConversationTurns('virt_400ms');
  if (pendingMountTimer) clearTimeout(pendingMountTimer);
  assert.equal(res.turns.length, 12, `Se esperaban exactamente 12 turnos y se obtuvieron ${res.turns.length}`);
  assert.deepEqual(Array.from(res.turns, t => t.id), allTurns.map(t => t.id));
  assert.equal(res.integrity, 'harvested');

  // También si el usuario ya scrolleó manualmente al tope (scrollTop === 0) y el montaje de 400ms sigue pendiente
  internalScrollTop = 0;
  visibleRange = [2, 6]; // Aún no monta m0/m1 hasta dentro de 400ms
  const lateTopTimer = setTimeout(() => { visibleRange = [0, 4]; }, 400);
  if (typeof lateTopTimer.unref === 'function') lateTopTimer.unref();
  const resAlreadyAtTop = await sandbox.module.exports.harvestAllConversationTurns('virt_400ms');
  clearTimeout(lateTopTimer);
  if (pendingMountTimer) clearTimeout(pendingMountTimer);
  assert.equal(resAlreadyAtTop.turns.length, 12, `Con scroll ya en top=0 también debe esperar montaje de 400ms (obtuvo ${resAlreadyAtTop.turns.length})`);
  assert.deepEqual(Array.from(resAlreadyAtTop.turns, t => t.id), allTurns.map(t => t.id));
});

test('R34 P2-Cap-4: messageDomText conserva jerarquía anidada bajo marcadores ordenados de varios dígitos', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/content_script.js'), 'utf8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createTextNode: (t) => ({ nodeType: 3, textContent: t }) },
    window: { location: { href: 'https://chatgpt.com/', pathname: '/' }, addEventListener() {} },
    globalThis: null
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);

  const domTree = makeElement('ol', { start: '10' }, [
    makeElement('li', {}, [
      makeElement('p', {}, ['Primer párrafo']),
      makeElement('p', {}, ['Segundo párrafo']),
      makeElement('ul', {}, [
        makeElement('li', {}, [
          'Sub A',
          makeElement('ol', { start: '100' }, [
            makeElement('li', {}, ['Sub cien'])
          ])
        ])
      ])
    ])
  ]);

  const mdText = sandbox.module.exports.messageDomText(domTree).trim();
  assert.match(mdText, /10\. Primer párrafo/);
  assert.match(mdText, /\n    Segundo párrafo/);
  assert.match(mdText, /\n    - Sub A/);
  assert.match(mdText, /\n      100\. Sub cien/);

  const md = new MarkdownIt({ html: false });
  const rendered = md.render(mdText);
  // Ambos párrafos y sublistas quedan estrictamente dentro de <ol start="10"> (cero bloques <pre> por falta de indentación)
  assert.equal(rendered.includes('<pre>'), false, 'No debe degradar la sublista a bloque de código indentado');
  assert.match(rendered, /<ol start="10">[\s\S]*Primer párrafo[\s\S]*Segundo párrafo[\s\S]*<ul>[\s\S]*<ol start="100">[\s\S]*Sub cien[\s\S]*<\/ol>[\s\S]*<\/ul>[\s\S]*<\/ol>/);
});

test('R34 P2-Exp-5: HtmlBuilder combina codeBlocks y content.codeBlocks sin omitir bloques cuando text ya tiene cercas', () => {
  const html = HtmlBuilder.buildStandaloneHtml({
    canonicalId: 'conv_html_cb',
    title: 'Bloques Mixtos',
    source: { platform: 'chatgpt' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      isConversational: true,
      codeBlocks: [
        { language: 'js', code: 'const enTexto = true;' }
      ],
      content: {
        text: 'Aquí hay código en texto:\n\n```js\nconst enTexto = true;\n```\n\nY otro aparte.',
        codeBlocks: [
          { language: 'js', code: 'const enTexto = true;' },
          { language: 'python', code: 'def bloque_separado():\n    return 2026' }
        ]
      }
    }]
  });

  const inlineOccurrences = html.match(/const enTexto = true;/g) || [];
  assert.equal(inlineOccurrences.length, 1, 'No debe duplicar el bloque ya presente en el Markdown');
  assert.ok(html.includes('def bloque_separado():'), 'Debe renderizar bloques en content.codeBlocks aunque msg.codeBlocks exista y ya haya una cerca en text');

  // También dentro de cita (> ```) o lista (- ```), no debe duplicar respecto a codeBlocks
  const htmlContainers = HtmlBuilder.buildStandaloneHtml({
    canonicalId: 'conv_html_container_cb',
    title: 'Bloques en Citas y Listas',
    source: { platform: 'chatgpt' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      isConversational: true,
      codeBlocks: [
        { language: 'js', code: 'const enCita = 1;' },
        { language: 'js', code: 'const enLista = 2;\n  const anidado = 3;' }
      ],
      content: {
        text: '> ```js\n> const enCita = 1;\n> ```\n\n- ```js\n  const enLista = 2;\n    const anidado = 3;\n  ```',
        codeBlocks: [
          { language: 'js', code: 'const enCita = 1;' },
          { language: 'js', code: 'const enLista = 2;\n  const anidado = 3;' }
        ]
      }
    }]
  });
  assert.equal((htmlContainers.match(/const enCita = 1;/g) || []).length, 1, 'No debe duplicar cerca dentro de blockquote');
  assert.equal((htmlContainers.match(/const enLista = 2;/g) || []).length, 1, 'No debe duplicar cerca dentro de lista');
});

test('R34 P2-UI-1 & Residual: startSingleCapture mantiene el trabajo running hasta terminar adquisición y bloquea solapamiento', async () => {
  const db = new LinerDB();
  const convId = 'conv_chatgpt_single_race';
  await db.saveConversation({
    canonicalId: convId,
    title: 'Single Capture Race',
    source: { platform: 'chatgpt', conversationId: 'single_race', url: 'https://chatgpt.com/c/single_race' },
    messages: [{ id: 'm1', role: 'user', text: 'Inicial' }]
  });

  let releaseRpc = null;
  let rpcCount = 0;
  const harness = createWorkspaceHarness({
    db,
    tabsQueryFn: async () => [{ id: 55, url: 'https://chatgpt.com/c/single_race' }],
    sendMessageFn: () => {
      rpcCount++;
      return new Promise(resolve => {
        releaseRpc = () => resolve({
          success: true,
          data: {
            canonicalId: convId,
            title: 'Single Capture Updated',
            source: { platform: 'chatgpt', conversationId: 'single_race', url: 'https://chatgpt.com/c/single_race' },
            messages: [{ id: 'm1', role: 'user', text: 'Inicial' }, { id: 'm2', role: 'assistant', text: 'Actualizado' }],
            integrity: { status: 'captured' }
          }
        });
      });
    }
  });

  const firstPromise = harness.hooks.startSingleCapture(convId);
  await new Promise(r => setTimeout(r, 25));
  assert.equal(harness.hooks.getActiveEngine().activeJob.status, JOB_STATUS.RUNNING, 'El trabajo debe permanecer RUNNING mientras la adquisición está en vuelo');

  // Segunda captura individual simultánea mientras la primera sigue esperando RPC debe bloquearse
  await harness.hooks.startSingleCapture(convId);
  assert.equal(rpcCount, 1, 'No debe lanzar dos adquisiciones individuales simultáneas');

  releaseRpc();
  await firstPromise;
  assert.equal(harness.hooks.getActiveEngine().activeJob.status, JOB_STATUS.COMPLETED);
  const updated = await db.getConversation(convId);
  assert.equal(updated.messages.length, 2);
});

test('R34 P2-UI-1: createJob bloquea ejecución concurrente sin sobrescribir activeJob ni marcar incompletos como COMPLETED', async () => {
  const db = new LinerDB();
  const engine = new JobEngine({ db, concurrency: 1, itemPacingMs: 15, maxRetries: 0 });
  const jobA = engine.createJob('BULK_ACQUISITION', [
    { id: 'item_1', title: 'Uno' },
    { id: 'item_2', title: 'Dos' }
  ]);

  const runPromise = engine.run(async (it) => {
    await new Promise(r => setTimeout(r, 35));
    return { id: it.id };
  });

  assert.throws(
    () => engine.createJob('BULK_ACQUISITION', [{ id: 'foreign', title: 'Ajeno' }]),
    /concurrente/i
  );
  assert.equal(engine.activeJob, jobA, 'activeJob no debe reemplazarse mientras Job A sigue ejecutándose');

  const finished = await runPromise;
  assert.equal(finished.status, JOB_STATUS.COMPLETED);
  assert.equal(finished.completedItems, 2);
  assert.ok(finished.items.every(it => it.status === ITEM_STATUS.STORED));
});

test('R42: LinerDB._runGuardedTx devuelve resultVal en IndexedDB real cuando resolveValue se omite', async () => {
  const { LinerDB } = require('../../extension/src/core/storage/liner_db.js');
  const stored = new Map();
  const fakeDb = {
    objectStoreNames: { contains: () => false },
    transaction() {
      const tx = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore() {
          return {
            put(val) {
              stored.set(val.collectionId || val.id, val);
              queueMicrotask(() => tx.oncomplete && tx.oncomplete());
              return {};
            }
          };
        }
      };
      return tx;
    }
  };
  const db = new LinerDB();
  db.useMemoryFallback = false;
  db.db = fakeDb;
  const col = await db.createCollection('Proyecto Real IDB', 'Descripción');
  assert.ok(col && typeof col.collectionId === 'string' && col.collectionId.startsWith('coll_'));
  assert.equal(col.name, 'Proyecto Real IDB');
  assert.equal(stored.get(col.collectionId).name, 'Proyecto Real IDB');
});

test('R43 P1: solicitudes SAVE_CLIP en cola antes de clearAll() se abortan y no reaparecen tras el borrado', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');

  let epoch = 0;
  let releaseFirstSave;
  let firstStartedResolve;
  const firstStarted = new Promise(r => { firstStartedResolve = r; });
  const savedClips = new Map();

  class FakeLinerDB {
    async open() { return this; }
    getWipeEpoch() { return epoch; }
    _resolveBaselineIdbEpoch(opts) { return opts && Number.isInteger(opts.expectedIdbWipeEpoch) ? opts.expectedIdbWipeEpoch : epoch; }
    async captureWipeSnapshot() { return { wipeEpoch: epoch, idbWipeEpoch: epoch }; }
    async saveClip(clip, opts = {}) {
      if (opts.expectedWipeEpoch !== epoch || opts.expectedIdbWipeEpoch < epoch) {
        throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      }
      if (clip.canonicalId === 'clip_1') {
        firstStartedResolve();
        await new Promise(r => { releaseFirstSave = r; });
      }
      if (opts.expectedWipeEpoch !== epoch || opts.expectedIdbWipeEpoch < epoch) {
        throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      }
      savedClips.set(clip.canonicalId, clip);
      return clip.canonicalId;
    }
    async clearAll() {
      epoch++;
      savedClips.clear();
      return true;
    }
  }

  let onMessageHandler = null;
  const sandbox = {
    console,
    Promise,
    importScripts: () => {},
    LinerDB: FakeLinerDB,
    chrome: {
      runtime: {
        id: 'test-ext-id',
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: fn => { onMessageHandler = fn; } },
        getURL: p => p
      },
      tabs: { create: () => {} }
    }
  };
  const swCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/background/service_worker.js'), 'utf8');
  vm.runInNewContext(swCode, sandbox);
  assert.ok(onMessageHandler);

  const sendSaveClip = id => new Promise(resolve => {
    onMessageHandler(
      { action: 'SAVE_CLIP', clip: { canonicalId: id, title: id, selectedMessages: [{ id: 'm1', role: 'user', content: { text: 'hola' } }] } },
      { id: 'test-ext-id' },
      resolve
    );
  });

  const pending = [];
  for (let i = 1; i <= 20; i++) pending.push(sendSaveClip(`clip_${i}`));
  await firstStarted;
  await new FakeLinerDB().clearAll();
  releaseFirstSave();
  const results = await Promise.all(pending);

  assert.equal(savedClips.size, 0, 'ningún clip encolado antes de clearAll() debe persistir después del borrado');
  assert.ok(results.every(r => r.success === false && /WRITE_ABORTED_BY_CLEAR_ALL/.test(r.error)));

  const afterWipe = await sendSaveClip('clip_after_wipe');
  assert.equal(afterWipe.success, true);
  assert.equal(savedClips.size, 1);
});

test('R43 P2: project_bundle rechaza content.citations no-array en importación y HtmlBuilder/MarkdownSerializer toleran citas malformadas', async () => {
  const ProjectBundle = require('../../extension/src/core/portability/project_bundle.js');
  const { createZip } = require('../../extension/src/core/portability/zip_builder.js');
  const cryptoUtil = require('../../extension/src/core/crypto_util.js');
  const HtmlBuilder = require('../../extension/src/core/portability/html_builder.js');
  const MarkdownSerializer = require('../../extension/src/core/markdown_serializer.js');

  const badConv = {
    canonicalId: 'conv_bad_cit',
    title: 'Citas inválidas',
    source: { platform: 'chatgpt' },
    messages: [{ id: 'm1', role: 'assistant', content: { text: 'Hola', citations: { url: 'https://example.com' } } }]
  };
  const projectJson = JSON.stringify({ version: '1.1', name: 'Proyecto Citas', sourceIds: ['conv_bad_cit'], sources: [{ canonicalId: 'conv_bad_cit', path: 'conversations/conv_bad_cit.json' }] });
  const convJson = JSON.stringify(badConv);
  const files = {
    'project.json': new TextEncoder().encode(projectJson),
    'conversations/conv_bad_cit.json': new TextEncoder().encode(convJson)
  };
  files['receipt.json'] = new TextEncoder().encode(JSON.stringify({
    fileHashes: {
      'project.json': cryptoUtil.sha256(files['project.json']),
      'conversations/conv_bad_cit.json': cryptoUtil.sha256(files['conversations/conv_bad_cit.json'])
    }
  }));

  await assert.rejects(
    () => ProjectBundle.readProjectPackage(createZip(files)),
    /citas inválida/i
  );

  const html = HtmlBuilder.buildStandaloneHtml(badConv);
  assert.match(html, /Citas inválidas/);
  const md = MarkdownSerializer.serializeToMarkdown(badConv);
  assert.match(md, /Citas inválidas/);
});

test('R44 P1: arranque frío sin notificaciones ni reloj monotónico aborta SAVE_CLIP encolados antes de clearAll()', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');

  let persistedEpoch = 0;
  let clock = 100000;
  const savedClips = new Map();

  class ColdLinerDB {
    constructor() {
      this._wipeEpoch = 0;
      this._knownIdbWipeEpoch = 0;
      this.db = null;
    }
    async open() {
      this.db = {};
      if (persistedEpoch > this._knownIdbWipeEpoch) this._knownIdbWipeEpoch = persistedEpoch;
      return this;
    }
    getWipeEpoch() { return this._wipeEpoch; }
    _resolveBaselineIdbEpoch(opts) {
      if (opts && Number.isInteger(opts.expectedIdbWipeEpoch)) return opts.expectedIdbWipeEpoch;
      return this._knownIdbWipeEpoch;
    }
    async saveClip(clip, opts = {}) {
      await this.open();
      const base = this._resolveBaselineIdbEpoch(opts);
      if (persistedEpoch > base) throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      savedClips.set(clip.canonicalId, clip);
      return clip.canonicalId;
    }
    async clearAll() {
      clock -= 60000; // retroceso de reloj de 60s
      persistedEpoch++;
      savedClips.clear();
      return true;
    }
  }

  let onMessageHandler = null;
  const sandbox = {
    console,
    Promise,
    Date: { now: () => clock },
    importScripts: () => {},
    LinerDB: ColdLinerDB,
    chrome: {
      runtime: {
        id: 'test-ext-id',
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: fn => { onMessageHandler = fn; } },
        getURL: p => p
      },
      tabs: { create: () => {} }
    }
  };
  const swCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/background/service_worker.js'), 'utf8');
  vm.runInNewContext(swCode, sandbox);

  const sendSaveClip = id => new Promise(resolve => {
    onMessageHandler(
      { action: 'SAVE_CLIP', clip: { canonicalId: id, title: id, selectedMessages: [{ id: 'm1', role: 'user', content: { text: 'x' } }] } },
      { id: 'test-ext-id' },
      resolve
    );
  });

  await Promise.resolve();
  await Promise.resolve();
  const pending = [];
  for (let i = 1; i <= 20; i++) pending.push(sendSaveClip(`clip_cold_${i}`));
  await new ColdLinerDB().clearAll();
  const results = await Promise.all(pending);

  assert.equal(savedClips.size, 0);
  assert.ok(results.every(r => r.success === false && /WRITE_ABORTED_BY_CLEAR_ALL/.test(r.error)));

  const after = await sendSaveClip('clip_after');
  assert.equal(after.success, true);
  assert.equal(savedClips.size, 1);
});

test('R46: borrado histórico antes de arranque frío no rechaza SAVE_CLIP enviado antes de terminar open()', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');

  const persistedEpoch = 2; // borrado histórico ya finalizado antes de iniciar el worker
  const savedClips = new Map();

  class HistoricalWipeLinerDB {
    constructor() {
      this._wipeEpoch = 0;
      this._knownIdbWipeEpoch = 0;
      this.db = null;
    }
    async open() {
      await new Promise(r => setTimeout(r, 15));
      this.db = {};
      if (persistedEpoch > this._knownIdbWipeEpoch) this._knownIdbWipeEpoch = persistedEpoch;
      return this;
    }
    getWipeEpoch() { return this._wipeEpoch; }
    _resolveBaselineIdbEpoch(opts) {
      if (opts && Number.isInteger(opts.expectedIdbWipeEpoch)) return opts.expectedIdbWipeEpoch;
      return this._knownIdbWipeEpoch;
    }
    async saveClip(clip, opts = {}) {
      await this.open();
      const base = this._resolveBaselineIdbEpoch(opts);
      if (persistedEpoch > base) throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      savedClips.set(clip.canonicalId, clip);
      return clip.canonicalId;
    }
  }

  let onMessageHandler = null;
  const sandbox = {
    console,
    Promise,
    importScripts: () => {},
    LinerDB: HistoricalWipeLinerDB,
    chrome: {
      runtime: {
        id: 'test-ext-id',
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: fn => { onMessageHandler = fn; } },
        getURL: p => p
      },
      tabs: { create: () => {} }
    }
  };
  const swCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/background/service_worker.js'), 'utf8');
  vm.runInNewContext(swCode, sandbox);

  // Enviar SAVE_CLIP inmediatamente antes de que open() termine
  const res = await new Promise(resolve => {
    onMessageHandler(
      { action: 'SAVE_CLIP', clip: { canonicalId: 'clip_hist_ok', title: 'Hist', selectedMessages: [{ id: 'm1', role: 'user', content: { text: 'hola' } }] } },
      { id: 'test-ext-id' },
      resolve
    );
  });
  assert.equal(res.success, true);
  assert.equal(savedClips.size, 1);
});
