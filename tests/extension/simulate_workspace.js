'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync('extension/src/workspace/workspace.html', 'utf8');
const scriptSrcs = [];
const regex = /<script src="([^"]+)"><\/script>/g;
let m;
while ((m = regex.exec(html)) !== null) {
  scriptSrcs.push(m[1]);
}
console.log('Script count:', scriptSrcs.length);

const domContext = {
  window: null,
  globalThis: null,
  addEventListener: () => {},
  console: console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Blob,
  URL
};
domContext.window = domContext;
domContext.globalThis = domContext;
domContext.document = {
  addEventListener: (ev, cb) => {
    if (ev === 'DOMContentLoaded') domContext._onDom = cb;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: (id) => {
    return {
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
      appendChild: () => {},
      dataset: {},
      style: {}
    };
  }
};
domContext.chrome = {
  runtime: { getURL: (p) => p, lastError: null },
  tabs: { query: async () => [], sendMessage: () => {} },
  storage: { local: { get: async () => ({}) } }
};

vm.createContext(domContext);

for (const src of scriptSrcs) {
  const file = path.resolve('extension/src/workspace', src);
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInContext(code, domContext, { filename: src });
    console.log('LOADED:', src);
  } catch (e) {
    console.error('ERROR in ' + src + ':', e);
  }
}

if (domContext._onDom) {
  try {
    domContext._onDom();
    console.log('DOMContentLoaded EXECUTED OK');

    // Simulate clicking Crear Clip on a conversation
    const conv = {
      canonicalId: 'conv_chatgpt_test',
      title: 'Conversación de prueba',
      source: { platform: 'chatgpt', conversationId: 'test' },
      messages: [
        { id: 'm1', role: 'user', content: { text: 'Hola' } },
        { id: 'm2', role: 'assistant', content: { text: 'Mundo' } }
      ]
    };
    // Call promptCreateClip
    // promptCreateClip is private to workspace.js IIFE, but showModal would be called
    console.log('Checking window.Lossy & Liner clipFactory:');
    console.log('window.Lossy.createCanonicalClip:', typeof domContext.Lossy.createCanonicalClip);
    console.log('window.Liner.createCanonicalClip:', typeof domContext.Liner.createCanonicalClip);
    console.log('window.Lossy.CanonicalModel.createCanonicalClip:', typeof domContext.Lossy?.CanonicalModel?.createCanonicalClip);
    console.log('window.Lossy.ClaudeTargetAdapter:', typeof domContext.Lossy.ClaudeTargetAdapter);
    console.log('window.Lossy.GenericTargetAdapter:', typeof domContext.Lossy.GenericTargetAdapter);
    console.log('window.Lossy.MarkdownBundleAdapter:', typeof domContext.Lossy.MarkdownBundleAdapter);
    console.log('window.Lossy.ZipBuilder:', typeof domContext.Lossy.ZipBuilder);
    console.log('window.Lossy.ManifestBuilder:', typeof domContext.Lossy.ManifestBuilder);
  } catch (e) {
    console.error('ERROR in DOMContentLoaded:', e);
  }
}
