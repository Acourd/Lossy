'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { LinerDB } = require('../../extension/src/core/storage/liner_db');
const { JobEngine, JOB_STATUS, ITEM_STATUS } = require('../../extension/src/core/jobs/job_engine');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const MarkdownIt = require('../../extension/vendor/markdown-it.min.js');

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

  // También verifica defensa directa en retainLocalCapture ante cruce de plataforma
  await db.saveConversation({
    canonicalId: claudeCanonicalId,
    title: 'Inyección directa cross-platform',
    source: { platform: 'chatgpt', conversationId: sharedUuid },
    messages: [{ id: 'x2', role: 'assistant', text: 'Inyectado' }]
  });
  const afterDirectSave = await db.getConversation(claudeCanonicalId);
  assert.equal(afterDirectSave.source.platform, 'claude');
  assert.equal(afterDirectSave.messages[0].text, 'Contenido original de Claude');
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

  // 3. Una captura posterior legítima sí persiste limpiamente
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

    // SIN captura previa en A, navegar SPA A -> B dejando el DOM de A
    historyObj.pushState({}, '', spec.urlB);
    const firstCaptureOnB = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(firstCaptureOnB.success, false, `${spec.platform}: la primera captura tras A->B debe rechazar DOM obsoleto`);
    assert.match(firstCaptureOnB.error, /STALE_DOM/);

    // Cuando el DOM sí converge al nuevo contenido de B en ~160ms tras navegar a otro chat
    setTimeout(() => { domText = `Contenido fresco de B (${spec.platform})`; }, 160);
    const converged = await callMsg({ action: 'ACQUIRE_CONVERSATION' });
    assert.equal(converged.success, true);
    assert.equal(converged.data.messages[0].text, `Contenido fresco de B (${spec.platform})`);
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

  const container = {
    get scrollTop() { return internalScrollTop; },
    set scrollTop(val) {
      internalScrollTop = val;
      if (pendingMountTimer) clearTimeout(pendingMountTimer);
      // Simula virtualización diferida de 400ms exactos tras cualquier salto de scroll
      pendingMountTimer = setTimeout(() => {
        if (val < 300) visibleRange = [0, 4];
        else if (val < 700) visibleRange = [2, 6];
        else if (val < 1100) visibleRange = [4, 8];
        else if (val < 1500) visibleRange = [6, 10];
        else visibleRange = [8, 12];
      }, 400);
      if (typeof pendingMountTimer.unref === 'function') pendingMountTimer.unref();
    },
    scrollHeight: 2400,
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
      'Elemento diez',
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
  assert.match(mdText, /10\. Elemento diez/);
  assert.match(mdText, /\n    - Sub A/);
  assert.match(mdText, /\n      100\. Sub cien/);

  const md = new MarkdownIt({ html: false });
  const rendered = md.render(mdText);
  // Debe haber un único <ol start="10"> que contenga <ul> y dentro <ol start="100"> sin salirse al nivel raíz
  assert.match(rendered, /<ol start="10">[\s\S]*<ul>[\s\S]*<ol start="100">[\s\S]*Sub cien[\s\S]*<\/ol>[\s\S]*<\/ul>[\s\S]*<\/ol>/);
});

test('R34 P2-Exp-5: HtmlBuilder incluye bloques separados en codeBlocks aunque texto ya contenga otra cerca de código', () => {
  const html = HtmlBuilder.buildStandaloneHtml({
    canonicalId: 'conv_html_cb',
    title: 'Bloques Mixtos',
    source: { platform: 'chatgpt' },
    messages: [{
      id: 'm1',
      role: 'assistant',
      isConversational: true,
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
  assert.ok(html.includes('def bloque_separado():'), 'Debe renderizar bloques separados en codeBlocks aunque ya exista una cerca en texto');
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
