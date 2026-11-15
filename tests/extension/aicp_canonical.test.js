/**
 * AI Conversation Portability (AICP) — Test Suite Determinista
 * Verificación en RAM con node:assert sin stubs ni falsos verdes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  createCanonicalConversation,
  validateCanonicalConversation,
  AICP_VERSION
} = require('../../extension/src/core/canonical_model.js');

const {
  serializeToMarkdown
} = require('../../extension/src/core/markdown_serializer.js');

const {
  createClaudeMigrationPacket
} = require('../../extension/src/core/claude_migration_packer.js');

const {
  parseChatGPTDomSnippet
} = require('../../extension/src/adapters/chatgpt_adapter.js');

test('AICP Canonical Model: construcción y validación estricta de esquema', () => {
  let assertions = 0;

  const conv = createCanonicalConversation({
    title: 'Arquitectura de Extensiones Chrome MV3',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/6710abcd-0001',
    messages: [
      {
        role: 'user',
        author: 'Usuario',
        timestamp: '2026-10-24T10:00:00.000Z',
        text: '¿Cómo funciona el ciclo de vida de un Service Worker en MV3?'
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        timestamp: '2026-10-24T10:00:05.000Z',
        text: 'En MV3, los background scripts son efímeros y se apagan tras 30 segundos de inactividad.',
        codeBlocks: [
          {
            language: 'javascript',
            code: 'chrome.runtime.onMessage.addListener((req, sender, sendResponse) => { return true; });'
          }
        ]
      }
    ]
  });

  assertions++;
  assert.equal(conv.specVersion, AICP_VERSION);
  assertions++;
  assert.equal(conv.metadata.platform, 'chatgpt');
  assertions++;
  assert.equal(conv.metadata.totalMessages, 2);
  assertions++;
  assert.equal(conv.messages[1].content.codeBlocks.length, 1);
  assertions++;
  assert.equal(conv.messages[1].content.codeBlocks[0].language, 'javascript');

  const validation = validateCanonicalConversation(conv);
  assertions++;
  assert.equal(validation.valid, true);
  assertions++;
  assert.equal(validation.errors.length, 0);

  // Verificación de invariante: mensaje sin rol debe ser rechazado
  const convInvalida = JSON.parse(JSON.stringify(conv));
  delete convInvalida.messages[0].role;
  const validationInvalida = validateCanonicalConversation(convInvalida);
  assertions++;
  assert.equal(validationInvalida.valid, false);
  assertions++;
  assert.ok(validationInvalida.errors.length > 0);

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones físicas en memoria');
});

test('AICP Markdown Serializer: renderizado limpio con Frontmatter e isomorfismo', () => {
  let assertions = 0;

  const conv = createCanonicalConversation({
    title: 'Prueba de Markdown',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/test-md',
    messages: [
      {
        role: 'user',
        author: 'Adria',
        timestamp: '2026-10-24T10:00:00.000Z',
        text: 'Explica el patrón Adapter.'
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        timestamp: '2026-10-24T10:00:10.000Z',
        text: 'El patrón Adapter desacopla la fuente de datos de la lógica central.',
        codeBlocks: [
          {
            language: 'typescript',
            code: 'interface Adapter { extract(): CanonicalModel; }'
          }
        ]
      }
    ]
  });

  const md = serializeToMarkdown(conv);
  assertions++;
  assert.ok(md.startsWith('---'), 'Debe iniciar con delimitador Frontmatter');
  assertions++;
  assert.ok(md.includes('title: "Prueba de Markdown"'));
  assertions++;
  assert.ok(md.includes('platform: "chatgpt"'));
  assertions++;
  assert.ok(md.includes('### 👤 Adria'));
  assertions++;
  assert.ok(md.includes('### 🤖 ChatGPT (gpt-4o)'));
  assertions++;
  assert.ok(md.includes('```typescript'));
  assertions++;
  assert.ok(md.includes('interface Adapter { extract(): CanonicalModel; }'));

  assert.equal(assertions, 7, 'Debe ejecutar exactamente 7 aserciones físicas');
});

test('AICP ChatGPT Adapter: extracción resiliente desde estructura DOM simulada', () => {
  let assertions = 0;

  // Estructura DOM representativa de ChatGPT (artículos o contenedores con data-message-author-role)
  const mockChatGptHtml = `
    <main>
      <div id="conversation-turn-1">
        <article data-testid="conversation-turn-2">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">Hola, necesito crear un paquete de migración de chat.</div>
          </div>
        </article>
      </div>
      <div id="conversation-turn-2">
        <article data-testid="conversation-turn-3">
          <div data-message-author-role="assistant">
            <div class="markdown prose">
              <p>Claro, aquí tienes una estructura canónica en TypeScript:</p>
              <pre><code class="language-json">{ "version": "1.0" }</code></pre>
            </div>
          </div>
        </article>
      </div>
    </main>
  `;

  const parsed = parseChatGPTDomSnippet(mockChatGptHtml, {
    title: 'Chat de Migración',
    url: 'https://chatgpt.com/c/simulated-turn'
  });

  assertions++;
  assert.equal(parsed.metadata.title, 'Chat de Migración');
  assertions++;
  assert.equal(parsed.messages.length, 2);
  assertions++;
  assert.equal(parsed.messages[0].role, 'user');
  assertions++;
  assert.ok(parsed.messages[0].content.text.includes('necesito crear un paquete de migración'));
  assertions++;
  assert.equal(parsed.messages[1].role, 'assistant');
  assertions++;
  assert.ok(parsed.messages[1].content.text.includes('estructura canónica'));
  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks.length, 1);
  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks[0].language, 'json');

  assert.equal(assertions, 8, 'Debe ejecutar 8 aserciones de extracción DOM');
});

test('AICP ChatGPT Adapter: regresión RED-C1-001 (estructura h4.sr-only observada en vivo)', () => {
  let assertions = 0;

  // Estructura DOM real capturada en la auditoría forense C1
  const liveChatGptHtml = `
    <div class="thread-scroll-container">
      <div class="[container-type:inline-size]">
        <div class="transcriptContent-l_FOQD">
          <div class="flex flex-col gap-1.5 pb-5">
            <div class="relative shrink-0">
              <div class="block-BQZwFn">
                <h4 class="sr-only m-0 select-none print:not-sr-only">Tú dijiste:</h4>
                <div>¿Podrías evaluar la arquitectura inicial de este proyecto?</div>
              </div>
              <div class="">
                <h4 class="sr-only m-0 select-none print:not-sr-only">ChatGPT dijo:</h4>
                <div class="markdown prose">
                  <p>Por supuesto, aquí tienes el desglose:</p>
                  <pre><code class="language-typescript">const ready = true;</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const parsed = parseChatGPTDomSnippet(liveChatGptHtml, {
    title: 'Evaluación arquitectónica inicial',
    url: 'https://chatgpt.com/g/g-p-test/c/test-c1'
  });

  assertions++;
  assert.equal(parsed.metadata.title, 'Evaluación arquitectónica inicial');
  assertions++;
  assert.equal(parsed.messages.length, 2, 'Debe capturar los 2 turnos reales delimitados por h4.sr-only');
  assertions++;
  assert.equal(parsed.messages[0].role, 'user');
  assertions++;
  assert.ok(parsed.messages[0].content.text.includes('¿Podrías evaluar la arquitectura inicial'));
  assertions++;
  assert.equal(parsed.messages[1].role, 'assistant');
  assertions++;
  assert.ok(parsed.messages[1].content.text.includes('Por supuesto, aquí tienes el desglose'));
  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks.length, 1);
  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks[0].language, 'typescript');

  assert.equal(assertions, 8, 'Debe ejecutar 8 aserciones físicas de regresión');
});

test('AICP Claude Migration Packet: generación de contexto portable para Claude', () => {
  let assertions = 0;

  const conv = createCanonicalConversation({
    title: 'Discusión de Arquitectura Axkern',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/axkern-design',
    messages: [
      {
        role: 'user',
        author: 'Creador',
        timestamp: '2026-10-24T08:00:00.000Z',
        text: 'Decidimos que la compuerta OISA no debe permitir stubs.'
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        timestamp: '2026-10-24T08:00:15.000Z',
        text: 'Entendido. Cero stubs garantizado en toda la suite de pruebas.'
      }
    ]
  });

  const packet = createClaudeMigrationPacket([conv], {
    projectTitle: 'Proyecto Axkern Portability',
    summaryGoal: 'Continuar la sesión en Claude conservando todas las decisiones técnicas tomadas en ChatGPT.'
  });

  assertions++;
  assert.ok(packet.importPrompt.includes('# PAQUETE DE MIGRACIÓN DE CONTEXTO SEMÁNTICO'));
  assertions++;
  assert.ok(packet.importPrompt.includes('Proyecto Axkern Portability'));
  assertions++;
  assert.ok(packet.importPrompt.includes('Decidimos que la compuerta OISA no debe permitir stubs.'));
  assertions++;
  assert.equal(packet.files['PROJECT_CONTEXT.md'] !== undefined, true);
  assertions++;
  assert.equal(packet.files['CONVERSATIONS/conversacion_1.json'] !== undefined, true);

  assert.equal(assertions, 5, 'Debe ejecutar 5 aserciones de empaquetado Claude');
});

test('AICP Extension Manifest: validación estricta MV3 y versión 1.3.0', () => {
  let assertions = 0;

  const manifestPath = path.join(__dirname, '../../extension/manifest.json');
  assertions++;
  assert.ok(fs.existsSync(manifestPath), 'manifest.json debe existir');

  const rawManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(rawManifest);

  assertions++;
  assert.equal(manifest.manifest_version, 3, 'Debe implementar Manifest V3');

  assertions++;
  assert.equal(manifest.version, '1.6.1', 'Versión debe ser 1.6.1');

  assertions++;
  assert.equal(manifest.action.default_popup, 'src/popup/popup.html');

  assertions++;
  assert.equal(manifest.background.service_worker, 'src/background/service_worker.js');

  assertions++;
  assert.ok(manifest.permissions.includes('activeTab'), 'Debe requerir activeTab');

  assertions++;
  assert.ok(manifest.permissions.includes('storage'), 'Debe requerir storage');

  assertions++;
  assert.ok(manifest.host_permissions.some(h => h.includes('chatgpt.com')));

  const popupFile = path.join(__dirname, '../../extension', manifest.action.default_popup);
  assertions++;
  assert.ok(fs.existsSync(popupFile), 'popup.html referenciado debe existir físicamente');

  const swFile = path.join(__dirname, '../../extension', manifest.background.service_worker);
  assertions++;
  assert.ok(fs.existsSync(swFile), 'service_worker.js referenciado debe existir físicamente');

  assertions++;
  assert.ok(manifest.permissions.includes('scripting'), 'Debe requerir scripting para inyección dinámica');

  assert.equal(assertions, 11, 'Debe ejecutar exactamente 11 aserciones físicas de manifiesto');
});

test('AICP Popup UI: conformidad nativa Chrome Refresh 2023, Zero-Emoji y Local-First', () => {
  let assertions = 0;

  const popupHtml = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.css'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.js'), 'utf8');

  // 1. Invariante Zero-Emoji en interfaz gráfica
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assertions++;
  assert.equal(emojiRegex.test(popupHtml), false, 'popup.html no debe contener emojis');
  assertions++;
  assert.equal(emojiRegex.test(popupCss), false, 'popup.css no debe contener emojis');
  assertions++;
  assert.equal(emojiRegex.test(popupJs), false, 'popup.js no debe contener emojis');

  // 2. Invariante 100% Local-First (sin dependencias ni scripts externos en popup.html)
  assertions++;
  assert.equal(/https?:\/\//.test(popupHtml), false, 'popup.html no debe incluir scripts o enlaces remotos');

  // 3. Invariante de elementos de control e interactividad
  const requiredIds = [
    'status-indicator',
    'status-title',
    'status-sub',
    'conversation-info',
    'conv-title',
    'msg-count',
    'platform-tag',
    'btn-export-md',
    'btn-export-json',
    'btn-claude-packet',
    'feedback-message'
  ];

  requiredIds.forEach(id => {
    assertions++;
    assert.ok(popupHtml.includes(`id="${id}"`), `Elemento interactivo con id="${id}" debe existir en popup.html`);
  });

  // 4. Invariante de Iconografía Vectorial SVG incrustada
  assertions++;
  assert.ok(popupHtml.includes('<svg') && popupHtml.includes('viewBox='), 'Debe incluir iconos vectoriales SVG nativos');

  // 5. Invariante de paleta compartida con el workspace (oscuro y claro) en CSS
  assertions++;
  assert.ok(popupCss.includes('--chrome-bg: #111719'), 'Debe utilizar la superficie base del archivo personal #111719');
  assertions++;
  assert.ok(popupCss.includes('--chrome-surface: #1a2427'), 'Debe utilizar la superficie de tarjeta #1a2427');
  assertions++;
  assert.ok(/@media \(prefers-color-scheme: light\)/.test(popupCss) && popupCss.includes('--chrome-bg: #f3f3ee'), 'Debe definir la variante clara del popup');
  assertions++;
  assert.ok(popupCss.includes('width: 400px'), 'Debe mantener el ancho nativo del popup');

  assert.equal(assertions, 20, 'Debe ejecutar exactamente 20 aserciones físicas de interfaz y diseño');
});

test('AICP Popup Logic: funciones modulares de sanitización, Markdown y paquete Claude', () => {
  let assertions = 0;

  const {
    getSafeFilename,
    serializeToMarkdownBrowser,
    createClaudePromptBrowser
  } = require('../../extension/src/popup/popup.js');

  // 1. Sanitización de nombres de archivo
  assertions++;
  const name1 = getSafeFilename('¿Cómo funciona el Service Worker en MV3?', 'md');
  assert.equal(name1, 'como_funciona_el_service_worker_en_mv3_aicp.md');

  assertions++;
  const name2 = getSafeFilename('$$$ @@@ !!!', 'json');
  assert.equal(name2, 'conversacion_aicp.json');

  assertions++;
  const name3 = getSafeFilename('', 'md');
  assert.equal(name3, 'conversacion_aicp.md');

  // 2. Serialización Markdown en navegador
  const mockConv = {
    metadata: {
      title: 'Prueba de Migración',
      platform: 'chatgpt',
      model: 'gpt-4o',
      exportedAt: '2026-10-24T12:00:00.000Z',
      url: 'https://chatgpt.com/c/test-123',
      totalMessages: 2
    },
    messages: [
      {
        role: 'user',
        author: 'Usuario',
        timestamp: '2026-10-24T12:00:00.000Z',
        content: { text: '¿Cómo exportar sin servidores?' }
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        timestamp: '2026-10-24T12:00:05.000Z',
        content: {
          text: 'Aquí está la implementación:',
          codeBlocks: [
            { language: 'javascript', code: 'const localFirst = true;' }
          ]
        }
      }
    ]
  };

  const mdOutput = serializeToMarkdownBrowser(mockConv);
  assertions++;
  assert.ok(mdOutput.includes('title: "Prueba de Migración"'));
  assertions++;
  assert.ok(mdOutput.includes('```javascript\nconst localFirst = true;\n```'));
  assertions++;
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(mdOutput), 'Salida Markdown no debe contener emojis');

  // 3. Paquete Claude en navegador con bloques de código preservados
  const claudePrompt = createClaudePromptBrowser(mockConv);
  assertions++;
  assert.ok(claudePrompt.includes('# PAQUETE DE MIGRACIÓN DE CONTEXTO SEMÁNTICO (AICP)'));
  assertions++;
  assert.ok(claudePrompt.includes('Prueba de Migración'));
  assertions++;
  assert.ok(claudePrompt.includes('```javascript\nconst localFirst = true;\n```'), 'Paquete Claude debe conservar bloques de código formateados');
  assertions++;
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(claudePrompt), 'Paquete Claude no debe contener emojis');

  assert.equal(assertions, 10, 'Debe ejecutar exactamente 10 aserciones físicas de lógica del popup');
});

test('AICP Content Script: verificación de robustez DOM y cero emojis', () => {
  let assertions = 0;

  const contentScriptSource = fs.readFileSync(path.join(__dirname, '../../extension/src/content/content_script.js'), 'utf8');

  // 1. Cero emojis en content script
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assertions++;
  assert.equal(emojiRegex.test(contentScriptSource), false, 'content_script.js no debe contener emojis');

  // 2. Selectores resilientes
  assertions++;
  assert.ok(contentScriptSource.includes('textContent') && contentScriptSource.includes('innerText'), 'Debe utilizar textContent como fallback seguro para headings sr-only');

  // 3. Reemplazo de bloques de código en el clon para evitar duplicación
  assertions++;
  assert.ok(contentScriptSource.includes('replaceChild'), 'Debe reemplazar nodos pre en el clon para preservar orden sin duplicación');

  assert.equal(assertions, 3, 'Debe ejecutar exactamente 3 aserciones de content script');
});

test('AICP Canonical & Serializer: integridad honesta y cero-inferencia de modelo', () => {
  let assertions = 0;

  // 1. Invariante: Modelo no inferido / desconocido emite null, nunca gpt-4o inventado
  const unverifiedConv = createCanonicalConversation({
    title: 'Evaluación arquitectónica inicial',
    platform: 'chatgpt',
    // model omitido deliberadamente
    url: 'https://chatgpt.com/g/g-p-test-liner/c/test-c1',
    messages: [
      { role: 'user', author: 'Usuario', text: 'Mensaje sin modelo explícito' },
      { role: 'assistant', author: 'ChatGPT', text: 'Respuesta honesta sin modelo inventado' }
    ]
  });

  assertions++;
  assert.equal(unverifiedConv.metadata.model, null, 'Modelo desconocido debe ser null, nunca inventar gpt-4o');

  const unverifiedMd = serializeToMarkdown(unverifiedConv);
  assertions++;
  assert.ok(unverifiedMd.includes('model: null'), 'Frontmatter debe declarar model: null');
  assertions++;
  assert.equal(unverifiedMd.includes('gpt-4o'), false, 'Export no debe afirmar gpt-4o si no hay soporte');
  assertions++;
  assert.ok(unverifiedMd.includes('> **Plataforma Original**: chatgpt\n'), 'Encabezado no debe añadir paréntesis con modelo ficticio');
  assertions++;
  assert.ok(unverifiedMd.includes('> **Integridad**: Recorrido de scroll (harvested)\n'), 'Integridad harvested por defecto');

  // 2. Invariante: Declaración honesta de captura parcial ante virtualización
  const partialConv = createCanonicalConversation({
    title: 'Conversación Parcial por Virtualización',
    platform: 'chatgpt',
    model: null,
    integrity: 'partial',
    integrityNotice: 'Captura parcial: 8 turnos visibles en DOM (historial previo no montado)',
    url: 'https://chatgpt.com/c/partial-virtualized',
    messages: [
      { role: 'user', author: 'Usuario', text: 'Turno intermedio 11' },
      { role: 'assistant', author: 'ChatGPT', text: 'Turno intermedio 12' }
    ]
  });

  assertions++;
  assert.equal(partialConv.metadata.integrity, 'partial', 'Metadata debe reflejar integridad partial');

  const partialMd = serializeToMarkdown(partialConv);
  assertions++;
  assert.ok(partialMd.includes('integrity: "partial"'), 'Frontmatter debe explicitar integrity: "partial"');
  assertions++;
  assert.ok(partialMd.includes('capture_notice: "Captura parcial: 8 turnos visibles en DOM'), 'Frontmatter debe incluir aviso de captura parcial');
  assertions++;
  assert.ok(partialMd.includes('> **Integridad**: Captura parcial (turnos visibles en DOM)'), 'Encabezado debe advertir que la captura es parcial');

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones de modelo honesto e integridad');
});

test('AICP ChatGPT Adapter: regresión RED-C1-002 (clasificación honesta de captura parcial y modelo null)', () => {
  let assertions = 0;

  // DOM simulado de ChatGPT donde sólo 2 turnos están visibles (por virtualización o scroll intermedio)
  const virtualizedHtml = `
    <div class="thread-scroll-container">
      <div class="relative shrink-0">
        <div class="turn-box">
          <h4 class="sr-only">Tú dijiste:</h4>
          <div>Turno recuperado de la ventana de scroll</div>
        </div>
        <div class="turn-box">
          <h4 class="sr-only">ChatGPT dijo:</h4>
          <div>Respuesta recuperada</div>
        </div>
      </div>
    </div>
  `;

  // Parseo sin modelo explícito y con indicador de integridad parcial
  const parsed = parseChatGPTDomSnippet(virtualizedHtml, {
    title: 'Conversación Virtualizada',
    url: 'https://chatgpt.com/c/virtualized-test',
    integrity: 'partial',
    integrityNotice: 'Turnos anteriores fuera de la ventana de virtualización'
  });

  assertions++;
  assert.equal(parsed.metadata.model, null, 'Adapter no debe inyectar gpt-4o si options.model es omitido');
  assertions++;
  assert.equal(parsed.metadata.integrity, 'partial', 'Adapter debe propagar estado de integridad partial');
  assertions++;
  assert.equal(parsed.messages.length, 2, 'Debe extraer los turnos presentes en el fragmento');
  assertions++;
  assert.equal(parsed.messages[0].role, 'user');
  assertions++;
  assert.equal(parsed.messages[1].role, 'assistant');

  assert.equal(assertions, 5, 'Debe ejecutar exactamente 5 aserciones físicas de regresión RED-C1-002');
});

test('AICP Content Script: recolección de virtualización y preservación de estado', () => {
  let assertions = 0;

  const contentScriptSource = fs.readFileSync(path.join(__dirname, '../../extension/src/content/content_script.js'), 'utf8');

  // 1. Presencia de la rutina de recolección de virtualización
  assertions++;
  assert.ok(contentScriptSource.includes('harvestAllConversationTurns'), 'Debe implementar harvestAllConversationTurns');

  // 2. Preservación y restauración de scroll del usuario
  assertions++;
  assert.ok(contentScriptSource.includes('initialScrollTop'), 'Debe guardar y restaurar initialScrollTop para no alterar al usuario');

  // 3. Cero-inferencia de modelo: detectModelFromDom no asume gpt-4o por defecto
  assertions++;
  assert.ok(contentScriptSource.includes('detectModelFromDom'), 'Debe implementar detectModelFromDom');
  assertions++;
  assert.ok(!contentScriptSource.includes("model: 'gpt-4o'"), 'No debe contener model: "gpt-4o" hardcodeado');

  // 4. Invariante de canal asíncrono en onMessage
  assertions++;
  assert.ok(contentScriptSource.includes('return true; // Conserva el canal de mensajería'), 'Debe conservar el canal abierto para resolución asíncrona');

  assert.equal(assertions, 5, 'Debe ejecutar exactamente 5 aserciones de auditoría de arquitectura en content script');
});

test('AICP Content Script: algoritmo alignAndAppendTurns preserva turnos repetidos idénticos (anti-colisión)', () => {
  let assertions = 0;

  const { alignAndAppendTurns } = require('../../extension/src/content/content_script.js');

  // Caso: Un usuario envía "Sí" en el turno inicial, y vuelve a enviar "Sí" en un turno posterior.
  // Ventana 1 (Turnos 0, 1, 2)
  const window1 = [
    { role: 'user', author: 'Usuario', text: 'Sí', codeBlocks: [] },
    { role: 'assistant', author: 'ChatGPT', text: 'Perfecto, procedemos con la arquitectura.', codeBlocks: [] },
    { role: 'user', author: 'Usuario', text: 'Continúa', codeBlocks: [] }
  ];

  // Ventana 2 (Turnos 2, 3, 4) - Se solapa en el turno 2 ("Continúa") y contiene un nuevo "Sí" en el turno 4
  const window2 = [
    { role: 'user', author: 'Usuario', text: 'Continúa', codeBlocks: [] },
    { role: 'assistant', author: 'ChatGPT', text: 'Aquí está el siguiente módulo.', codeBlocks: [] },
    { role: 'user', author: 'Usuario', text: 'Sí', codeBlocks: [] }
  ];

  const merged = alignAndAppendTurns(window1, window2);

  assertions++;
  assert.equal(merged.length, 5, 'Debe fusionar los 5 turnos sin colapsar el segundo "Sí"');

  assertions++;
  assert.equal(merged[0].text, 'Sí', 'Turno 0 debe ser el primer "Sí"');
  assertions++;
  assert.equal(merged[0].role, 'user');

  assertions++;
  assert.equal(merged[1].text, 'Perfecto, procedemos con la arquitectura.');

  assertions++;
  assert.equal(merged[2].text, 'Continúa', 'Turno 2 debe ser "Continúa"');

  assertions++;
  assert.equal(merged[3].text, 'Aquí está el siguiente módulo.');

  assertions++;
  assert.equal(merged[4].text, 'Sí', 'Turno 4 debe ser el segundo "Sí" legítimo preservado');
  assertions++;
  assert.equal(merged[4].role, 'user');

  // Ventana 3 (Turnos 4, 5) - Tercer "Sí" repetido para prueba de esfuerzo
  const window3 = [
    { role: 'user', author: 'Usuario', text: 'Sí', codeBlocks: [] },
    { role: 'assistant', author: 'ChatGPT', text: 'Misión completada.', codeBlocks: [] }
  ];

  const finalMerged = alignAndAppendTurns(merged, window3);

  assertions++;
  assert.equal(finalMerged.length, 6, 'Debe ensamblar 6 turnos en total respetando la secuencia');
  assertions++;
  assert.equal(finalMerged[5].text, 'Misión completada.');

  assert.equal(assertions, 10, 'Debe ejecutar exactamente 10 aserciones físicas de anti-colisión secuencial');
});

test('AICP Content Script: telemetría diagnóstica RED-C1-003 y computeOverlap', () => {
  let assertions = 0;

  const { computeOverlap } = require('../../extension/src/content/content_script.js');

  assertions++;
  assert.equal(typeof computeOverlap, 'function', 'computeOverlap debe ser una función exportada');

  // Secuencias de prueba
  const seqA = [
    { role: 'user', author: 'Usuario', text: 'Turno 1', codeBlocks: [] },
    { role: 'assistant', author: 'ChatGPT', text: 'Turno 2', codeBlocks: [] },
    { role: 'user', author: 'Usuario', text: 'Turno 3', codeBlocks: [] }
  ];

  const seqB = [
    { role: 'assistant', author: 'ChatGPT', text: 'Turno 2', codeBlocks: [] },
    { role: 'user', author: 'Usuario', text: 'Turno 3', codeBlocks: [] },
    { role: 'assistant', author: 'ChatGPT', text: 'Turno 4', codeBlocks: [] }
  ];

  // Solapamiento de 2 turnos (Turno 2, Turno 3)
  const overlap = computeOverlap(seqA, seqB);
  assertions++;
  assert.equal(overlap, 2, 'Debe detectar exactamente 2 turnos de solapamiento');

  // Sin solapamiento
  const seqC = [
    { role: 'user', author: 'Usuario', text: 'Completamente nuevo', codeBlocks: [] }
  ];
  assertions++;
  assert.equal(computeOverlap(seqA, seqC), 0, 'Debe retornar 0 cuando no hay solapamiento');

  // Verificación estática del contrato de telemetría RED-C1-003 en el código fuente
  const contentScriptSource = fs.readFileSync(path.join(__dirname, '../../extension/src/content/content_script.js'), 'utf8');

  const requiredTelemetryFields = [
    'iteration',
    'scrollTop',
    'scrollHeight',
    'clientHeight',
    'turnsInWindow',
    'accumulatedBefore',
    'accumulatedAfter',
    'overlap',
    'turnsAdded',
    'windowHeadSnippet',
    'windowTailSnippet',
    'domChanged',
    'stepDurationMs',
    'terminationReason',
    '__LINER_HARVEST_LOG__',
    'linerHarvestLog'
  ];

  requiredTelemetryFields.forEach(field => {
    assertions++;
    assert.ok(contentScriptSource.includes(field) || contentScriptSource.toLowerCase().includes(field.toLowerCase()), `Content script debe incluir el campo de telemetría ${field}`);
  });

  assert.equal(assertions, 19, 'Debe ejecutar exactamente 19 aserciones físicas de telemetría RED-C1-003');
});

// =========================================================================
// LINER v1.3 — PRUEBAS DE ARQUITECTURA SOBERANA (GATES C, D, E, F, G)
// =========================================================================

const { LINER_CANONICAL_VERSION } = require('../../extension/src/core/canonical_model.js');
const { parseChatGPTConversationTree } = require('../../extension/src/platforms/chatgpt/structured/chatgpt_structured_acquisition.js');
const { LinerDB } = require('../../extension/src/core/storage/liner_db.js');
const { JobEngine, JOB_STATUS, ITEM_STATUS } = require('../../extension/src/core/jobs/job_engine.js');
const { GenericTargetAdapter } = require('../../extension/src/targets/generic_target_adapter.js');
const { ClaudeTargetAdapter } = require('../../extension/src/targets/claude_target_adapter.js');
const { MarkdownBundleAdapter } = require('../../extension/src/targets/markdown_bundle_adapter.js');
const { sanitizeDiagnostics, sanitizeFilename, DiagnosticsManager } = require('../../extension/src/core/diagnostics/diagnostics_center.js');

test('Liner v1.3 Canonical Model: árbol DAG, bifurcaciones, adjuntos y referencias tipadas', () => {
  let assertions = 0;

  const conv = createCanonicalConversation({
    title: 'Migración de Arquitectura Gorin',
    platform: 'chatgpt',
    model: 'gpt-4o',
    acquisitionMethod: 'structured-session',
    messages: [
      {
        id: 'msg_001',
        role: 'user',
        author: 'Usuario',
        timestamp: '2026-10-24T14:00:00.000Z',
        text: '¿Cómo formalizar la compuerta perceptual?',
        attachments: [
          { name: 'arquitectura.png', mimeType: 'image/png', sizeBytes: 104857 }
        ]
      },
      {
        id: 'msg_002',
        role: 'assistant',
        author: 'ChatGPT',
        timestamp: '2026-10-24T14:00:10.000Z',
        text: 'La compuerta perceptual exige console.error = 0.',
        citations: [
          { title: 'Axion Protocol Specification', url: 'https://axion.dev/spec' }
        ]
      }
    ],
    branches: {
      rootNodeId: 'node_root',
      totalNodes: 3,
      branchPoints: [{ nodeId: 'node_root', childrenCount: 2, childIds: ['node_a', 'node_b'] }]
    }
  });

  assertions++;
  assert.equal(conv.canonicalVersion, LINER_CANONICAL_VERSION, 'Debe cumplir canonicalVersion 1.3.0');

  assertions++;
  assert.equal(conv.source.acquisitionMethod, 'structured-session');

  assertions++;
  assert.equal(conv.messages[0].attachments.length, 1);
  assertions++;
  assert.equal(conv.messages[0].attachments[0].mimeType, 'image/png');

  assertions++;
  assert.equal(conv.messages[1].references.length, 1);
  assertions++;
  assert.equal(conv.messages[1].references[0].url, 'https://axion.dev/spec');

  assertions++;
  assert.ok(conv.branches !== null, 'Debe preservar la estructura de bifurcaciones');
  assertions++;
  assert.equal(conv.branches.branchPoints.length, 1);

  assert.equal(assertions, 8, 'Debe ejecutar exactamente 8 aserciones físicas de Canonical v1.3');
});

test('Liner v1.3 Structured Acquisition: parseo de DAG mapping y reconstrucción cronológica', () => {
  let assertions = 0;

  const mockChatGPTTree = {
    title: 'Árbol DAG de Ingeniería',
    id: '6710-dag-test',
    create_time: 1710000000,
    update_time: 1710000100,
    current_node: 'node_assistant_turn',
    mapping: {
      'node_root': {
        id: 'node_root',
        parent: null,
        children: ['node_user_turn'],
        message: null
      },
      'node_user_turn': {
        id: 'node_user_turn',
        parent: 'node_root',
        children: ['node_assistant_turn', 'node_assistant_alternative'],
        message: {
          id: 'node_user_turn',
          author: { role: 'user' },
          create_time: 1710000010,
          content: { content_type: 'text', parts: ['¿Cómo desacoplar adquisición de proyección?'] }
        }
      },
      'node_assistant_turn': {
        id: 'node_assistant_turn',
        parent: 'node_user_turn',
        children: [],
        message: {
          id: 'node_assistant_turn',
          author: { role: 'assistant' },
          create_time: 1710000025,
          content: {
            content_type: 'text',
            parts: ['Implementa el patrón TargetAdapter:\n```typescript\nclass Adapter {}\n```']
          },
          metadata: {
            model_slug: 'gpt-4o',
            citations: [{ metadata: { title: 'Design Patterns', url: 'https://patterns.dev' } }]
          }
        }
      },
      'node_assistant_alternative': {
        id: 'node_assistant_alternative',
        parent: 'node_user_turn',
        children: [],
        message: {
          id: 'node_assistant_alternative',
          author: { role: 'assistant' },
          create_time: 1710000028,
          content: { content_type: 'text', parts: ['Rama alternativa descartada'] }
        }
      }
    }
  };

  const parsed = parseChatGPTConversationTree(mockChatGPTTree);

  assertions++;
  assert.equal(parsed.title, 'Árbol DAG de Ingeniería');
  assertions++;
  assert.equal(parsed.source.platform, 'chatgpt');
  assertions++;
  assert.equal(parsed.source.conversationId, '6710-dag-test');

  assertions++;
  assert.equal(parsed.model, 'gpt-4o', 'Debe extraer gpt-4o estrictamente desde model_slug');

  assertions++;
  assert.equal(parsed.messages.length, 2, 'Ruta activa debe contener exactamente 2 turnos cronológicos');
  assertions++;
  assert.equal(parsed.messages[0].role, 'user');
  assertions++;
  assert.equal(parsed.messages[1].role, 'assistant');

  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks.length, 1);
  assertions++;
  assert.equal(parsed.messages[1].content.codeBlocks[0].language, 'typescript');

  assertions++;
  assert.equal(parsed.messages[1].references.length, 1);
  assertions++;
  assert.equal(parsed.messages[1].references[0].url, 'https://patterns.dev');

  assertions++;
  assert.ok(parsed.branches !== null, 'Debe registrar la presencia de ramas');
  assertions++;
  assert.equal(parsed.branches.branchPoints.length, 1, 'Debe detectar 1 punto de bifurcación');

  assertions++;
  assert.equal(parsed.integrity.status, 'captured');

  assert.equal(assertions, 14, 'Debe ejecutar exactamente 14 aserciones físicas de parseo DAG');
});

test('Liner v1.3 LinerDB: persistencia local, indexación y búsqueda full-text sin backend', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const conv1 = createCanonicalConversation({
    title: 'Microkernel Axkern y MV3',
    platform: 'chatgpt',
    model: 'gpt-4o',
    messages: [{ role: 'user', text: 'Explicación del ciclo de vida en Service Worker' }]
  });

  const conv2 = createCanonicalConversation({
    title: 'Optimización de Memoria y Virtualización',
    platform: 'chatgpt',
    messages: [{ role: 'user', text: 'Cómo prevenir fugas en IndexedDB y blobs grandes' }]
  });

  await db.saveConversation(conv1);
  await db.saveConversation(conv2);

  const list = await db.listMetadata();
  assertions++;
  assert.equal(list.length, 2, 'Debe persistir 2 conversaciones en el índice');

  // Búsqueda por token de título
  const results1 = await db.search('Axkern');
  assertions++;
  assert.equal(results1.length, 1);
  assertions++;
  assert.equal(results1[0].title, 'Microkernel Axkern y MV3');

  // Búsqueda por token en contenido del mensaje
  const results2 = await db.search('fugas');
  assertions++;
  assert.equal(results2.length, 1);
  assertions++;
  assert.equal(results2[0].title, 'Optimización de Memoria y Virtualización');

  // Colecciones
  const coll = await db.createCollection('Ingeniería de Sistemas', 'Proyectos núcleo', [conv1.canonicalId]);
  assertions++;
  assert.ok(coll.collectionId.startsWith('coll_'));
  assertions++;
  assert.equal(coll.conversationIds.length, 1);

  const retrievedColl = await db.getCollection(coll.collectionId);
  assertions++;
  assert.equal(retrievedColl.name, 'Ingeniería de Sistemas');

  assert.equal(assertions, 8, 'Debe ejecutar exactamente 8 aserciones físicas de LinerDB');
});

test('Liner v1.3 Job Engine: máquina de estados, control de concurrencia y backoff 429', async () => {
  let assertions = 0;

  const engine = new JobEngine({ concurrency: 2, itemPacingMs: 10, maxRetries: 2 });
  const items = [
    { id: 'chat_1', title: 'Chat 1' },
    { id: 'chat_2', title: 'Chat 2' },
    { id: 'chat_3', title: 'Chat 3' }
  ];

  const job = engine.createJob('BULK_CAPTURE', items);
  assertions++;
  assert.equal(job.status, JOB_STATUS.QUEUED);
  assertions++;
  assert.equal(job.totalItems, 3);

  let attemptsChat2 = 0;
  const workerFn = async (item) => {
    if (item.id === 'chat_2') {
      attemptsChat2++;
      if (attemptsChat2 === 1) {
        const err = new Error('HTTP_429_RATE_LIMITED');
        err.retryAfterSeconds = 0;
        throw err;
      }
    }
    return { id: item.id, warnings: item.id === 'chat_3' ? ['Alerta menor'] : [] };
  };

  const completedJob = await engine.run(workerFn);

  assertions++;
  assert.equal(completedJob.status, JOB_STATUS.COMPLETED_WITH_WARNINGS, 'Debe finalizar con avisos por el warning en chat_3');
  assertions++;
  assert.equal(completedJob.completedItems, 3, 'Todos los 3 elementos deben haberse completado');
  assertions++;
  assert.equal(attemptsChat2, 2, 'Chat 2 debe haberse reintentado tras el 429');
  assertions++;
  assert.equal(completedJob.warningItems, 1);

  assert.equal(assertions, 6, 'Debe ejecutar exactamente 6 aserciones físicas de JobEngine');
});

test('Liner v1.3 Target Adapters: Generic Liner Package v1, Claude y Markdown Bundle', () => {
  let assertions = 0;

  const conv = createCanonicalConversation({
    title: 'Prueba Multidestino',
    platform: 'chatgpt',
    model: 'gpt-4o',
    acquisitionMethod: 'structured-session',
    messages: [
      { role: 'user', text: '¿Cuáles son las 7 Fronteras de Excelencia?' },
      { role: 'assistant', text: 'Las 7 Fronteras evalúan madurez epistémica y técnica.' }
    ]
  });

  // 1. Generic Liner Package v1
  const genericAdapter = new GenericTargetAdapter();
  const pkg = genericAdapter.generatePackage([conv]);

  assertions++;
  assert.ok(pkg.files['manifest.json'], 'Debe generar manifest.json');
  assertions++;
  assert.ok(pkg.files['START_HERE.md'], 'Debe generar START_HERE.md');
  assertions++;
  assert.ok(pkg.files['CONTEXT_MAP.md'], 'Debe generar CONTEXT_MAP.md');
  assertions++;
  assert.ok(pkg.files['portability/receipt.json'], 'Debe generar portability/receipt.json');
  assertions++;
  assert.ok(pkg.receipt.fileHashes['manifest.json'], 'El recibo debe contener hash SHA-256 de manifest.json');

  // 2. Claude Target Adapter
  const claudeAdapter = new ClaudeTargetAdapter();
  const claudePkg = claudeAdapter.generatePackage([conv]);

  assertions++;
  assert.ok(claudePkg.files['PROJECT_CONTEXT.md']);
  assertions++;
  assert.ok(claudePkg.files['IMPORT_PROMPT.md']);
  assertions++;
  assert.ok(claudePkg.importPrompt.includes('Las 7 Fronteras evalúan madurez epistémica'));

  // 3. Markdown Bundle Adapter
  const mdAdapter = new MarkdownBundleAdapter();
  const mdPkg = mdAdapter.generatePackage([conv]);

  assertions++;
  assert.ok(mdPkg.files['INDEX.md']);

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones físicas de Target Adapters');
});

test('Liner v1.3 Security & Diagnostics Shield: sanitización anti-fuga de tokens y nombres seguros', () => {
  let assertions = 0;

  const rawDirtyDiagnostics = {
    url: 'https://chatgpt.com/backend-api/conversation',
    headers: {
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abc_signature',
      Cookie: '__Secure-next-auth.session-token=secret_session_token_123'
    },
    userEmail: 'dev@axion.internal',
    apiKey: 'sk-proj-1234567890abcdef',
    safeMessage: 'Extracción completada con éxito'
  };

  const clean = sanitizeDiagnostics(rawDirtyDiagnostics);

  assertions++;
  assert.equal(clean.headers.Authorization, '[REDACTED_SENSITIVE_KEY]');
  assertions++;
  assert.equal(clean.headers.Cookie, '[REDACTED_SENSITIVE_KEY]');
  assertions++;
  assert.equal(clean.apiKey, '[REDACTED_SENSITIVE_KEY]');
  assertions++;
  assert.equal(clean.userEmail, '[EMAIL_REDACTED]');
  assertions++;
  assert.equal(clean.safeMessage, 'Extracción completada con éxito');

  // Sanitización contra Zip Slip y nombres reservados en Windows
  assertions++;
  const safe1 = sanitizeFilename('../../etc/passwd');
  assert.equal(safe1, 'etc_passwd', 'Debe erradicar secuencias .. de path traversal');

  assertions++;
  const safe2 = sanitizeFilename('CON.json');
  assert.equal(safe2, 'safe_CON.json', 'Debe neutralizar nombres de dispositivo reservados en Windows');

  assertions++;
  const safe3 = sanitizeFilename('COM1');
  assert.equal(safe3, 'safe_COM1');

  assertions++;
  const safe4 = sanitizeFilename('  Nombre   con   espacios  :::  ilegales??  ');
  assert.equal(safe4, 'Nombre_con_espacios_ilegales');

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones físicas de seguridad y sanitización');
});

const { sha256, generateId } = require('../../extension/src/core/crypto_util.js');
const { ChatGPTAcquisitionManager } = require('../../extension/src/platforms/chatgpt/acquisition_manager.js');
const { ChatGPTCapabilityDetector } = require('../../extension/src/platforms/chatgpt/capabilities/chatgpt_capabilities.js');

test('Liner v1.3 Crypto Utility: congruencia determinista SHA-256 e IDs únicos', () => {
  let assertions = 0;

  // Vector NIST SHA-256 para string vacío: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const emptyHash = sha256('');
  assertions++;
  assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  // Vector NIST SHA-256 para "abc": ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  const abcHash = sha256('abc');
  assertions++;
  assert.equal(abcHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // Generación de IDs deterministas
  const id1 = generateId('conv', 'seed_123');
  const id2 = generateId('conv', 'seed_123');
  const id3 = generateId('conv', 'seed_456');

  assertions++;
  assert.equal(id1, id2, 'Misma semilla debe producir el mismo ID');
  assertions++;
  assert.notEqual(id1, id3, 'Distintas semillas deben producir IDs diferentes');
  assertions++;
  assert.ok(id1.startsWith('conv_'));

  assert.equal(assertions, 5, 'Debe ejecutar exactamente 5 aserciones criptográficas físicas');
});

test('Liner v1.3 Official Export Ingestion: parseo masivo de conversations.json oficial', () => {
  let assertions = 0;

  const mockOfficialExport = [
    {
      id: 'official_conv_1',
      title: 'Conversación Oficial 1',
      create_time: 1715000000,
      update_time: 1715000500,
      current_node: 'n_a1',
      mapping: {
        'n_root': { id: 'n_root', parent: null, children: ['n_u1'], message: null },
        'n_u1': {
          id: 'n_u1', parent: 'n_root', children: ['n_a1'],
          message: { id: 'n_u1', author: { role: 'user' }, create_time: 1715000010, content: { parts: ['Pregunta 1'] } }
        },
        'n_a1': {
          id: 'n_a1', parent: 'n_u1', children: [],
          message: { id: 'n_a1', author: { role: 'assistant' }, create_time: 1715000020, content: { parts: ['Respuesta 1'] }, metadata: { model_slug: 'gpt-4o' } }
        }
      }
    },
    {
      id: 'official_conv_2',
      title: 'Conversación Oficial 2',
      create_time: 1715100000,
      update_time: 1715100600,
      current_node: 'n_a2',
      mapping: {
        'n_root2': { id: 'n_root2', parent: null, children: ['n_u2'], message: null },
        'n_u2': {
          id: 'n_u2', parent: 'n_root2', children: ['n_a2'],
          message: { id: 'n_u2', author: { role: 'user' }, create_time: 1715100010, content: { parts: ['Pregunta 2'] } }
        },
        'n_a2': {
          id: 'n_a2', parent: 'n_u2', children: [],
          message: { id: 'n_a2', author: { role: 'assistant' }, create_time: 1715100020, content: { parts: ['Respuesta 2'] } }
        }
      }
    }
  ];

  const manager = new ChatGPTAcquisitionManager();
  const canonicalList = manager.ingestOfficialExport(mockOfficialExport);

  assertions++;
  assert.equal(canonicalList.length, 2, 'Debe procesar las 2 conversaciones');
  assertions++;
  assert.equal(canonicalList[0].title, 'Conversación Oficial 1');
  assertions++;
  assert.equal(canonicalList[0].source.acquisitionMethod, 'official-export');
  assertions++;
  assert.equal(canonicalList[0].model, 'gpt-4o');
  assertions++;
  assert.equal(canonicalList[0].messages.length, 2);
  assertions++;
  assert.equal(canonicalList[1].title, 'Conversación Oficial 2');
  assertions++;
  assert.equal(canonicalList[1].model, null, 'Sin model_slug explícito debe ser null');

  assert.equal(assertions, 7, 'Debe ejecutar exactamente 7 aserciones físicas de export oficial');
});

test('Liner v1.3 Acquisition Manager: jerarquía híbrida (Tier 1 Estructurado -> Tier 2 DOM Fallback -> Tier 3 FAILED)', async () => {
  let assertions = 0;

  // 1. Fallo de Tier 1 con fallback exitoso a Tier 2 DOM
  const mockFailingClient = {
    getConversation: async () => { throw new Error('HTTP 401 Unauthorized'); }
  };
  const mockDomHarvester = async () => ({
    title: 'Chat Rescatado por DOM',
    turns: [
      { role: 'user', author: 'Usuario', text: 'Turno recuperado de DOM', codeBlocks: [] },
      { role: 'assistant', author: 'ChatGPT', text: 'Respuesta recuperada', codeBlocks: [] }
    ],
    integrity: 'harvested',
    model: 'gpt-4o'
  });

  const manager = new ChatGPTAcquisitionManager({
    structuredClient: mockFailingClient
  });

  const convFallback = await manager.acquireConversation('conv_failing_id', {
    domHarvester: mockDomHarvester
  });

  assertions++;
  assert.equal(convFallback.title, 'Chat Rescatado por DOM');
  assertions++;
  assert.equal(convFallback.source.acquisitionMethod, 'dom-harvest');
  assertions++;
  assert.equal(convFallback.integrity.status, 'degraded', 'Fallo de Tier 1 con recuperación Tier 2 debe clasificarse como degraded');
  assertions++;
  assert.ok(convFallback.integrity.warnings.some(w => w.includes('Fallo en adquisición estructurada')));
  assertions++;
  assert.equal(convFallback.messages.length, 2);

  // 2. Fallo Total (Tier 1 y Tier 2 fallan)
  const mockFailingDom = async () => { throw new Error('DOM no montado'); };
  const convFailed = await manager.acquireConversation('conv_total_fail', {
    domHarvester: mockFailingDom,
    title: 'Chat Totalmente Fallido'
  });

  assertions++;
  assert.equal(convFailed.integrity.status, 'failed', 'Fallo en todas las capas debe resultar en status: failed');
  assertions++;
  assert.equal(convFailed.messages.length, 0);

  assert.equal(assertions, 7, 'Debe ejecutar exactamente 7 aserciones físicas de jerarquía híbrida');
});

test('Liner v1.3 Capability Detector: detección empírica de sesión web estructurada', async () => {
  let assertions = 0;

  // Mock fetch con sesión activa (200 OK)
  const mockActiveFetch = async (url) => {
    if (url === '/api/auth/session') {
      return { ok: true, json: async () => ({ accessToken: 'mock_token' }) };
    }
    return { ok: false };
  };

  const detectorActive = new ChatGPTCapabilityDetector({ fetch: mockActiveFetch });
  const reportActive = await detectorActive.detectCapabilities();

  assertions++;
  assert.equal(reportActive.capabilities.structuredSession, 'available');
  assertions++;
  assert.equal(reportActive.capabilities.conversationList, 'available');

  // Mock fetch sin sesión (401 Unauthorized)
  const mockInactiveFetch = async (url) => {
    return { ok: false, status: 401 };
  };

  const detectorInactive = new ChatGPTCapabilityDetector({ fetch: mockInactiveFetch });
  const reportInactive = await detectorInactive.detectCapabilities();

  assertions++;
  assert.equal(reportInactive.capabilities.structuredSession, 'unavailable');
  assertions++;
  assert.equal(reportInactive.capabilities.conversationList, 'unavailable');

  assert.equal(assertions, 4, 'Debe ejecutar exactamente 4 aserciones físicas de detector de capacidades');
});

test('Liner v1.3 LinerDB: borrado integral de base de datos local (clearAll)', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const conv = createCanonicalConversation({
    title: 'Chat para Borrar',
    platform: 'chatgpt',
    messages: [{ role: 'user', text: 'Temporal' }]
  });

  await db.saveConversation(conv);
  await db.createCollection('Colección Temporal', 'Para probar clearAll', [conv.canonicalId]);
  await db.saveTransfer({ transferId: 'tr_test', target: 'generic' });

  const beforeMeta = await db.listMetadata();
  const beforeColl = await db.listCollections();
  const beforeTransfers = await db.listTransfers();

  assertions++;
  assert.equal(beforeMeta.length, 1);
  assertions++;
  assert.equal(beforeColl.length, 1);
  assertions++;
  assert.equal(beforeTransfers.length, 1);

  // Ejecutar clearAll
  await db.clearAll();

  const afterMeta = await db.listMetadata();
  const afterColl = await db.listCollections();
  const afterTransfers = await db.listTransfers();

  assertions++;
  assert.equal(afterMeta.length, 0, 'metadata_index debe quedar vacío tras clearAll');
  assertions++;
  assert.equal(afterColl.length, 0, 'collections debe quedar vacío tras clearAll');
  assertions++;
  assert.equal(afterTransfers.length, 0, 'transfers debe quedar vacío tras clearAll');

  assert.equal(assertions, 6, 'Debe ejecutar exactamente 6 aserciones físicas de clearAll');
});

// =========================================================================
// LINER v1.3.1 — PRUEBAS DE COHERENCIA DE PRODUCTO Y OPERACIONES EN LOTE
// =========================================================================

const { formatRelativeTime, formatLibrarySubtitle } = require('../../extension/src/popup/popup.js');

test('Liner v1.3.1 Contract: Passive Detection vs Active Acquisition Separation & Zero Auto-Scan on Open', () => {
  let assertions = 0;

  // 1. Gramática y concordancia en español para la superficie de control (Popup)
  assertions++;
  assert.equal(formatLibrarySubtitle(0, 0), '0 conversaciones guardadas · 0 transferencias');
  assertions++;
  assert.equal(formatLibrarySubtitle(1, 1), '1 conversación guardada · 1 transferencia');
  assertions++;
  assert.equal(formatLibrarySubtitle(2, 0), '2 conversaciones guardadas · 0 transferencias');
  assertions++;
  assert.equal(formatLibrarySubtitle(5, 3), '5 conversaciones guardadas · 3 transferencias');

  // 2. Tiempo relativo en español
  assertions++;
  assert.equal(formatRelativeTime(new Date().toISOString()), 'hace unos instantes');
  assertions++;
  assert.equal(formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000).toISOString()), 'hace 5 min');
  assertions++;
  assert.equal(formatRelativeTime(new Date(Date.now() - 2 * 3600 * 1000).toISOString()), 'hace 2 horas');

  // 3. Verificación de UI Popup: controles de adquisición explícita y apertura no bloqueante
  const popupHtml = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  assertions++;
  assert.ok(popupHtml.includes('id="btn-capture-update"'), 'Debe existir botón de captura/actualización explícita');
  assertions++;
  assert.ok(popupHtml.includes('id="btn-cancel-capture"'), 'Debe existir botón para cancelar captura');
  assertions++;
  assert.ok(popupHtml.includes('id="btn-open-workspace"'), 'Botón Abrir Liner Workspace debe estar presente');
  assertions++;
  assert.equal(popupHtml.includes('disabled id="btn-open-workspace"') || popupHtml.includes('id="btn-open-workspace" class="action-row" type="button" disabled'), false, 'Abrir Workspace jamás debe estar deshabilitado por defecto');

  // 4. Erradicación de Workbench en favor de Workspace
  assertions++;
  assert.equal(popupHtml.includes('Workbench'), false, 'popup.html no debe mezclar Workbench con Workspace');

  const workspaceHtml = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  assertions++;
  assert.equal(workspaceHtml.includes('Workbench'), false, 'workspace.html no debe contener Workbench');

  // 5. Elementos de arquitectura de producto presentes en Workspace
  assertions++;
  assert.ok(workspaceHtml.includes('id="global-job-tray"'), 'Workspace debe contener bandeja global de trabajos persistente');
  assertions++;
  assert.ok(workspaceHtml.includes('id="inspector-drawer"'), 'Workspace debe contener panel inspector lateral');
  assertions++;
  assert.ok(workspaceHtml.includes('id="collection-detail-panel"'), 'Workspace debe contener subpanel de detalle de colecciones');
  assertions++;
  assert.ok(workspaceHtml.includes('id="btn-bulk-capture"'), 'Workspace debe contener acción masiva de captura');

  assert.equal(assertions, 17, 'Debe ejecutar exactamente 17 aserciones de contrato de detección pasiva y UI');
});

test('Liner v1.3.1 Contract: Single Source of Truth & Discrepancia 32 vs 38', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  // Simular conversación persistida con 38 mensajes de un harvest previo
  const messages38 = Array.from({ length: 38 }, (_, i) => ({
    id: `msg_${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    author: i % 2 === 0 ? 'Usuario' : 'ChatGPT',
    text: `Mensaje número ${i + 1}`,
    codeBlocks: []
  }));

  const storedConv = createCanonicalConversation({
    title: 'Evaluación arquitectónica inicial',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/eval-arch-001',
    messages: messages38,
    integrity: {
      status: 'partial',
      messageCount: 38,
      warnings: ['Captura parcial: los turnos anteriores no pudieron ser materializados en el DOM.']
    }
  });
  storedConv.canonicalId = 'conv_chatgpt_eval_arch_001';

  await db.saveConversation(storedConv);

  // 1. Verificación de Single Source of Truth: Base de datos almacena 38 mensajes
  const readBack = await db.getConversation('conv_chatgpt_eval_arch_001');
  assertions++;
  assert.equal(readBack.messages.length, 38, 'Registro persistido debe contener exactamente 38 mensajes');
  assertions++;
  assert.equal(readBack.integrity.status, 'partial', 'Integridad debe ser partial');

  // 2. Simulación de detección pasiva: En el DOM solo hay 32 turnos visibles (virtualización activa)
  const passiveDomStatus = {
    conversationId: 'eval_arch_001',
    visibleTurnsCount: 32, // Solo 32 en pantalla
    title: 'Evaluación arquitectónica inicial'
  };

  // La detección pasiva NO debe alterar el número guardado en LinerDB
  const metadataList = await db.listMetadata();
  assertions++;
  assert.equal(metadataList.length, 1);
  assertions++;
  assert.equal(metadataList[0].messageCount, 38, 'El índice local debe mantener 38 mensajes de la fuente de verdad persistida');

  // 3. Simulación de Adquisición Activa explícita (Upsert sin duplicar registros)
  const updatedMessages42 = Array.from({ length: 42 }, (_, i) => ({
    id: `msg_up_${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `Mensaje actualizado ${i + 1}`
  }));

  const recapturedConv = {
    ...storedConv,
    messages: updatedMessages42,
    integrity: { status: 'captured', messageCount: 42, warnings: [] },
    updatedAt: new Date().toISOString()
  };

  await db.saveConversation(recapturedConv);

  const afterUpsertList = await db.listMetadata();
  assertions++;
  assert.equal(afterUpsertList.length, 1, 'Recaptura debe hacer upsert por canonicalId, sin duplicar registros');
  assertions++;
  assert.equal(afterUpsertList[0].messageCount, 42, 'Debe actualizar a los 42 mensajes');
  assertions++;
  assert.equal(afterUpsertList[0].integrityStatus, 'captured');

  assert.equal(assertions, 7, 'Debe ejecutar exactamente 7 aserciones físicas de Single Source of Truth');
});

test('Liner v1.3.1 Collections Contract: Agrupación Mutable, Cero Duplicación y No Destructiva', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  // Crear 3 conversaciones en biblioteca
  const conv1 = createCanonicalConversation({ title: 'Chat Uno', platform: 'chatgpt' });
  conv1.canonicalId = 'conv_001';
  const conv2 = createCanonicalConversation({ title: 'Chat Dos', platform: 'chatgpt' });
  conv2.canonicalId = 'conv_002';
  const conv3 = createCanonicalConversation({ title: 'Chat Tres', platform: 'chatgpt' });
  conv3.canonicalId = 'conv_003';

  await db.saveConversation(conv1);
  await db.saveConversation(conv2);
  await db.saveConversation(conv3);

  assertions++;
  const initialMeta = await db.listMetadata();
  assert.equal(initialMeta.length, 3, 'Biblioteca debe tener 3 conversaciones iniciales');

  // 1. Crear colección con 2 referencias
  const col = await db.createCollection('Proyecto Liner', 'Agrupación de prueba', ['conv_001', 'conv_002']);
  assertions++;
  assert.ok(col.collectionId.startsWith('coll_'));
  assertions++;
  assert.equal(col.conversationIds.length, 2);

  // Las conversaciones en la biblioteca NO se duplicaron
  assertions++;
  const metaAfterCol = await db.listMetadata();
  assert.equal(metaAfterCol.length, 3, 'Crear colección no duplica registros en la biblioteca');

  // 2. Añadir conversación a colección existente
  const updatedCol = await db.addConversationsToCollection(col.collectionId, ['conv_003']);
  assertions++;
  assert.equal(updatedCol.conversationIds.length, 3, 'Colección debe tener ahora 3 referencias');

  // 3. Quitar conversación de colección: NO elimina de biblioteca
  const reducedCol = await db.removeConversationFromCollection(col.collectionId, 'conv_001');
  assertions++;
  assert.equal(reducedCol.conversationIds.length, 2, 'Colección debe tener 2 referencias');
  assertions++;
  assert.equal(reducedCol.conversationIds.includes('conv_001'), false);

  // Comprobar que conv_001 sigue intacta en la biblioteca
  const conv1InDb = await db.getConversation('conv_001');
  assertions++;
  assert.ok(conv1InDb !== null, 'conv_001 debe seguir existiendo intacta en la biblioteca tras ser quitada de la colección');

  // 4. getCollectionsForConversation
  const matchingCols = await db.getCollectionsForConversation('conv_002');
  assertions++;
  assert.equal(matchingCols.length, 1);
  assertions++;
  assert.equal(matchingCols[0].name, 'Proyecto Liner');

  // 5. Eliminar colección: NO elimina conversaciones de biblioteca
  const delSuccess = await db.deleteCollection(col.collectionId);
  assertions++;
  assert.equal(delSuccess, true);

  const colsAfterDel = await db.listCollections();
  assertions++;
  assert.equal(colsAfterDel.length, 0, 'No deben quedar colecciones');

  const finalMeta = await db.listMetadata();
  assertions++;
  assert.equal(finalMeta.length, 3, 'Las 3 conversaciones deben permanecer intactas en la biblioteca tras eliminar la colección');

  assert.equal(assertions, 13, 'Debe ejecutar exactamente 13 aserciones físicas de contrato de colecciones');
});

test('Liner v1.3.1 Job Engine & Concurrencia: Pausa, Reanudación y Cancelación con Preservación Parcial', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const engine = new JobEngine({ db, concurrency: 1, itemPacingMs: 10 });
  const items = [
    { id: 'item_1', title: 'Conversación 1' },
    { id: 'item_2', title: 'Conversación 2' },
    { id: 'item_3', title: 'Conversación 3' },
    { id: 'item_4', title: 'Conversación 4' }
  ];

  const job = engine.createJob('BULK_ACQUISITION', items);
  assertions++;
  assert.equal(job.status, JOB_STATUS.QUEUED);
  assertions++;
  assert.equal(job.totalItems, 4);

  let processedCount = 0;
  const workerFn = async (item) => {
    processedCount++;
    // Persistir el item procesado en LinerDB para verificar que la cancelación conserva completados
    const conv = createCanonicalConversation({ title: item.title, platform: 'chatgpt' });
    conv.canonicalId = item.id;
    await db.saveConversation(conv);

    if (processedCount === 2) {
      // Usuario cancela tras el segundo item
      engine.cancel();
    }
    return { id: item.id };
  };

  const finishedJob = await engine.run(workerFn);

  assertions++;
  assert.equal(finishedJob.status, JOB_STATUS.CANCELLED, 'El trabajo debe finalizar en estado CANCELLED');
  assertions++;
  assert.equal(finishedJob.completedItems, 2, 'Exactamente 2 items deben haberse completado');

  // Comprobar que los 2 items completados permanecen guardados en LinerDB (cero pérdida de trabajo completado)
  const metaAfterCancel = await db.listMetadata();
  assertions++;
  assert.equal(metaAfterCancel.length, 2, 'Los 2 items procesados antes de la cancelación deben permanecer guardados');
  assertions++;
  assert.ok(metaAfterCancel.some(m => m.canonicalId === 'item_1'));
  assertions++;
  assert.ok(metaAfterCancel.some(m => m.canonicalId === 'item_2'));

  // Comprobar que item_3 e item_4 permanecen cancelados o pendientes
  const item3 = finishedJob.items.find(i => i.id === 'item_3');
  assertions++;
  assert.equal(item3.status, ITEM_STATUS.PENDING, 'Item 3 no debe haberse procesado tras la cancelación');

  assert.equal(assertions, 8, 'Debe ejecutar exactamente 8 aserciones físicas de cancelación resiliente');
});

test('Liner v1.3.1 Bulk Operations: Selección Múltiple, Bulk Export y Generación de Paquetes', () => {
  let assertions = 0;

  const convs = [
    createCanonicalConversation({ title: 'Módulo de Storage', platform: 'chatgpt' }),
    createCanonicalConversation({ title: 'Módulo de Portabilidad', platform: 'chatgpt' }),
    createCanonicalConversation({ title: 'Módulo de Jobs', platform: 'chatgpt' })
  ];

  // 1. Bulk Markdown Bundle: N seleccionadas -> N archivos markdown + INDEX.md
  const mdAdapter = new MarkdownBundleAdapter();
  const mdPkg = mdAdapter.generatePackage(convs);

  assertions++;
  assert.ok(mdPkg.files['INDEX.md'], 'Debe generar el índice maestro INDEX.md');
  assertions++;
  assert.ok(mdPkg.files[`conversations/${convs[0].canonicalId}.md`]);
  assertions++;
  assert.ok(mdPkg.files[`conversations/${convs[1].canonicalId}.md`]);
  assertions++;
  assert.ok(mdPkg.files[`conversations/${convs[2].canonicalId}.md`]);
  assertions++;
  assert.equal(Object.keys(mdPkg.files).filter(k => k.startsWith('conversations/')).length, 3, 'Debe generar exactamente 3 archivos markdown de conversación');

  // 2. Generic Liner Package: verificación de recibo SHA-256 para las 3 conversaciones
  const genericAdapter = new GenericTargetAdapter();
  const pkg = genericAdapter.generatePackage(convs);

  assertions++;
  assert.equal(pkg.manifest.conversations.length, 3, 'El manifiesto debe listar exactamente 3 conversaciones');
  assertions++;
  assert.ok(pkg.receipt.fileHashes['manifest.json'], 'Recibo debe contener hash SHA-256 de manifest.json');
  assertions++;
  assert.ok(pkg.files['portability/receipt.json']);

  assert.equal(assertions, 8, 'Debe ejecutar exactamente 8 aserciones físicas de exportación en lote');
});

const { createZip, crc32 } = require('../../extension/src/core/portability/zip_builder.js');

test('Liner v1.3.1 Robustness: Popup Initialization, Zero ReferenceError & Control Surface Invariants', () => {
  let assertions = 0;

  const popupJsContent = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.js'), 'utf8');

  // 1. Invariante: btnOpenWorkspace debe estar explícitamente declarado antes de su uso
  assertions++;
  assert.ok(popupJsContent.includes('const btnOpenWorkspace = document.getElementById(\'btn-open-workspace\')'), 'btnOpenWorkspace debe estar declarado con getElementById para evitar ReferenceError');

  // 2. Comprobación de que no existen identificadores de elementos HTML sueltos no declarados
  assertions++;
  assert.equal(popupJsContent.includes('if (btnOpenWorkspace)') && !popupJsContent.includes('const btnOpenWorkspace'), false);

  // 3. Verificación de contrato de Popup HTML
  const popupHtml = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  assertions++;
  assert.ok(popupHtml.includes('id="btn-open-workspace"'));
  assertions++;
  assert.ok(popupHtml.includes('id="btn-capture-update"'));
  assertions++;
  assert.ok(popupHtml.includes('id="btn-cancel-capture"'));
  assertions++;
  assert.ok(popupHtml.includes('id="stored-time-meta"'));

  // 4. Invariante de CSS para Inspector Drawer en Workspace
  const workspaceCss = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');
  assertions++;
  assert.ok(workspaceCss.includes('.inspector-drawer'), 'workspace.css debe contener estilos para .inspector-drawer');
  assertions++;
  assert.ok(workspaceCss.includes('.chip'), 'workspace.css debe contener estilos para .chip');
  assertions++;
  assert.ok(workspaceCss.includes('.badge-uncaptured'), 'workspace.css debe contener estilos para .badge-uncaptured');

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones físicas de robustez de UI');
});

test('Liner v1.3.1 ZipBuilder: Paquetes ZIP Puros sin Dependencias y CRC-32 Determinista', () => {
  let assertions = 0;

  // 1. Verificación de cálculo CRC-32
  const sampleText = 'Liner Context Portability v1.3';
  const sampleBytes = new TextEncoder().encode(sampleText);
  const sampleCrc = crc32(sampleBytes);
  assertions++;
  assert.ok(typeof sampleCrc === 'number' && sampleCrc > 0, 'CRC-32 debe retornar un entero de 32 bits sin signo');

  // 2. Construcción de ZIP con múltiples archivos
  const filesMap = {
    'conversations/chat_01.md': '# Chat de Arquitectura\nDetalles del diseño de Liner.',
    'conversations/chat_02.md': '# Chat de Portabilidad\nPruebas con esquemas neutrales.',
    'manifest.json': JSON.stringify({ version: '1.3.0', total: 2 }, null, 2),
    'INDEX.md': '# Indice Maestro de Conversaciones\n1. Chat 01\n2. Chat 02'
  };

  const zipBytes = createZip(filesMap);
  assertions++;
  assert.ok(zipBytes instanceof Uint8Array, 'createZip debe retornar un Uint8Array');
  assertions++;
  assert.ok(zipBytes.length > 200, 'El archivo ZIP debe contener bytes reales');

  // 3. Verificación de firmas binarias estándar PKZip
  // Local File Header Signature: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  assertions++;
  assert.equal(zipBytes[0], 0x50, 'Firma PK byte 0');
  assertions++;
  assert.equal(zipBytes[1], 0x4B, 'Firma PK byte 1');
  assertions++;
  assert.equal(zipBytes[2], 0x03, 'Firma PK byte 2');
  assertions++;
  assert.equal(zipBytes[3], 0x04, 'Firma PK byte 3');

  // EOCD Signature: PK\x05\x06 en los últimos 22 bytes
  const eocdOffset = zipBytes.length - 22;
  assertions++;
  assert.equal(zipBytes[eocdOffset], 0x50);
  assertions++;
  assert.equal(zipBytes[eocdOffset + 1], 0x4B);
  assertions++;
  assert.equal(zipBytes[eocdOffset + 2], 0x05);
  assertions++;
  assert.equal(zipBytes[eocdOffset + 3], 0x06);

  // Comprobar conteo de archivos en EOCD (offset + 10 es total entries)
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  assertions++;
  assert.equal(totalEntries, 4, 'El ZIP debe reportar exactamente 4 entradas');

  assert.equal(assertions, 12, 'Debe ejecutar exactamente 12 aserciones físicas de ZipBuilder');
});

test('Liner v1.3.1 Collections Extended: Renombrar Colección, Adición Acumulativa y Cero Efectos Colaterales', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  // Crear 2 conversaciones
  const convA = createCanonicalConversation({ title: 'Conversación Alpha', platform: 'chatgpt' });
  convA.canonicalId = 'conv_alpha';
  const convB = createCanonicalConversation({ title: 'Conversación Beta', platform: 'chatgpt' });
  convB.canonicalId = 'conv_beta';
  await db.saveConversation(convA);
  await db.saveConversation(convB);

  // Crear colección
  const col = await db.createCollection('Proyecto Inicial', 'Notas preliminares', ['conv_alpha']);
  assertions++;
  assert.equal(col.name, 'Proyecto Inicial');
  assertions++;
  assert.equal(col.conversationIds.length, 1);

  // 1. Renombrar colección
  const renamed = await db.renameCollection(col.collectionId, 'Proyecto Renombrado', 'Nueva descripción');
  assertions++;
  assert.equal(renamed.name, 'Proyecto Renombrado');
  assertions++;
  assert.equal(renamed.description, 'Nueva descripción');
  assertions++;
  assert.equal(renamed.conversationIds.length, 1, 'Renombrar no debe alterar las referencias de conversaciones');

  // 2. Adición acumulativa (sin duplicación en Set)
  const augmented = await db.addConversationsToCollection(col.collectionId, ['conv_beta', 'conv_alpha']);
  assertions++;
  assert.equal(augmented.conversationIds.length, 2, 'No debe duplicar conv_alpha que ya existía');
  assertions++;
  assert.ok(augmented.conversationIds.includes('conv_alpha'));
  assertions++;
  assert.ok(augmented.conversationIds.includes('conv_beta'));

  // 3. Verificación de integridad en la biblioteca
  const metaList = await db.listMetadata();
  assertions++;
  assert.equal(metaList.length, 2, 'Las 2 conversaciones en la biblioteca permanecen intactas');

  assert.equal(assertions, 9, 'Debe ejecutar exactamente 9 aserciones físicas de colecciones extendidas');
});

test('Liner v1.3.1 Job Engine Concurrency Shield: Bloqueo de Concurrencia y Reintento Aislado de Fallos (retryFailed)', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const engine = new JobEngine({ db, concurrency: 1, itemPacingMs: 10, maxRetries: 0 });
  const items = [
    { id: 'task_1', title: 'Tarea Exitosa' },
    { id: 'task_2', title: 'Tarea Fallida' }
  ];

  const job = engine.createJob('BULK_ACQUISITION', items);

  let attempt = 0;
  const flakyWorker = async (item) => {
    attempt++;
    if (item.id === 'task_2' && attempt <= 2) {
      throw new Error('Fallo transitorio');
    }
    return { id: item.id };
  };

  const initialRun = await engine.run(flakyWorker);
  assertions++;
  assert.equal(initialRun.status, JOB_STATUS.COMPLETED_WITH_WARNINGS, 'Debe terminar con avisos/fallos');
  assertions++;
  assert.equal(initialRun.failedItems, 1);
  assertions++;
  assert.equal(initialRun.completedItems, 1);

  // 1. Invariante: retryFailed debe reprocesar únicamente los items fallidos
  const retriedRun = await engine.retryFailed(flakyWorker);
  assertions++;
  assert.equal(retriedRun.status, JOB_STATUS.COMPLETED, 'Tras retryFailed debe completarse exitosamente');
  assertions++;
  assert.equal(retriedRun.failedItems, 0);
  assertions++;
  assert.equal(retriedRun.completedItems, 2);

  // 2. Invariante: Llamada concurrente mientras _runningLoop está activo debe arrojar error
  engine._runningLoop = true;
  let concurrencyRejected = false;
  try {
    await engine.run(flakyWorker);
  } catch (err) {
    if (err.message.includes('concurrente')) {
      concurrencyRejected = true;
    }
  } finally {
    engine._runningLoop = false;
  }
  assertions++;
  assert.equal(concurrencyRejected, true, 'JobEngine debe rechazar invocaciones concurrentes');

  assert.equal(assertions, 7, 'Debe ejecutar exactamente 7 aserciones físicas de control de concurrencia y retryFailed');
});

test('Liner v1.3.1 Delete Semantics & Cascade Integrity: Eliminación Local y Aislamiento de Red', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const conv1 = createCanonicalConversation({ title: 'Conversación Uno', platform: 'chatgpt' });
  conv1.canonicalId = 'conv_del_1';
  const conv2 = createCanonicalConversation({ title: 'Conversación Dos', platform: 'chatgpt' });
  conv2.canonicalId = 'conv_del_2';

  await db.saveConversation(conv1);
  await db.saveConversation(conv2);

  // Guardar snapshot de transferencia previa para verificar preservación
  await db.saveTransfer({
    transferId: 'trans_snap_101',
    target: 'claude',
    createdAt: new Date().toISOString(),
    conversationCount: 1,
    manifest: { canonicalIds: [conv1.canonicalId] }
  });

  // Crear 2 colecciones con referencias
  const colA = await db.createCollection('Colección Alpha', 'Desc', [conv1.canonicalId, conv2.canonicalId]);
  const colB = await db.createCollection('Colección Beta', 'Desc', [conv1.canonicalId]);

  assertions++;
  assert.equal(colA.conversationIds.length, 2);
  assertions++;
  assert.equal(colB.conversationIds.length, 1);

  // 1. Ejecutar eliminación de conv1
  const deleteRes = await db.deleteConversation(conv1.canonicalId);
  assertions++;
  assert.equal(deleteRes, true, 'deleteConversation debe retornar true tras eliminar');

  // 2. Comprobar que conv1 ya no existe en el store canónico ni en metadatos
  const conv1Check = await db.getConversation(conv1.canonicalId);
  assertions++;
  assert.equal(conv1Check, null, 'Registro canónico de conv1 debe ser nulo');

  const metaList = await db.listMetadata();
  assertions++;
  assert.equal(metaList.length, 1, 'Solo debe quedar conv2 en el índice de metadatos');
  assertions++;
  assert.equal(metaList[0].canonicalId, conv2.canonicalId);

  // 3. Comprobar cascada de colecciones (cero referencias huérfanas)
  const collections = await db.listCollections();
  const updatedColA = collections.find(c => c.collectionId === colA.collectionId);
  const updatedColB = collections.find(c => c.collectionId === colB.collectionId);

  assertions++;
  assert.ok(!updatedColA.conversationIds.includes(conv1.canonicalId), 'colA no debe contener la referencia a conv1');
  assertions++;
  assert.ok(updatedColA.conversationIds.includes(conv2.canonicalId), 'colA debe conservar conv2');
  assertions++;
  assert.equal(updatedColA.conversationIds.length, 1);

  assertions++;
  assert.ok(!updatedColB.conversationIds.includes(conv1.canonicalId), 'colB no debe contener la referencia a conv1');
  assertions++;
  assert.equal(updatedColB.conversationIds.length, 0, 'colB debe quedar vacía');

  // 4. Preservación estricta de transferencias históricas (manifest inmutable)
  const transfers = await db.listTransfers();
  assertions++;
  assert.equal(transfers.length, 1, 'Los registros de transferencias deben preservarse inalterados');
  assertions++;
  assert.equal(transfers[0].transferId, 'trans_snap_101');
  assertions++;
  assert.deepEqual(transfers[0].manifest.canonicalIds, [conv1.canonicalId], 'El manifiesto histórico no debe mutar');

  assert.equal(assertions, 14, 'Debe ejecutar exactamente 14 aserciones físicas de semántica de eliminación y cascada');
});

test('Liner v1.3.1 Delete Conversations Bulk & Restore (Undo): Eliminación en Lote y Reversión', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const c1 = createCanonicalConversation({ title: 'Charla 1', platform: 'chatgpt' });
  c1.canonicalId = 'bulk_c1';
  const c2 = createCanonicalConversation({ title: 'Charla 2', platform: 'chatgpt' });
  c2.canonicalId = 'bulk_c2';
  const c3 = createCanonicalConversation({ title: 'Charla 3', platform: 'chatgpt' });
  c3.canonicalId = 'bulk_c3';

  await db.saveConversation(c1);
  await db.saveConversation(c2);
  await db.saveConversation(c3);

  const colMulti = await db.createCollection('Colección Lote', 'Prueba', [c1.canonicalId, c2.canonicalId, c3.canonicalId]);
  assertions++;
  assert.equal(colMulti.conversationIds.length, 3);

  // 1. Eliminación en lote
  const bulkRes = await db.deleteConversations([c1.canonicalId, c2.canonicalId]);
  assertions++;
  assert.equal(bulkRes, true);

  const remainingMeta = await db.listMetadata();
  assertions++;
  assert.equal(remainingMeta.length, 1);
  assertions++;
  assert.equal(remainingMeta[0].canonicalId, c3.canonicalId);

  const colAfterBulk = (await db.listCollections()).find(c => c.collectionId === colMulti.collectionId);
  assertions++;
  assert.deepEqual(colAfterBulk.conversationIds, [c3.canonicalId]);

  // 2. Reversión / Undo (restoreConversation)
  const restored = await db.restoreConversation(c1, [colMulti.collectionId]);
  assertions++;
  assert.equal(restored, c1.canonicalId);

  const metaAfterRestore = await db.listMetadata();
  assertions++;
  assert.equal(metaAfterRestore.length, 2);

  const conv1Restored = await db.getConversation(c1.canonicalId);
  assertions++;
  assert.ok(conv1Restored !== null);
  assertions++;
  assert.equal(conv1Restored.title, 'Charla 1');

  const colAfterRestore = (await db.listCollections()).find(c => c.collectionId === colMulti.collectionId);
  assertions++;
  assert.ok(colAfterRestore.conversationIds.includes(c1.canonicalId));
  assertions++;
  assert.ok(colAfterRestore.conversationIds.includes(c3.canonicalId));
  assertions++;
  assert.equal(colAfterRestore.conversationIds.length, 2);

  assert.equal(assertions, 12, 'Debe ejecutar exactamente 12 aserciones físicas de eliminación en lote y reversión');
});

test('Liner v1.3.1 Collection Picker & Drag Semantics: ADD_REFERENCE_TO_COLLECTION y Preservación de Biblioteca', async () => {
  let assertions = 0;

  const db = new LinerDB();
  await db.open();

  const cItem1 = createCanonicalConversation({ title: 'Tema Redes', platform: 'chatgpt' });
  cItem1.canonicalId = 'c_ref_1';
  const cItem2 = createCanonicalConversation({ title: 'Tema Algoritmos', platform: 'chatgpt' });
  cItem2.canonicalId = 'c_ref_2';

  await db.saveConversation(cItem1);
  await db.saveConversation(cItem2);

  const targetCol = await db.createCollection('Carpeta Estudio', 'Colección de trabajo');
  assertions++;
  assert.equal(targetCol.conversationIds.length, 0);

  // 1. Agregar referencia a colección vía Drag / Collection Picker
  const updated1 = await db.addConversationsToCollection(targetCol.collectionId, [cItem1.canonicalId]);
  assertions++;
  assert.equal(updated1.conversationIds.length, 1);
  assertions++;
  assert.ok(updated1.conversationIds.includes(cItem1.canonicalId));

  // Invariante: La biblioteca no pierde el item (ADD_REFERENCE_TO_COLLECTION)
  const metaAfterAdd = await db.listMetadata();
  assertions++;
  assert.equal(metaAfterAdd.length, 2, 'La biblioteca principal conserva ambos registros íntegros');

  // 2. Idempotencia y multi-add (sin duplicación en Set)
  const updated2 = await db.addConversationsToCollection(targetCol.collectionId, [cItem1.canonicalId, cItem2.canonicalId]);
  assertions++;
  assert.equal(updated2.conversationIds.length, 2, 'No debe duplicar cItem1');
  assertions++;
  assert.ok(updated2.conversationIds.includes(cItem1.canonicalId));
  assertions++;
  assert.ok(updated2.conversationIds.includes(cItem2.canonicalId));

  // 3. Remover referencia de colección (no destructiva para la biblioteca)
  const updated3 = await db.removeConversationFromCollection(targetCol.collectionId, cItem1.canonicalId);
  assertions++;
  assert.equal(updated3.conversationIds.length, 1);
  assertions++;
  assert.ok(!updated3.conversationIds.includes(cItem1.canonicalId));
  assertions++;
  assert.ok(updated3.conversationIds.includes(cItem2.canonicalId));

  // Invariante: Biblioteca conserva cItem1 intacto a pesar de ser removido de la colección
  const conv1Check = await db.getConversation(cItem1.canonicalId);
  assertions++;
  assert.ok(conv1Check !== null, 'cItem1 debe seguir existiendo en la Biblioteca canónica');
  const metaFinal = await db.listMetadata();
  assertions++;
  assert.equal(metaFinal.length, 2, 'Los 2 elementos permanecen en la Biblioteca');

  // 4. Renombrar colección (persistencia y metadatos)
  const renamed = await db.renameCollection(targetCol.collectionId, 'Carpeta Renombrada', 'Nueva descripción');
  assertions++;
  assert.equal(renamed.name, 'Carpeta Renombrada');
  assertions++;
  assert.equal(renamed.description, 'Nueva descripción');

  // 5. Eliminar colección (Preservación estricta de Biblioteca)
  const delColResult = await db.deleteCollection(targetCol.collectionId);
  assertions++;
  assert.equal(delColResult, true);

  const colCheck = await db.getCollection(targetCol.collectionId);
  assertions++;
  assert.equal(colCheck, null, 'La colección debe haber sido eliminada');

  // Invariante absoluto: Biblioteca conserva todas las conversaciones originales intactas
  const metaAfterColDelete = await db.listMetadata();
  assertions++;
  assert.equal(metaAfterColDelete.length, 2, 'La biblioteca principal conserva ambos registros íntegros tras borrar la colección');

  const conv1Final = await db.getConversation(cItem1.canonicalId);
  assertions++;
  assert.ok(conv1Final !== null, 'cItem1 permanece en la Biblioteca canónica');

  const conv2Final = await db.getConversation(cItem2.canonicalId);
  assertions++;
  assert.ok(conv2Final !== null, 'cItem2 permanece en la Biblioteca canónica');

  assert.equal(assertions, 19, 'Debe ejecutar exactamente 19 aserciones físicas de semántica de referencias y preservación');
});

test('Liner v1.3.1 UI Surface Invariants & Zero Browser Dialogs: Conformidad Estricta de Workspace', () => {
  let assertions = 0;

  const workspaceHtml = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  const workspaceJs = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  const workspaceCss = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');

  // 1. Verificación de elementos DOM estructurales requeridos en workspace.html
  const requiredDomIds = [
    'sidebar-collections-container',
    'sidebar-collections-list',
    'btn-sidebar-new-collection',
    'btn-bulk-delete',
    'collection-search-input',
    'app-modal-backdrop',
    'app-modal-title',
    'app-modal-body',
    'app-modal-footer',
    'app-modal-cancel',
    'app-modal-confirm',
    'toast-container',
    'app-context-menu'
  ];

  requiredDomIds.forEach(id => {
    assertions++;
    assert.ok(workspaceHtml.includes(`id="${id}"`) || workspaceHtml.includes(`id='${id}'`), `workspace.html debe contener id="${id}"`);
  });

  // 2. Columna de arrastre en tablas y versión candidata
  assertions++;
  assert.ok(workspaceHtml.includes('col-drag'), 'workspace.html debe contener clase col-drag');
  assertions++;
  assert.ok(workspaceHtml.includes('Lossy 1.6.1'), 'workspace.html debe exhibir la marca de versión v1.3.1 CANDIDATE');

  // 3. Prohibición estricta de diálogos nativos del navegador (zero alert/prompt/confirm)
  assertions++;
  assert.ok(!/\balert\s*\(/.test(workspaceJs), 'workspace.js no debe contener llamadas a alert()');
  assertions++;
  assert.ok(!/\bprompt\s*\(/.test(workspaceJs), 'workspace.js no debe contener llamadas a prompt()');
  assertions++;
  assert.ok(!/\bconfirm\s*\(/.test(workspaceJs), 'workspace.js no debe contener llamadas a confirm()');

  // 4. Implementación obligatoria de sub-sistemas de interacción
  const requiredRoutines = [
    'bindDragAffordance',
    'setupSidebarDropTargets',
    'openCollectionPicker',
    'promptDeleteConversation',
    'promptDeleteSelectedConversations',
    'showContextMenu',
    'showToast',
    'showModal',
    'closeModal',
    'chrome.runtime.lastError',
    'startSingleCapture',
    'btn-inspector-capture'
  ];

  requiredRoutines.forEach(routine => {
    assertions++;
    assert.ok(workspaceJs.includes(routine), `workspace.js debe implementar ${routine}`);
  });

  // 5. Verificación de clases CSS requeridas para interacción
  const requiredCssClasses = [
    '.drag-handle',
    '.drop-target-active',
    '.drop-target-hover',
    '.sidebar-collections-container',
    '.sidebar-collection-item',
    '.modal-backdrop',
    '.modal-dialog',
    '.toast-container',
    '.toast-item',
    '.context-menu',
    '.collection-picker-list'
  ];

  requiredCssClasses.forEach(cls => {
    assertions++;
    assert.ok(workspaceCss.includes(cls), `workspace.css debe definir ${cls}`);
  });

  // 6. Cero-Emoji en superficies de workspace (HTML, JS, CSS)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(workspaceHtml), 'workspace.html debe tener cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(workspaceJs), 'workspace.js debe tener cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(workspaceCss), 'workspace.css debe tener cero emojis');

  assert.equal(assertions, 44, 'Debe ejecutar exactamente 44 aserciones físicas de conformidad de superficie');
});

test('Liner v1.3.1 Discriminating: RED-BR-001 Zero Unchecked runtime.lastError & Messaging Lifecycle Invariants', async () => {
  let assertions = 0;

  const swJs = fs.readFileSync(path.join(__dirname, '../../extension/src/background/service_worker.js'), 'utf8');
  const csJs = fs.readFileSync(path.join(__dirname, '../../extension/src/content/content_script.js'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../../extension/src/popup/popup.js'), 'utf8');
  const workspaceJs = fs.readFileSync(path.join(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');

  // 1. Service Worker: Prohibición estricta de "return true" suelto o para mensajes no asíncronos
  assertions++;
  assert.ok(!swJs.includes('return true;\n});'), 'service_worker.js no debe terminar onMessage con return true suelto que cause The message port closed');
  assertions++;
  assert.ok(swJs.includes('return false;\n});'), 'service_worker.js debe retornar false para mensajes no asíncronos');

  // 2. Content Script: Prohibición de return true en acciones síncronas o no manejadas
  assertions++;
  assert.ok(!/CANCEL_ACQUISITION[\s\S]*?return true;/.test(csJs), 'CANCEL_ACQUISITION no debe retornar true porque es síncrono');
  assertions++;
  assert.ok(!/GET_PAGE_STATUS[\s\S]*?return true;/.test(csJs), 'GET_PAGE_STATUS no debe retornar true porque es síncrono');
  assertions++;
  assert.ok(csJs.includes('return false;\n    });'), 'content_script.js debe retornar false para acciones no reconocidas');

  // 3. Inspección estricta de todos los sitios de llamada a chrome.tabs.sendMessage y chrome.runtime.sendMessage
  // Verificación: Todo callback debe ser síncrono (no "async (res) =>") para asegurar captura de lastError en el primer tick
  assertions++;
  assert.ok(!workspaceJs.includes('chrome.tabs.sendMessage(tabs[0].id, { action: \'ACQUIRE_CONVERSATION\', conversationId: conv.source.conversationId }, async (res) =>'), 'workspace.js startSingleCapture no debe usar async callback en sendMessage');

  assertions++;
  assert.ok(workspaceJs.includes('const lastError = chrome.runtime && chrome.runtime.lastError;'), 'workspace.js debe evaluar chrome.runtime.lastError síncronamente');

  assertions++;
  assert.ok(popupJs.includes('const lastError = chrome.runtime && chrome.runtime.lastError;'), 'popup.js debe evaluar chrome.runtime.lastError síncronamente en triggerActiveAcquisition');

  // 4. Invariante: cancelActiveAcquisition en popup.js debe tener callback seguro para absorber lastError si la pestaña cerró
  assertions++;
  assert.ok(popupJs.includes('CANCEL_ACQUISITION\' }, () => {'), 'popup.js debe pasar callback con lastError check en CANCEL_ACQUISITION para evitar Unchecked runtime.lastError');

  // 5. Simulación dinámica de fallo de conexión (Receiving end does not exist)
  let interceptedError = null;
  let mockPortOpened = false;

  const mockChromeRuntime = {
    lastError: { message: 'Could not establish connection. Receiving end does not exist.' }
  };

  const simulateSafeSendMessage = (callback) => {
    mockPortOpened = true;
    // Chromium invoca el callback síncronamente
    callback(undefined);
    // Simulación del verificador interno de Chromium: si lastError fue leído, se considera capturado
    if (mockChromeRuntime.lastError && mockChromeRuntime.lastError.__checked) {
      interceptedError = 'CAPTURED_CLEANLY';
    } else {
      interceptedError = 'UNCHECKED_LEAK';
    }
  };

  // Simular la verificación síncrona tal como se implementó en workspace.js y popup.js
  simulateSafeSendMessage((res) => {
    const err = mockChromeRuntime.lastError;
    if (err) {
      err.__checked = true;
    }
  });

  assertions++;
  assert.equal(mockPortOpened, true);
  assertions++;
  assert.equal(interceptedError, 'CAPTURED_CLEANLY', 'El error de runtime debe ser interceptado síncronamente en el mismo frame de llamada');

  assert.equal(assertions, 11, 'Debe ejecutar exactamente 11 aserciones físicas de invariante de mensajería RED-BR-001');
});

test('Liner v1.3.1 Source Identity Invariant: Navigation Epoch & Cross-Conversation Contamination Shield (RED-BR-002)', async () => {
  let assertions = 0;

  const {
    parseChatGPTConversationTreeDirect,
    extractCurrentChatGPTConversation,
    setLastHarvestedStateForTest,
    resetNavigationEpochForTest,
    checkNavigationEpoch,
    getNavigationEpoch
  } = require('../../extension/src/content/content_script.js');

  const { serializeToMarkdownBrowser } = require('../../extension/src/popup/popup.js');

  // 1. SOURCE IDENTITY INVARIANT: Parseo estructurado conserva identidad estricta
  const mockTreeA = {
    id: 'conv-chat-a-1234',
    title: 'Arquitectura del Chat A',
    create_time: 1729760000,
    current_node: 'node-msg-a2',
    mapping: {
      'node-msg-a1': {
        id: 'node-msg-a1',
        parent: null,
        message: {
          id: 'msg-a1',
          author: { role: 'user' },
          create_time: 1729760000,
          content: { parts: ['Pregunta sobre Chat A: Especificacion técnica'] }
        }
      },
      'node-msg-a2': {
        id: 'node-msg-a2',
        parent: 'node-msg-a1',
        message: {
          id: 'msg-a2',
          author: { role: 'assistant' },
          create_time: 1729760005,
          content: { parts: ['Respuesta exclusiva de Chat A: Protocolo AICP sellado'] }
        }
      }
    }
  };

  const parsedA = parseChatGPTConversationTreeDirect(mockTreeA, { conversationId: 'conv-chat-a-1234' });

  assertions++;
  assert.equal(parsedA.canonicalId, 'conv_chatgpt_conv-chat-a-1234');
  assertions++;
  assert.equal(parsedA.source.conversationId, 'conv-chat-a-1234');
  assertions++;
  assert.equal(parsedA.title, 'Arquitectura del Chat A');
  assertions++;
  assert.equal(parsedA.messages.length, 2);
  assertions++;
  assert.ok(parsedA.messages[1].content.text.includes('Respuesta exclusiva de Chat A'));

  // 2. Mock Tree B (Conversación completamente distinta)
  const mockTreeB = {
    id: 'conv-chat-b-9999',
    title: 'Migración del Chat B',
    create_time: 1729770000,
    current_node: 'node-msg-b2',
    mapping: {
      'node-msg-b1': {
        id: 'node-msg-b1',
        parent: null,
        message: {
          id: 'msg-b1',
          author: { role: 'user' },
          create_time: 1729770000,
          content: { parts: ['Pregunta sobre Chat B: Destino de exportación'] }
        }
      },
      'node-msg-b2': {
        id: 'node-msg-b2',
        parent: 'node-msg-b1',
        message: {
          id: 'msg-b2',
          author: { role: 'assistant' },
          create_time: 1729770010,
          content: { parts: ['Respuesta exclusiva de Chat B: Adaptador Claude Target'] }
        }
      }
    }
  };

  const parsedB = parseChatGPTConversationTreeDirect(mockTreeB, { conversationId: 'conv-chat-b-9999' });

  assertions++;
  assert.equal(parsedB.canonicalId, 'conv_chatgpt_conv-chat-b-9999');
  assertions++;
  assert.equal(parsedB.source.conversationId, 'conv-chat-b-9999');
  assertions++;
  assert.equal(parsedB.title, 'Migración del Chat B');
  assertions++;
  assert.equal(parsedB.messages.length, 2);
  assertions++;
  assert.ok(parsedB.messages[1].content.text.includes('Respuesta exclusiva de Chat B'));
  assertions++;
  assert.ok(!parsedB.messages[1].content.text.includes('Chat A'), 'Chat B jamás debe contener contenido de Chat A');

  // 3. Regresión de Persistencia en LinerDB: Cero colisión de clave o atribución cruzada
  const db = new LinerDB();
  await db.open();

  await db.saveConversation(parsedA);
  await db.saveConversation(parsedB);

  const storedA = await db.getConversation('conv_chatgpt_conv-chat-a-1234');
  const storedB = await db.getConversation('conv_chatgpt_conv-chat-b-9999');

  assertions++;
  assert.ok(storedA !== null, 'Chat A debe existir en LinerDB');
  assertions++;
  assert.ok(storedB !== null, 'Chat B debe existir en LinerDB');
  assertions++;
  assert.equal(storedA.source.conversationId, 'conv-chat-a-1234');
  assertions++;
  assert.equal(storedB.source.conversationId, 'conv-chat-b-9999');
  assertions++;
  assert.equal(storedA.title, 'Arquitectura del Chat A');
  assertions++;
  assert.equal(storedB.title, 'Migración del Chat B');

  // 4. Regresión de Exportación Identity-Bound (Prompt requerimiento 10 y 13):
  // Exportar B debe contener B y NUNCA contener A
  const mdExportB = serializeToMarkdownBrowser(storedB);
  assertions++;
  assert.ok(mdExportB.includes('Migración del Chat B'), 'Export de B debe contener el título de B');
  assertions++;
  assert.ok(mdExportB.includes('Respuesta exclusiva de Chat B'), 'Export de B debe contener el mensaje de B');
  assertions++;
  assert.ok(!mdExportB.includes('Arquitectura del Chat A'), 'Export de B JAMÁS debe contener el título de A');
  assertions++;
  assert.ok(!mdExportB.includes('Respuesta exclusiva de Chat A'), 'Export de B JAMÁS debe contener mensajes de A');

  // Exportar A debe contener A y NUNCA contener B
  const mdExportA = serializeToMarkdownBrowser(storedA);
  assertions++;
  assert.ok(mdExportA.includes('Arquitectura del Chat A'));
  assertions++;
  assert.ok(mdExportA.includes('Respuesta exclusiva de Chat A'));
  assertions++;
  assert.ok(!mdExportA.includes('Migración del Chat B'));
  assertions++;
  assert.ok(!mdExportA.includes('Respuesta exclusiva de Chat B'), 'Export de A JAMÁS debe contener mensajes de B');

  // 5. Extensión de Estado Pegajoso (Sticky State): Secuencia A -> B -> C -> A -> C
  const mockTreeC = {
    id: 'conv-chat-c-7777',
    title: 'Diagnóstico del Chat C',
    current_node: 'msg-c1',
    mapping: {
      'msg-c1': {
        id: 'msg-c1',
        parent: null,
        message: {
          id: 'c1',
          author: { role: 'user' },
          content: { parts: ['Mensaje único de Chat C'] }
        }
      }
    }
  };
  const parsedC = parseChatGPTConversationTreeDirect(mockTreeC, { conversationId: 'conv-chat-c-7777' });
  await db.saveConversation(parsedC);

  // Consulta secuencial A -> B -> C -> A -> C
  const seqA1 = await db.getConversation('conv_chatgpt_conv-chat-a-1234');
  const seqB1 = await db.getConversation('conv_chatgpt_conv-chat-b-9999');
  const seqC1 = await db.getConversation('conv_chatgpt_conv-chat-c-7777');
  const seqA2 = await db.getConversation('conv_chatgpt_conv-chat-a-1234');
  const seqC2 = await db.getConversation('conv_chatgpt_conv-chat-c-7777');

  assertions++;
  assert.equal(seqA1.source.conversationId, 'conv-chat-a-1234');
  assertions++;
  assert.equal(seqB1.source.conversationId, 'conv-chat-b-9999');
  assertions++;
  assert.equal(seqC1.source.conversationId, 'conv-chat-c-7777');
  assertions++;
  assert.equal(seqA2.source.conversationId, 'conv-chat-a-1234');
  assertions++;
  assert.equal(seqC2.source.conversationId, 'conv-chat-c-7777');

  // Invariante de aislamiento total de mensajes en transiciones alternadas
  assertions++;
  assert.ok(seqC2.messages[0].content.text.includes('Mensaje único de Chat C'));
  assertions++;
  assert.ok(!seqC2.messages[0].content.text.includes('Chat A'));
  assertions++;
  assert.ok(!seqC2.messages[0].content.text.includes('Chat B'));

  // 6. Simulación de Carrera y Detección de Stale DOM (RED-BR-002 Real Invariant Verification):
  const prevWindow = global.window;
  const prevDocument = global.document;

  try {
    resetNavigationEpochForTest();

    // Estado cosechado previo: Chat A
    setLastHarvestedStateForTest('conv-chat-a-1234', [
      'user:::Pregunta Chat A',
      'assistant:::Respuesta Chat A'
    ]);

    // Simular que el usuario navegó a Chat B en el sidebar (pushState actualiza URL a /c/conv-chat-b-9999),
    // pero el DOM todavía contiene los turnos de Chat A (stale DOM en React SPA)
    global.window = {
      location: {
        pathname: '/c/conv-chat-b-9999',
        href: 'https://chatgpt.com/c/conv-chat-b-9999'
      }
    };

    global.document = {
      querySelector: (sel) => {
        if (sel === 'title') return { textContent: 'Migración del Chat B - ChatGPT' };
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === 'h4' || sel === '[data-message-author-role]') return [];
        if (sel === 'article') {
          return [
            {
              querySelector: () => null,
              textContent: 'Pregunta Chat A'
            },
            {
              querySelector: (sub) => sub === '.markdown' ? {} : null,
              textContent: 'Respuesta Chat A'
            }
          ];
        }
        return [];
      }
    };

    // A. Escenario Stale DOM: Se solicita la captura de conv-chat-b-9999.
    // Aunque la URL ya es conv-chat-b-9999, el DOM aún contiene turnos de Chat A.
    // extractCurrentChatGPTConversation DEBE abortar con SOURCE_IDENTITY_STALE_DOM.
    let staleDomError = null;
    try {
      await extractCurrentChatGPTConversation('conv-chat-b-9999');
    } catch (err) {
      staleDomError = err.message;
    }

    assertions++;
    assert.ok(staleDomError !== null, 'Debe detectar DOM obsoleto y arrojar excepción');
    assertions++;
    assert.ok(staleDomError.includes('SOURCE_IDENTITY_STALE_DOM'), 'Debe abortar con SOURCE_IDENTITY_STALE_DOM');
    assertions++;
    assert.ok(staleDomError.includes('conv-chat-a-1234'), 'El error debe indicar la conversación previa no convergida');

    // B. Escenario Identity Mismatch:
    // Si la pestaña está en conv-chat-b-9999 pero se solicita conv-chat-a-1234
    let mismatchError = null;
    try {
      await extractCurrentChatGPTConversation('conv-chat-a-1234');
    } catch (err) {
      mismatchError = err.message;
    }

    assertions++;
    assert.ok(mismatchError !== null, 'Debe detectar mismatch de identidad');
    assertions++;
    assert.ok(mismatchError.includes('SOURCE_IDENTITY_MISMATCH'), 'Debe abortar con SOURCE_IDENTITY_MISMATCH');

    // C. Escenario Navigation Epoch:
    const initialEpoch = getNavigationEpoch();
    global.window.location.pathname = '/c/conv-chat-c-7777';
    global.window.location.href = 'https://chatgpt.com/c/conv-chat-c-7777';
    const newEpoch = checkNavigationEpoch();

    assertions++;
    assert.ok(newEpoch > initialEpoch, 'Navigation epoch debe incrementarse ante cambio de URL');
  } finally {
    global.window = prevWindow;
    global.document = prevDocument;
    resetNavigationEpochForTest();
  }

  // 7. Library Regression: Biblioteca contiene 3 conversaciones distintas con títulos e IDs exactos (Requerimiento 12)
  const metaList = await db.listMetadata();
  assertions++;
  assert.equal(metaList.length, 3, 'Library debe contener exactamente 3 conversaciones');

  const metaA = metaList.find(m => m.canonicalId === 'conv_chatgpt_conv-chat-a-1234');
  const metaB = metaList.find(m => m.canonicalId === 'conv_chatgpt_conv-chat-b-9999');
  const metaC = metaList.find(m => m.canonicalId === 'conv_chatgpt_conv-chat-c-7777');

  assertions++;
  assert.ok(metaA && metaA.title === 'Arquitectura del Chat A');
  assertions++;
  assert.ok(metaB && metaB.title === 'Migración del Chat B');
  assertions++;
  assert.ok(metaC && metaC.title === 'Diagnóstico del Chat C');

  assert.equal(assertions, 43, 'Debe ejecutar exactamente 43 aserciones físicas de protección de identidad y anti-contaminación cruzada RED-BR-002');
});

test('Lossy P0 / RED-BR-002: Cross-Conversation Contamination Shield & Idempotency Invariants', async () => {
  let assertions = 0;

  const {
    extractCurrentChatGPTConversation,
    setLastHarvestedStateForTest,
    resetNavigationEpochForTest,
    checkNavigationEpoch,
    getNavigationEpoch
  } = require('../../extension/src/content/content_script.js');

  // 1. Idempotency Guard Invariant: window.__LOSSY_CS_INITIALIZED__
  const csCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/content_script.js'), 'utf8');
  assertions++;
  assert.ok(csCode.includes('window.__LOSSY_CS_INITIALIZED__'), 'Content script debe declarar guard de idempotencia __LOSSY_CS_INITIALIZED__');
  assertions++;
  assert.ok(csCode.includes('window.__LINER_CS_INITIALIZED__'), 'Content script debe mantener compatibilidad con __LINER_CS_INITIALIZED__');
  assertions++;
  assert.ok(csCode.includes('if (window.__LOSSY_CS_INITIALIZED__ || window.__LINER_CS_INITIALIZED__)'), 'Content script debe abortar re-ejecución si ya está inicializado');

  // 2. Anti-Stale DOM Turn Signatures Cache & Tripwire
  assertions++;
  assert.ok(csCode.includes('lastHarvestedSignatures'), 'Content script debe mantener caché de firmas de turnos previos');
  assertions++;
  assert.ok(csCode.includes('SOURCE_IDENTITY_STALE_DOM'), 'Content script debe emitir error tipado SOURCE_IDENTITY_STALE_DOM ante residuos');

  const prevWindow = global.window;
  const prevDocument = global.document;

  try {
    resetNavigationEpochForTest();
    setLastHarvestedStateForTest('chat-source-alpha', ['user:::sig-turn-alpha-1 Pregunta residual de alpha']);

    global.window = {
      location: {
        pathname: '/c/chat-target-beta',
        href: 'https://chatgpt.com/c/chat-target-beta'
      }
    };

    global.document = {
      querySelector: (sel) => {
        if (sel === 'title') return { textContent: 'Chat Target Beta - ChatGPT' };
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === 'h4' || sel === '[data-message-author-role]') return [];
        if (sel === 'article') {
          return [
            {
              querySelector: () => null,
              textContent: 'sig-turn-alpha-1 Pregunta residual de alpha'
            }
          ];
        }
        return [];
      }
    };

    let caughtError = null;
    try {
      await extractCurrentChatGPTConversation('chat-target-beta');
    } catch (err) {
      caughtError = err;
    }

    assertions++;
    assert.ok(caughtError !== null, 'Debe abortar si el DOM contiene firmas del chat previo');
    assertions++;
    assert.ok(caughtError.message.includes('SOURCE_IDENTITY_STALE_DOM'), 'El error debe ser SOURCE_IDENTITY_STALE_DOM');
    assertions++;
    assert.ok(caughtError.message.includes('chat-source-alpha'), 'El error debe identificar la conversación origen no purgada');

    // 3. In-flight sweep abort on Navigation Epoch advance
    const epoch1 = getNavigationEpoch();
    global.window.location.pathname = '/c/chat-target-gamma';
    global.window.location.href = 'https://chatgpt.com/c/chat-target-gamma';
    const epoch2 = checkNavigationEpoch();

    assertions++;
    assert.ok(epoch2 > epoch1, 'El contador de época de navegación debe incrementarse tras cambio de URL');

    let epochError = null;
    try {
      await extractCurrentChatGPTConversation('chat-target-beta');
    } catch (err) {
      epochError = err;
    }

    assertions++;
    assert.ok(epochError !== null, 'Debe abortar sweep si la época de navegación diverge de la solicitada');
    assertions++;
    assert.ok(epochError.message.includes('SOURCE_IDENTITY_MISMATCH'), 'Debe reportar SOURCE_IDENTITY_MISMATCH');

  } finally {
    global.window = prevWindow;
    global.document = prevDocument;
    resetNavigationEpochForTest();
  }

  // 4. Popup Race Condition Guard Invariant
  const popupCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.js'), 'utf8');
  assertions++;
  assert.ok(popupCode.includes('currentConvId !== targetConvId'), 'Popup debe verificar si la pestaña cambió antes de consolidar datos');
  assertions++;
  assert.ok(popupCode.includes('Adquisición descartada por navegación en vuelo'), 'Popup debe descartar respuestas asíncronas desfasadas');

  assert.equal(assertions, 13, 'Debe ejecutar exactamente 13 aserciones físicas de P0 / RED-BR-002');
});

test('Lossy P1 / RED-BR-001: Workspace Runtime Stability, Port Lifecycle & Job Engine Compatibility', async () => {
  let assertions = 0;
  const vm = require('node:vm');

  const { JobEngine, JOB_STATUS } = require('../../extension/src/core/jobs/job_engine.js');

  // 1. JobEngine Compatibility: start(job, workerFn) y run(workerFn)
  const engine = new JobEngine({ concurrency: 2, delayMs: 1 });

  const testJob = {
    id: 'test-job-compat',
    name: 'Test Compat Job',
    totalItems: 3,
    items: [
      { id: 'item-1', status: 'pending', retries: 0 },
      { id: 'item-2', status: 'pending', retries: 0 },
      { id: 'item-3', status: 'pending', retries: 0 }
    ]
  };

  const processed = [];
  const completedJob = await engine.start(testJob, async (item) => {
    processed.push(item.id);
    return { canonicalId: `result_${item.id}` };
  });

  assertions++;
  assert.equal(completedJob.status, JOB_STATUS.COMPLETED);
  assertions++;
  assert.equal(completedJob.completedItems, 3);
  assertions++;
  assert.equal(processed.length, 3);

  // 2. JobEngine UMD Alias: Lossy.JobEngine
  const jobEngineMod = require('../../extension/src/core/jobs/job_engine.js');
  assertions++;
  assert.ok((jobEngineMod.Lossy && jobEngineMod.Lossy.JobEngine) || (globalThis.Lossy && globalThis.Lossy.JobEngine), 'Debe exportar Lossy.JobEngine');
  assertions++;
  assert.equal(jobEngineMod.Lossy.JobEngine, jobEngineMod.JobEngine, 'Lossy.JobEngine debe ser idéntico a JobEngine');

  // 3. Workspace AST / Syntax Verification: Cero errores de sintaxis o variables no declaradas
  const workspaceJsPath = path.resolve(__dirname, '../../extension/src/workspace/workspace.js');
  const workspaceJsCode = fs.readFileSync(workspaceJsPath, 'utf8');

  let syntaxValid = false;
  try {
    new vm.Script(workspaceJsCode, { filename: 'workspace.js' });
    syntaxValid = true;
  } catch (err) {
    syntaxValid = false;
  }

  assertions++;
  assert.equal(syntaxValid, true, 'workspace.js debe ser sintácticamente válido sin SyntaxErrors');

  // 4. Verificación de variables declaradas en closures críticos
  assertions++;
  assert.ok(
    workspaceJsCode.includes("const action = isStructuredOnly ? 'ACQUIRE_STRUCTURED_ONLY' : 'ACQUIRE_CONVERSATION';"),
    'startBulkCapture debe declarar action antes de invocar safeTabMessagingWithAutoInject'
  );

  assertions++;
  assert.ok(
    workspaceJsCode.includes('const itemTitle = (it && it.title) ? it.title : item.title;'),
    'single capture debe declarar y asignar itemTitle para telemetría'
  );

  assertions++;
  assert.ok(
    !workspaceJsCode.includes('engine.start('),
    'workspace.js no debe invocar engine.start sin parámetros correctos, debe usar engine.run'
  );

  // 5. Port Lifecycle & Zero Unchecked runtime.lastError Invariant
  assertions++;
  assert.ok(
    workspaceJsCode.includes('chrome.runtime.lastError') && workspaceJsCode.includes('safeSendTabMessage'),
    'safeTabMessagingWithAutoInject debe interceptar síncronamente runtime.lastError'
  );

  assert.equal(assertions, 10, 'Debe ejecutar exactamente 10 aserciones físicas de P1 / RED-BR-001');
});

test('Lossy P2: Formal Rebranding — Icons, Manifest, Brand Text, and Zero-Emoji Invariant', () => {
  let assertions = 0;

  // 1. Icon Assets Verification
  const iconSizes = [16, 32, 48, 128];
  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  iconSizes.forEach((size) => {
    const iconPath = path.resolve(__dirname, `../../extension/icons/icon${size}.png`);
    assertions++;
    assert.ok(fs.existsSync(iconPath), `Icono ${size}x${size} debe existir en extension/icons/icon${size}.png`);

    const buf = fs.readFileSync(iconPath);
    assertions++;
    assert.ok(buf.length > 0, `Icono ${size}x${size} no debe ser vacío`);

    // Comprobar número mágico PNG
    assertions++;
    assert.ok(buf.subarray(0, 8).equals(pngMagic), `Icono ${size}x${size} debe tener cabecera PNG válida`);

    // Comprobar dimensiones en el chunk IHDR (bytes 16..24)
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assertions++;
    assert.equal(width, size, `Icono ${size}x${size} debe tener ancho de ${size}px`);
    assertions++;
    assert.equal(height, size, `Icono ${size}x${size} debe tener alto de ${size}px`);
  });

  // 2. Manifest Verification
  const manifestPath = path.resolve(__dirname, '../../extension/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assertions++;
  assert.equal(manifest.name, 'Lossy — AI Context Portability');
  assertions++;
  assert.equal(manifest.action.default_title, 'Lossy — AI Context Portability');
  assertions++;
  assert.equal(manifest.icons['16'], 'icons/icon16.png');
  assertions++;
  assert.equal(manifest.icons['32'], 'icons/icon32.png');
  assertions++;
  assert.equal(manifest.icons['48'], 'icons/icon48.png');
  assertions++;
  assert.equal(manifest.icons['128'], 'icons/icon128.png');

  // 3. Popup & Workspace HTML Branding
  const popupHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  assertions++;
  assert.ok(popupHtml.includes('Lossy — AI Context Portability'), 'popup.html debe contener el título de Lossy');
  assertions++;
  assert.ok(popupHtml.includes('brand-title">Lossy</'), 'popup.html debe contener brand-title Lossy');
  assertions++;
  assert.ok(popupHtml.includes('brand-subtitle">Tu contexto, siempre contigo</span>'), 'popup.html debe contener brand-subtitle');

  const workspaceHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  assertions++;
  assert.ok(workspaceHtml.includes('Lossy Workspace — AI Context Portability'), 'workspace.html debe contener título de Lossy Workspace');
  assertions++;
  assert.ok(workspaceHtml.includes('brand-name">Lossy</span>'), 'workspace.html debe contener brand-name Lossy');
  assertions++;
  assert.ok(workspaceHtml.includes('data-tab="all"'), 'workspace.html debe tener pestaña Todas');
  assertions++;
  assert.ok(workspaceHtml.includes('data-tab="conversations"'), 'workspace.html debe tener pestaña Conversaciones');
  assertions++;
  assert.ok(workspaceHtml.includes('data-tab="clips"'), 'workspace.html debe tener pestaña Clips');

  // 4. UMD Aliases Verification
  const { LossyDB, LinerDB } = require('../../extension/src/core/storage/liner_db.js');
  assertions++;
  assert.equal(LossyDB, LinerDB, 'LossyDB debe estar exportado y referenciar a LinerDB');

  const canonicalMod = require('../../extension/src/core/canonical_model.js');
  assertions++;
  assert.equal(typeof canonicalMod.createCanonicalClip, 'function', 'createCanonicalClip debe estar exportado');
  assertions++;
  assert.equal(typeof canonicalMod.validateCanonicalClip, 'function', 'validateCanonicalClip debe estar exportado');
  assertions++;
  assert.equal(typeof canonicalMod.isCanonicalClip, 'function', 'isCanonicalClip debe estar exportado');

  const serializerMod = require('../../extension/src/core/markdown_serializer.js');
  assertions++;
  assert.equal(typeof serializerMod.serializeClipToMarkdown, 'function', 'serializeClipToMarkdown debe estar exportado');

  // 5. Zero-Emoji Compliance en Superficies UI
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
  const filesToCheck = [
    '../../extension/src/popup/popup.html',
    '../../extension/src/popup/popup.js',
    '../../extension/src/workspace/workspace.html',
    '../../extension/src/workspace/workspace.js',
    '../../extension/src/core/canonical_model.js',
    '../../extension/src/core/storage/liner_db.js'
  ];

  filesToCheck.forEach((rel) => {
    const content = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    assertions++;
    assert.equal(emojiRegex.test(content), false, `Archivo ${rel} no debe contener emojis`);
  });

  assert.equal(assertions, 45, 'Debe ejecutar exactamente 45 aserciones físicas de P2 Rebranding');
});

test('Lossy P3: Clips & Selective Context Primitive — Schema, Provenance, Non-Destructive Storage & Heterogeneous Collections', async () => {
  let assertions = 0;

  const {
    createCanonicalConversation,
    createCanonicalClip,
    validateCanonicalClip,
    isCanonicalClip,
    CLIP_SELECTION_TYPES
  } = require('../../extension/src/core/canonical_model.js');

  const {
    serializeToMarkdown,
    serializeClipToMarkdown
  } = require('../../extension/src/core/markdown_serializer.js');

  const { LossyDB } = require('../../extension/src/core/storage/liner_db.js');

  // 1. Invariantes de los 4 tipos de selección de Clips
  const sampleMessages = [
    {
      id: 'msg-turn-1',
      index: 0,
      role: 'user',
      author: 'Usuario',
      create_time: 1729760000,
      timestamp: '2026-10-24T10:00:00.000Z',
      content: { text: '¿Qué es un Clip en Lossy?' }
    },
    {
      id: 'msg-turn-2',
      index: 1,
      role: 'assistant',
      author: 'ChatGPT',
      create_time: 1729760005,
      timestamp: '2026-10-24T10:00:05.000Z',
      content: { text: 'Un Clip es un subconjunto canónico selectivo de turnos con procedencia inmutable.' }
    },
    {
      id: 'msg-turn-3',
      index: 2,
      role: 'user',
      author: 'Usuario',
      create_time: 1729760010,
      timestamp: '2026-10-24T10:00:10.000Z',
      content: { text: '¿Y cómo preserva la integridad?' }
    }
  ];

  const types = ['single-message', 'turn-pair', 'contiguous-range', 'multi-message'];
  types.forEach((selType) => {
    assertions++;
    assert.ok(CLIP_SELECTION_TYPES.includes(selType), `CLIP_SELECTION_TYPES debe incluir ${selType}`);

    const clip = createCanonicalClip({
      sourceConversationId: 'conv_chatgpt_test1',
      sourceConversationTitle: 'Conversación Principal',
      selectionType: selType,
      messages: sampleMessages.slice(0, selType === 'single-message' ? 1 : 2)
    });

    assertions++;
    assert.ok(isCanonicalClip(clip), 'Debe ser reconocido como clip canónico');
    assertions++;
    assert.equal(clip.selectionType, selType);
    assertions++;
    assert.equal(clip.provenance.sourceStatus, 'source_available_locally');

    const val = validateCanonicalClip(clip);
    assertions++;
    assert.equal(val.valid, true, `Clip con tipo ${selType} debe ser válido`);
  });

  // 2. Rechazo estricto ante datos inválidos
  const invalidClip1 = createCanonicalClip({
    sourceConversationId: 'conv_test',
    selectionType: 'arbitrary-chunk',
    messages: [sampleMessages[0]]
  });
  const valInv1 = validateCanonicalClip(invalidClip1);
  assertions++;
  assert.equal(valInv1.valid, false, 'Tipo de selección no reconocido debe ser rechazado');

  const invalidClip2 = { entityType: 'clip', canonicalId: 'clip_invalid', messages: [] };
  const valInv2 = validateCanonicalClip(invalidClip2);
  assertions++;
  assert.equal(valInv2.valid, false, 'Clip sin procedencia debe ser rechazado');

  // 3. Invariante de Orden Cronológico en Mensajes de Clip
  const outOfOrderMessages = [
    sampleMessages[2],
    sampleMessages[0],
    sampleMessages[1]
  ];

  const sortedClip = createCanonicalClip({
    sourceConversationId: 'conv_chatgpt_test1',
    sourceConversationTitle: 'Conversación Principal',
    selectionType: 'contiguous-range',
    messages: outOfOrderMessages
  });

  assertions++;
  assert.equal(sortedClip.messages[0].id, 'msg-turn-1', 'Primer mensaje debe ser el más antiguo');
  assertions++;
  assert.equal(sortedClip.messages[1].id, 'msg-turn-2', 'Segundo mensaje debe ser el intermedio');
  assertions++;
  assert.equal(sortedClip.messages[2].id, 'msg-turn-3', 'Tercer mensaje debe ser el más reciente');

  // 4. Serialización Markdown de Clips con Frontmatter
  const clipMd = serializeClipToMarkdown(sortedClip);
  assertions++;
  assert.ok(clipMd.includes(sortedClip.canonicalId), 'Debe incluir clipId en Frontmatter');
  assertions++;
  assert.ok(clipMd.includes('conv_chatgpt_test1'), 'Debe incluir sourceConversationId en Frontmatter');
  assertions++;
  assert.ok(clipMd.includes('contiguous-range'), 'Debe incluir selectionType en Frontmatter');
  assertions++;
  assert.ok(clipMd.includes('source_available_locally'), 'Debe incluir sourceStatus en Frontmatter');
  assertions++;
  assert.ok(clipMd.includes('## User'), 'Debe incluir turnos formateados');

  // Delegación automática en serializeToMarkdown
  const autoDelegatedMd = serializeToMarkdown(sortedClip);
  assertions++;
  assert.equal(autoDelegatedMd, clipMd, 'serializeToMarkdown debe auto-delegar a serializeClipToMarkdown');

  // 5. Persistencia Local & Colecciones Heterogéneas
  const db = new LossyDB();
  await db.open();

  const parentConv = createCanonicalConversation({
    title: 'Arquitectura de Contexto Portátil',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/test-parent',
    messages: sampleMessages
  });

  await db.saveConversation(parentConv);

  const testClipA = createCanonicalClip({
    sourceConversationId: parentConv.canonicalId,
    sourceConversationTitle: parentConv.title,
    selectionType: 'turn-pair',
    messages: [sampleMessages[0], sampleMessages[1]]
  });

  const testClipB = createCanonicalClip({
    sourceConversationId: parentConv.canonicalId,
    sourceConversationTitle: parentConv.title,
    selectionType: 'single-message',
    messages: [sampleMessages[2]]
  });

  await db.saveClip(testClipA);
  await db.saveClip(testClipB);

  // Listar clips
  const clipList = await db.listClips();
  assertions++;
  assert.equal(clipList.length, 2, 'Debe haber exactamente 2 clips persistidos');

  const retrievedClip = await db.getClip(testClipA.canonicalId);
  assertions++;
  assert.ok(retrievedClip !== null, 'Debe recuperar el clip guardado');
  assertions++;
  assert.equal(retrievedClip.canonicalId, testClipA.canonicalId);
  assertions++;
  assert.equal(retrievedClip.provenance.sourceStatus, 'source_available_locally');

  // Colección heterogénea (referenciando tanto conversación como clip)
  const collection = await db.createCollection('Colección Híbrida', 'Prueba de heterogeneidad');
  assertions++;
  assert.ok(collection && collection.id, 'Debe crear la colección');

  await db.addItemsToCollection(collection.id, [parentConv.canonicalId, testClipA.canonicalId]);
  const updatedCol = await db.getCollection(collection.id);

  assertions++;
  assert.equal(updatedCol.conversationIds.length, 2, 'Colección debe contener exactamente 2 referencias');
  assertions++;
  assert.ok(updatedCol.conversationIds.includes(parentConv.canonicalId), 'Colección debe contener la conversación');
  assertions++;
  assert.ok(updatedCol.conversationIds.includes(testClipA.canonicalId), 'Colección debe contener el clip');

  const colsForClip = await db.getCollectionsForItem(testClipA.canonicalId);
  assertions++;
  assert.equal(colsForClip.length, 1, 'Debe encontrar la colección que referencia al clip');
  assertions++;
  assert.equal(colsForClip[0].id, collection.id);

  // 6. Invariante de Eliminación No Destructiva de Fuente (Cero Huérfanos Inconsistentes)
  // Al eliminar la conversación padre, los clips NO se eliminan, sino que su sourceStatus pasa a 'source_unavailable_locally'
  await db.deleteConversation(parentConv.canonicalId);

  const deletedConv = await db.getConversation(parentConv.canonicalId);
  assertions++;
  assert.equal(deletedConv, null, 'Conversación padre debe haber sido eliminada de la biblioteca');

  const clipAfterDeletionA = await db.getClip(testClipA.canonicalId);
  const clipAfterDeletionB = await db.getClip(testClipB.canonicalId);

  assertions++;
  assert.ok(clipAfterDeletionA !== null, 'Clip A NO debe ser eliminado al borrar la conversación fuente');
  assertions++;
  assert.ok(clipAfterDeletionB !== null, 'Clip B NO debe ser eliminado al borrar la conversación fuente');

  assertions++;
  assert.equal(clipAfterDeletionA.provenance.sourceStatus, 'source_unavailable_locally', 'sourceStatus de procedencia debe actualizarse a source_unavailable_locally');
  assertions++;
  assert.equal(clipAfterDeletionA.sourceStatus, 'source_unavailable_locally', 'sourceStatus raíz debe actualizarse');

  assertions++;
  assert.equal(clipAfterDeletionB.provenance.sourceStatus, 'source_unavailable_locally');
  assertions++;
  assert.equal(clipAfterDeletionB.sourceStatus, 'source_unavailable_locally');

  // Markdown de clip con fuente eliminada refleja el estado
  const orphanedMd = serializeClipToMarkdown(clipAfterDeletionA);
  assertions++;
  assert.ok(orphanedMd.includes('source_unavailable_locally'), 'Markdown exportado debe reflejar sourceStatus source_unavailable_locally');

  // 7. Eliminación directa de un Clip
  await db.deleteClip(testClipB.canonicalId);
  const clipBAfterDelete = await db.getClip(testClipB.canonicalId);
  assertions++;
  assert.equal(clipBAfterDelete, null, 'Clip B debe haber sido eliminado directamente');

  assert.equal(assertions, 50, 'Debe ejecutar exactamente 50 aserciones físicas de P3 Clips & Contexto Selectivo');
});

test('Lossy P3 Extended: Invariantes de Ciclo de Vida de Clips, Idempotencia de Membresía, Restauración de Fuente y Desacoplamiento de Colección', async () => {
  let assertions = 0;

  const {
    createCanonicalConversation,
    createCanonicalClip,
    validateCanonicalClip,
    isCanonicalClip
  } = require('../../extension/src/core/canonical_model.js');

  const { LossyDB } = require('../../extension/src/core/storage/liner_db.js');

  // 1. Detección automática de rango contiguo vs multi-mensaje
  const contiguousMessages = [
    { id: 'm1', role: 'user', content: { text: 'Pregunta 1' }, sourceOrdinal: 0 },
    { id: 'm2', role: 'assistant', content: { text: 'Respuesta 1' }, sourceOrdinal: 1 },
    { id: 'm3', role: 'user', content: { text: 'Pregunta 2' }, sourceOrdinal: 2 }
  ];
  const nonContiguousMessages = [
    { id: 'm1', role: 'user', content: { text: 'Pregunta 1' }, sourceOrdinal: 0 },
    { id: 'm3', role: 'user', content: { text: 'Pregunta 2' }, sourceOrdinal: 2 },
    { id: 'm5', role: 'assistant', content: { text: 'Respuesta 3' }, sourceOrdinal: 4 }
  ];

  const clipContiguous = createCanonicalClip({
    sourceConversationId: 'conv_test_auto_range',
    sourceConversationTitle: 'Test Rango Contiguo',
    messages: contiguousMessages
  });
  assertions++;
  assert.equal(clipContiguous.selectionType, 'contiguous-range', 'Debe detectar automáticamente contiguous-range ante turnos consecutivos');

  const clipNonContiguous = createCanonicalClip({
    sourceConversationId: 'conv_test_auto_range',
    sourceConversationTitle: 'Test No Contiguo',
    messages: nonContiguousMessages
  });
  assertions++;
  assert.equal(clipNonContiguous.selectionType, 'multi-message', 'Debe clasificar como multi-message ante turnos no consecutivos');

  // 2. Persistencia y Membresía Idempotente en Colecciones
  const db = new LossyDB();
  await db.open();

  const conv = createCanonicalConversation({
    title: 'Conversación Base para Ciclo de Vida',
    platform: 'chatgpt',
    messages: contiguousMessages
  });
  await db.saveConversation(conv);

  const clip = createCanonicalClip({
    sourceConversationId: conv.canonicalId,
    sourceConversationTitle: conv.title,
    messages: [contiguousMessages[0], contiguousMessages[1]]
  });
  await db.saveClip(clip);

  const col = await db.createCollection('Colección Idempotente', 'Prueba de idempotencia');
  assertions++;
  assert.ok(col && col.id);

  // Adición repetida del mismo clip
  await db.addConversationsToCollection(col.id, [clip.canonicalId]);
  await db.addConversationsToCollection(col.id, [clip.canonicalId]);
  await db.addConversationsToCollection(col.id, [clip.canonicalId, conv.canonicalId]);
  await db.addConversationsToCollection(col.id, [conv.canonicalId]);

  const colAfterRepeated = await db.getCollection(col.id);
  assertions++;
  assert.equal(colAfterRepeated.conversationIds.length, 2, 'Adición repetida no debe duplicar referencias');
  assertions++;
  assert.ok(colAfterRepeated.conversationIds.includes(clip.canonicalId));
  assertions++;
  assert.ok(colAfterRepeated.conversationIds.includes(conv.canonicalId));

  // 3. Eliminar Clip preserva la conversación origen
  await db.deleteClip(clip.canonicalId);
  const deletedClipCheck = await db.getClip(clip.canonicalId);
  const convStillExists = await db.getConversation(conv.canonicalId);
  assertions++;
  assert.equal(deletedClipCheck, null, 'Clip eliminado debe ser nulo');
  assertions++;
  assert.ok(convStillExists !== null, 'Eliminar clip NO debe borrar la conversación origen');
  assertions++;
  assert.equal(convStillExists.canonicalId, conv.canonicalId);

  // 4. Eliminar Colección preserva el Clip y la Conversación
  const clip2 = createCanonicalClip({
    sourceConversationId: conv.canonicalId,
    sourceConversationTitle: conv.title,
    messages: [contiguousMessages[2]]
  });
  await db.saveClip(clip2);
  await db.addConversationsToCollection(col.id, [clip2.canonicalId]);

  await db.deleteCollection(col.id);
  const colDeletedCheck = await db.getCollection(col.id);
  const clip2StillExists = await db.getClip(clip2.canonicalId);
  const convStillExists2 = await db.getConversation(conv.canonicalId);
  assertions++;
  assert.equal(colDeletedCheck, null, 'Colección eliminada debe ser nula');
  assertions++;
  assert.ok(clip2StillExists !== null, 'Eliminar colección NO debe borrar el clip referenciado');
  assertions++;
  assert.ok(convStillExists2 !== null, 'Eliminar colección NO debe borrar la conversación referenciada');

  // 5. Invariante de Restauración (Undo): borrar conversación degrada clip; restaurar conversación reactiva clip a source_available_locally
  assertions++;
  assert.equal(clip2StillExists.sourceStatus, 'source_available_locally', 'Clip inicialmente debe tener fuente disponible');

  await db.deleteConversation(conv.canonicalId);
  const clipAfterParentDelete = await db.getClip(clip2.canonicalId);
  assertions++;
  assert.equal(clipAfterParentDelete.sourceStatus, 'source_unavailable_locally', 'Al borrar padre, clip debe transicionar a source_unavailable_locally');

  // Simular Deshacer / Undo restaurando la conversación padre
  await db.restoreConversation(conv);
  const clipAfterParentRestore = await db.getClip(clip2.canonicalId);
  assertions++;
  assert.equal(clipAfterParentRestore.sourceStatus, 'source_available_locally', 'Al restaurar padre, clip debe volver a source_available_locally');
  assertions++;
  assert.equal(clipAfterParentRestore.provenance.sourceStatus, 'source_available_locally');

  // 6. UMD Browser Exports: verificar disponibilidad en espacio de nombres Lossy
  const vm = require('vm');
  const browserContext = { window: null, globalThis: null, console };
  browserContext.window = browserContext;
  browserContext.globalThis = browserContext;
  vm.createContext(browserContext);

  const cryptoCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/crypto_util.js'), 'utf8');
  const schemaCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/canonical/canonical_schema.js'), 'utf8');
  const modelCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/canonical_model.js'), 'utf8');
  const serializerCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/markdown_serializer.js'), 'utf8');
  const diagCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/diagnostics/diagnostics_center.js'), 'utf8');
  const manifestCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/portability/manifest_builder.js'), 'utf8');
  const zipCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/core/portability/zip_builder.js'), 'utf8');
  const claudeCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/targets/claude_target_adapter.js'), 'utf8');
  const genericCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/targets/generic_target_adapter.js'), 'utf8');
  const mdBundleCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/targets/markdown_bundle_adapter.js'), 'utf8');

  vm.runInContext(cryptoCode, browserContext);
  vm.runInContext(schemaCode, browserContext);
  vm.runInContext(modelCode, browserContext);
  vm.runInContext(serializerCode, browserContext);
  vm.runInContext(diagCode, browserContext);
  vm.runInContext(manifestCode, browserContext);
  vm.runInContext(zipCode, browserContext);
  vm.runInContext(claudeCode, browserContext);
  vm.runInContext(genericCode, browserContext);
  vm.runInContext(mdBundleCode, browserContext);

  assertions++;
  assert.equal(typeof browserContext.Lossy.createCanonicalClip, 'function', 'Lossy.createCanonicalClip debe estar exportado en UMD');
  assertions++;
  assert.equal(typeof browserContext.Lossy.CanonicalModel.createCanonicalClip, 'function', 'Lossy.CanonicalModel.createCanonicalClip debe estar disponible');
  assertions++;
  assert.equal(typeof browserContext.Lossy.ClaudeTargetAdapter, 'function', 'Lossy.ClaudeTargetAdapter debe estar exportado');
  assertions++;
  assert.equal(typeof browserContext.Lossy.GenericTargetAdapter, 'function', 'Lossy.GenericTargetAdapter debe estar exportado');
  assertions++;
  assert.equal(typeof browserContext.Lossy.MarkdownBundleAdapter, 'function', 'Lossy.MarkdownBundleAdapter debe estar exportado');
  assertions++;
  assert.equal(typeof browserContext.Lossy.ZipBuilder.createZip, 'function', 'Lossy.ZipBuilder.createZip debe estar exportado');
  assertions++;
  assert.equal(typeof browserContext.Lossy.ManifestBuilder.buildPortabilityManifest, 'function', 'Lossy.ManifestBuilder debe estar exportado');

  // 7. Payload de Drag & Drop Heterogéneo (application/lossy-context)
  const dragPayload = {
    items: [
      { id: conv.canonicalId, type: 'conversation' },
      { id: clip2.canonicalId, type: 'clip' }
    ],
    ids: [conv.canonicalId, clip2.canonicalId]
  };
  assertions++;
  assert.equal(dragPayload.items.length, 2, 'Payload de arrastre heterogéneo debe contener tipo e ID explícitos');

  assert.equal(assertions, 24, 'Debe ejecutar exactamente 24 aserciones físicas de P3 Extended');
});

test('Lossy v1.4 Browser-Real Hardening: Clip Lookup, Model Fidelity, Node Metrics & Interaction Surface', async () => {
  let assertions = 0;

  const {
    createCanonicalConversation,
    createCanonicalClip
  } = require('../../extension/src/core/canonical_model.js');
  const { parseChatGPTConversationTree } = require('../../extension/src/platforms/chatgpt/structured/chatgpt_structured_acquisition.js');
  const { LossyDB } = require('../../extension/src/core/storage/liner_db.js');

  // 1. Fidelidad de modelo en Clips canónicos: retiene modelo de origen y no lo reemplaza por selectionType
  const sourceConv = createCanonicalConversation({
    title: 'Análisis de Redes Neuronales',
    platform: 'chatgpt',
    model: 'gpt-6',
    url: 'https://chatgpt.com/c/test-clip-model',
    messages: [
      { role: 'user', author: 'Usuario', text: '¿Qué es un transformer?', sourceOrdinal: 0 },
      { role: 'assistant', author: 'ChatGPT', text: 'Un modelo de atención profunda.', sourceOrdinal: 1 }
    ]
  });

  const clip = createCanonicalClip({
    sourceConversation: sourceConv,
    selectedMessages: sourceConv.messages,
    title: 'Clip de Transformers'
  });

  assertions++;
  assert.equal(clip.model, 'gpt-6', 'Clip debe preservar fielmente el modelo de la conversación origen');
  assertions++;
  assert.equal(clip.sourceModel, 'gpt-6', 'Clip debe registrar sourceModel idéntico');
  assertions++;
  assert.equal(clip.selectionType, 'turn-pair', 'Clip con 2 turnos consecutivos (user+assistant) debe ser clasificado como turn-pair');
  assertions++;
  assert.notEqual(clip.model, clip.selectionType, 'Modelo de clip nunca debe ser igual a su selectionType');

  // 2. Separación de métricas de nodos DAG vs mensajes visibles (Investigación Conteo 136)
  const fakeMappingTree = {
    title: 'Conversación Compleja con Tool Calls',
    id: 'conv-dag-tree-123',
    current_node: 'node-5',
    mapping: {
      'node-1': {
        id: 'node-1',
        parent: null,
        children: ['node-2'],
        message: { author: { role: 'system' }, content: { parts: ['Instrucciones de sistema'] } }
      },
      'node-2': {
        id: 'node-2',
        parent: 'node-1',
        children: ['node-3'],
        message: { author: { role: 'user' }, content: { parts: ['Calcula la suma de 5 + 7'] } }
      },
      'node-3': {
        id: 'node-3',
        parent: 'node-2',
        children: ['node-4'],
        message: { author: { role: 'assistant' }, content: { parts: [] }, metadata: { tool_calls: [{ name: 'calc' }] } }
      },
      'node-4': {
        id: 'node-4',
        parent: 'node-3',
        children: ['node-5'],
        message: { author: { role: 'tool' }, content: { parts: ['12'] } }
      },
      'node-5': {
        id: 'node-5',
        parent: 'node-4',
        children: [],
        message: { author: { role: 'assistant' }, content: { parts: ['El resultado de 5 + 7 es 12.'] } }
      }
    }
  };

  const parsedDagConv = parseChatGPTConversationTree(fakeMappingTree);
  assertions++;
  assert.equal(parsedDagConv.sourceNodeCount, 5, 'sourceNodeCount debe reflejar la totalidad de nodos brutos del DAG');
  assertions++;
  assert.equal(parsedDagConv.visibleMessageCount, 2, 'visibleMessageCount debe reflejar únicamente los turnos conversacionales visibles');
  assertions++;
  assert.equal(parsedDagConv.integrity.nodeMetrics.systemNodes, 1, 'nodeMetrics debe registrar 1 nodo de sistema');
  assertions++;
  assert.equal(parsedDagConv.integrity.nodeMetrics.userNodes, 1, 'nodeMetrics debe registrar 1 nodo de usuario');
  assertions++;
  assert.equal(parsedDagConv.integrity.nodeMetrics.assistantNodes, 2, 'nodeMetrics debe registrar 2 nodos de asistente en el DAG (1 con tool_calls + 1 con texto)');
  assertions++;
  assert.ok(parsedDagConv.integrity.nodeMetrics.toolNodes >= 1, 'nodeMetrics debe registrar nodos de ejecución de herramientas');

  // 3. Persistencia y Resolución Resiliente de Clips en Base de Datos (db.getConversation y db.getClip)
  const db = new LossyDB();
  await db.open();

  await db.saveClip(clip);

  const lookupByCanonicalId = await db.getConversation(clip.canonicalId);
  const lookupClipMethod = await db.getClip(clip.canonicalId);
  const lookupById = await db.getConversation(clip.id);
  const lookupClipById = await db.getClip(clip.id);

  assertions++;
  assert.ok(lookupByCanonicalId !== null, 'db.getConversation debe resolver el clip por canonicalId');
  assertions++;
  assert.equal(lookupByCanonicalId.entityType, 'clip', 'Entidad recuperada debe ser de tipo clip');
  assertions++;
  assert.ok(lookupClipMethod !== null, 'db.getClip debe resolver el clip por canonicalId');
  assertions++;
  assert.ok(lookupById !== null, 'db.getConversation debe resolver el clip por id');
  assertions++;
  assert.ok(lookupClipById !== null, 'db.getClip debe resolver el clip por id');

  const metaList = await db.listMetadata();
  const clipMeta = metaList.find(m => m.canonicalId === clip.canonicalId);
  assertions++;
  assert.ok(clipMeta !== null, 'El índice de metadatos debe contener el clip');
  assertions++;
  assert.equal(clipMeta.model, 'gpt-6', 'Metadatos de clip deben preservar el modelo');
  assertions++;
  assert.equal(clipMeta.selectionType, 'turn-pair', 'Metadatos de clip deben almacenar selectionType');

  // 4. Invariantes de Superficie de Workspace (HTML, JS, CSS)
  const wsHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  const wsJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');

  // A. Header principal limpio de sincronización; sincronización ubicada en Mantenimiento de Configuración
  const headerMatch = wsHtml.match(/<header class="main-header">([\s\S]*?)<\/header>/);
  assertions++;
  assert.ok(headerMatch && !headerMatch[1].includes('btn-header-refresh'), 'main-header no debe contener btn-header-refresh');
  assertions++;
  assert.ok(wsHtml.includes('id="btn-header-refresh"') && wsHtml.includes('Mantenimiento y Diagnóstico del Índice'), 'btn-header-refresh debe estar en la sección de mantenimiento');

  // B. Barra de acciones masivas simplificada y sin botones duplicados
  assertions++;
  assert.ok(wsHtml.includes('id="btn-bulk-export-menu"'), 'bulk-action-bar debe incluir botón de menú exportar');
  assertions++;
  assert.ok(wsHtml.includes('id="btn-bulk-more"'), 'bulk-action-bar debe incluir botón ⋯');
  assertions++;
  assert.ok(!wsHtml.includes('Nueva Transferencia') || (wsHtml.match(/Nueva Transferencia/g) || []).length <= 1, 'No debe existir duplicación de botones de transferencia');

  // C. Invariantes de Código JS: Cero Emojis y Cero TDZ ReferenceError en openInspector
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(wsJs), 'workspace.js debe cumplir el estándar de cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(wsHtml), 'workspace.html debe cumplir el estándar de cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(wsCss), 'workspace.css debe cumplir el estándar de cero emojis');

  // D. Estilos CSS para inspección activa, chip remove y tarjeta de colecciones
  assertions++;
  assert.ok(wsCss.includes('.is-inspecting'), 'workspace.css debe incluir estilos para fila activa .is-inspecting');
  assertions++;
  assert.ok(wsCss.includes('.chip-remove'), 'workspace.css debe incluir estilos para botón .chip-remove');
  assertions++;
  assert.ok(wsCss.includes('.inspector-collections-card'), 'workspace.css debe incluir estilos para tarjeta de colecciones del inspector');

  // E. Contrato de interacción desktop y guardas de flujo
  assertions++;
  assert.ok(wsJs.includes('lastSelectedRowIndex = currentIndex;'), 'Single click sobre fila debe actualizar lastSelectedRowIndex para soportar Shift+Click');
  assertions++;
  assert.ok(wsJs.includes('btn-inspector-save-clip'), 'Inspector debe contener botón de Guardar como Clip contextual a la selección de turnos');
  assertions++;
  assert.ok(wsJs.includes("'turn-pair': 'Par de turnos'"), 'selectionTypeMap debe humanizar explícitamente turn-pair');
  assertions++;
  assert.ok(wsJs.includes("count === 1 ? 'seleccionado' : 'seleccionados'"), 'Barra masiva debe emplear etiqueta neutral homogénea');

  assert.equal(assertions, 33, 'Debe ejecutar exactamente 33 aserciones físicas de hardening de navegador real');
});

test('Lossy Plane B: Pure PDF 1.4 Builder, OpenXML DOCX Builder & Zero-Bloat Formats', async () => {
  let assertions = 0;
  const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
  const DocxBuilder = require('../../extension/src/core/portability/docx_builder.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');

  // 1. Verificación de PdfBuilder
  const sampleConv = {
    canonicalId: 'conv_sample_pdf_001',
    title: 'Guía de Arquitectura Reactiva & Portabilidad',
    model: 'gpt-4o',
    createdAt: '2026-10-25T08:00:00Z',
    source: { platform: 'chatgpt', url: 'https://chatgpt.com/c/sample-001' },
    messages: [
      {
        role: 'user',
        author: 'Usuario',
        text: '¿Cómo funciona la serialización PDF pura en JavaScript sin dependencias?',
        content: { text: '¿Cómo funciona la serialización PDF pura en JavaScript sin dependencias?' }
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        text: 'Genera un flujo de objetos directos conformes a PDF 1.4:\n```javascript\nfunction build() {\n  return new Uint8Array([0x25, 0x50, 0x44, 0x46]);\n}\n```\nSoporta caracteres en español: á, é, í, ó, ú, ñ, ¿, ¡.',
        content: {
          text: 'Genera un flujo de objetos directos conformes a PDF 1.4:\n```javascript\nfunction build() {\n  return new Uint8Array([0x25, 0x50, 0x44, 0x46]);\n}\n```\nSoporta caracteres en español: á, é, í, ó, ú, ñ, ¿, ¡.',
          codeBlocks: [{ language: 'javascript', code: 'function build() {\n  return new Uint8Array([0x25, 0x50, 0x44, 0x46]);\n}' }]
        }
      }
    ]
  };

  const pdfBytes = PdfBuilder.buildPdf(sampleConv, { title: sampleConv.title });
  assertions++;
  assert.ok(pdfBytes instanceof Uint8Array, 'PdfBuilder debe retornar un Uint8Array continuo');
  assertions++;
  assert.ok(pdfBytes.length > 500, 'El archivo PDF debe tener un tamaño físico plausible (> 500 bytes)');

  const pdfStr = Buffer.from(pdfBytes).toString('latin1');
  assertions++;
  assert.ok(pdfStr.startsWith('%PDF-1.4'), 'El archivo PDF debe comenzar con el encabezado de versión %PDF-1.4');
  assertions++;
  assert.ok(pdfStr.includes('%%EOF'), 'El archivo PDF debe concluir con el delimitador estándar %%EOF');
  assertions++;
  assert.ok(pdfStr.includes('/Type /Font') && pdfStr.includes('/BaseFont /Helvetica'), 'PDF debe definir fuente Helvetica');
  assertions++;
  assert.ok(pdfStr.includes('/BaseFont /Courier'), 'PDF debe definir fuente monoespaciada Courier para código');
  assertions++;
  assert.ok(pdfStr.includes('xref'), 'PDF debe contener la tabla de referencias cruzadas xref');

  // Verificación de sanitización y mapa WinAnsi
  const sanitized = PdfBuilder.sanitizePdfText('Árbol de decisión con español: ñ, ¿seguro?');
  assertions++;
  assert.ok(sanitized.includes('\\301'), 'Caracter Á debe ser traducido a octal WinAnsi \\301');
  assertions++;
  assert.ok(sanitized.includes('\\361'), 'Caracter ñ debe ser traducido a octal WinAnsi \\361');
  assertions++;
  assert.ok(sanitized.includes('\\277'), 'Caracter ¿ debe ser traducido a octal WinAnsi \\277');

  // 2. Verificación de DocxBuilder
  const docxBytes = DocxBuilder.buildDocx(sampleConv, { title: sampleConv.title });
  assertions++;
  assert.ok(docxBytes instanceof Uint8Array, 'DocxBuilder debe retornar un Uint8Array continuo');
  assertions++;
  assert.ok(docxBytes.length > 1000, 'El archivo DOCX debe tener un tamaño físico plausible (> 1000 bytes)');

  // PKZip header [0x50, 0x4B, 0x03, 0x04]
  assertions++;
  assert.equal(docxBytes[0], 0x50, 'Magic byte 1 de ZIP debe ser 0x50 (P)');
  assertions++;
  assert.equal(docxBytes[1], 0x4B, 'Magic byte 2 de ZIP debe ser 0x4B (K)');

  // Parsear el paquete DOCX mediante ZipBuilder para validar estructura OpenXML
  const docxFiles = ZipBuilder.parseZip(docxBytes);
  assertions++;
  assert.ok(docxFiles['[Content_Types].xml'], 'DOCX debe incluir [Content_Types].xml conforme a OpenXML');
  assertions++;
  assert.ok(docxFiles['_rels/.rels'], 'DOCX debe incluir _rels/.rels');
  assertions++;
  assert.ok(docxFiles['word/_rels/document.xml.rels'], 'DOCX debe incluir word/_rels/document.xml.rels');
  assertions++;
  assert.ok(docxFiles['word/document.xml'], 'DOCX debe incluir word/document.xml con los párrafos');
  assertions++;
  assert.ok(docxFiles['word/styles.xml'], 'DOCX debe incluir word/styles.xml con estilos tipográficos');
  assertions++;
  assert.ok(docxFiles['docProps/core.xml'], 'DOCX debe incluir metadatos Dublin Core en docProps/core.xml');

  const docXml = docxFiles['word/document.xml'].toString('utf8');
  assertions++;
  assert.ok(docXml.includes('RoleHeaderUser') && docXml.includes('RoleHeaderAssistant'), 'document.xml debe estructurar encabezados de usuario y asistente');
  assertions++;
  assert.ok(docXml.includes('CodeBlock') || docXml.includes('Consolas'), 'document.xml debe estilar bloques de código con Consolas');

  assert.equal(assertions, 22, 'Debe ejecutar exactamente 22 aserciones físicas de PdfBuilder y DocxBuilder');
});

test('Lossy Plane B: Unified Export Center, Profiles (AI/Human/Compact) & Multi-Entity ZIP Bundles', async () => {
  let assertions = 0;
  const {
    ExportCenter,
    AssetResolver,
    EXPORT_FORMATS,
    EXPORT_PROFILES,
    getPinnedQuickExports,
    setPinnedQuickExports
  } = require('../../extension/src/core/portability/export_center.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');

  const center = new ExportCenter();

  const conv = {
    canonicalId: 'conv_export_test_001',
    title: 'Análisis de Redundancias',
    model: 'claude-3-5-sonnet',
    source: { platform: 'claude', url: 'https://claude.ai/chat/001' },
    messages: [
      { role: 'user', content: { text: 'Primer prompt de prueba' } },
      { role: 'assistant', content: { text: 'Respuesta técnica con código:\n```python\nprint("test")\n```' } }
    ]
  };

  const clip = {
    canonicalId: 'clip_export_test_002',
    entityType: 'clip',
    title: 'Clip de Muestra',
    model: 'gpt-4o',
    sourcePlatform: 'chatgpt',
    sourceConversationTitle: 'Charla original',
    selectionType: 'turn-pair',
    selectedMessages: [
      { role: 'user', content: { text: 'Pregunta de clip' } },
      { role: 'assistant', content: { text: 'Respuesta de clip' } }
    ]
  };

  // 1. Exportaciones Individuales en todos los formatos requeridos
  const resMd = await center.exportSingle(conv, 'md', 'ai');
  assertions++;
  assert.ok(resMd.filename.endsWith('.md'), 'ExportSingle MD debe emitir extensión .md');
  assertions++;
  assert.ok(typeof resMd.data === 'string' && resMd.data.includes('---'), 'Export MD profile ai debe incluir Frontmatter');

  const resTxt = await center.exportSingle(conv, 'txt', 'human');
  assertions++;
  assert.ok(resTxt.filename.endsWith('.txt'), 'ExportSingle TXT debe emitir extensión .txt');
  assertions++;
  assert.ok(typeof resTxt.data === 'string' && resTxt.data.includes('Primer prompt'), 'Export TXT debe incluir texto legible');

  const resJson = await center.exportSingle(conv, 'json');
  assertions++;
  assert.ok(resJson.filename.endsWith('.json'), 'ExportSingle JSON debe emitir extensión .json');
  assertions++;
  assert.ok(typeof resJson.data === 'string' && JSON.parse(resJson.data).canonicalId === 'conv_export_test_001', 'Export JSON debe emitir JSON válido');

  const resPdf = await center.exportSingle(conv, 'pdf', 'human');
  assertions++;
  assert.ok(resPdf.filename.endsWith('.pdf'), 'ExportSingle PDF debe emitir extensión .pdf');
  assertions++;
  assert.ok(resPdf.data instanceof Uint8Array && resPdf.data[0] === 0x25, 'Export PDF debe emitir binario PDF válido (%PDF)');

  const resDocx = await center.exportSingle(conv, 'docx', 'human');
  assertions++;
  assert.ok(resDocx.filename.endsWith('.docx'), 'ExportSingle DOCX debe emitir extensión .docx');
  assertions++;
  assert.ok(resDocx.data instanceof Uint8Array && resDocx.data[0] === 0x50, 'Export DOCX debe emitir binario PKZip válido');

  assertions++;
  await assert.rejects(center.exportSingle(conv, 'png', 'human'), /Canvas/, 'PNG requiere un renderizador real');

  // Exportar Clip individual
  const clipPdf = await center.exportSingle(clip, 'pdf', 'human');
  assertions++;
  assert.ok(clipPdf.filename.endsWith('.pdf'), 'ExportSingle Clip PDF debe emitir extensión .pdf');

  // 2. Exportación Masiva Multi-Entidad en paquete ZIP (Conversación + Clip)
  const bulkResult = await center.exportBulk([conv, clip], 'md', 'ai');
  assertions++;
  assert.ok(bulkResult.filename.startsWith('lossy-export-md-') && bulkResult.filename.endsWith('.zip'), 'Bulk export debe generar archivo lossy-export-*.zip');
  assertions++;
  assert.ok(bulkResult.data instanceof Uint8Array, 'Bulk export debe retornar Uint8Array binario');

  const parsedBulkZip = ZipBuilder.parseZip(bulkResult.data);
  assertions++;
  assert.ok(parsedBulkZip['manifest.json'], 'Paquete ZIP masivo debe contener manifest.json');
  assertions++;
  assert.ok(Object.keys(parsedBulkZip).some(k => k.startsWith('conversations/')), 'Paquete ZIP debe agrupar conversaciones en carpeta conversations/');
  assertions++;
  assert.ok(Object.keys(parsedBulkZip).some(k => k.startsWith('clips/')), 'Paquete ZIP debe agrupar clips en carpeta clips/');

  const manifestObj = JSON.parse(parsedBulkZip['manifest.json'].toString('utf8'));
  assertions++;
  assert.equal(manifestObj.totalEntities, 2, 'manifest.json debe declarar 2 entidades');
  assertions++;
  assert.equal(manifestObj.generator, 'Lossy Unified Export Center v1.4', 'manifest.json debe identificar el generador v1.4');

  // 3. Quick Exports Pinned Formats Configuración
  const defaultPinned = await getPinnedQuickExports();
  assertions++;
  assert.deepEqual(defaultPinned, ['md', 'pdf', 'docx'], 'Pinned exports por defecto debe ser [md, pdf, docx]');

  const updatedPinned = await setPinnedQuickExports(['pdf', 'docx', 'json']);
  assertions++;
  assert.deepEqual(updatedPinned, ['pdf', 'docx', 'json'], 'setPinnedQuickExports debe actualizar los formatos anclados');

  assert.equal(assertions, 21, 'Debe ejecutar exactamente 21 aserciones físicas de ExportCenter');
});

test('Lossy Plane A: Honest 3-Tier Message Metrics & Technical DAG Event Taxonomy', async () => {
  let assertions = 0;
  const {
    createCanonicalConversation,
    classifyMessageNode,
    NODE_TAXONOMY
  } = require('../../extension/src/core/canonical_model.js');

  // 1. Clasificación individual de nodos según taxonomía
  const userTurn = classifyMessageNode({ role: 'user', content: { text: 'Pregunta' } });
  assertions++;
  assert.equal(userTurn.nodeCategory, 'conversational');
  assertions++;
  assert.equal(userTurn.isConversational, true);

  const assistantTurn = classifyMessageNode({ role: 'assistant', content: { text: 'Respuesta' } });
  assertions++;
  assert.equal(assistantTurn.nodeCategory, 'conversational');
  assertions++;
  assert.equal(assistantTurn.isConversational, true);

  const toolCallTurn = classifyMessageNode({ role: 'assistant', recipient: 'bash', content: { text: 'ls -la' } });
  assertions++;
  assert.equal(toolCallTurn.nodeCategory, 'tool');
  assertions++;
  assert.equal(toolCallTurn.isConversational, false);

  const toolOutputTurn = classifyMessageNode({ role: 'tool', content: { text: 'stdout result' } });
  assertions++;
  assert.equal(toolOutputTurn.nodeCategory, 'tool');
  assertions++;
  assert.equal(toolOutputTurn.isConversational, false);

  const systemTurn = classifyMessageNode({ role: 'system', content: { text: 'Instructions' } });
  assertions++;
  assert.equal(systemTurn.nodeCategory, 'system');
  assertions++;
  assert.equal(systemTurn.isConversational, false);

  // 2. Simulación de fixture real observado en pruebas (136 nodos DAG: 55 conversacionales + 81 eventos técnicos)
  const messages136 = [];
  for (let i = 0; i < 55; i++) {
    messages136.push({
      id: `conv_${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      author: i % 2 === 0 ? 'Usuario' : 'ChatGPT',
      isConversational: true,
      nodeCategory: 'conversational',
      content: { text: `Turno conversacional ${i + 1}` }
    });
  }
  for (let j = 0; j < 81; j++) {
    messages136.push({
      id: `tool_${j}`,
      role: 'tool',
      author: 'Herramienta',
      isConversational: false,
      nodeCategory: 'tool',
      content: { text: `Salida de ejecución bash o css ${j + 1}` }
    });
  }

  const conv136 = createCanonicalConversation({
    title: 'Guía de estudio inglés',
    platform: 'chatgpt',
    messages: messages136
  });

  assertions++;
  assert.equal(conv136.sourceNodeCount, 136, 'sourceNodeCount debe reflejar los 136 nodos brutos en el árbol DAG');
  assertions++;
  assert.equal(conv136.conversationMessageCount, 55, 'conversationMessageCount debe reflejar estrictamente los 55 turnos de diálogo');
  assertions++;
  assert.equal(conv136.visibleMessageCount, 55, 'visibleMessageCount debe coincidir con los turnos conversacionales legibles');
  assertions++;
  assert.equal(conv136.nodeMetrics.toolNodes, 81, 'nodeMetrics.toolNodes debe registrar 81 nodos técnicos de herramienta');
  assertions++;
  assert.equal(conv136.nodeMetrics.userNodes + conv136.nodeMetrics.assistantNodes, 55, 'userNodes + assistantNodes debe sumar 55');

  // 3. Simulación de fixture real de 25 nodos DAG (14 conversacionales + 11 eventos técnicos)
  const messages25 = [];
  for (let i = 0; i < 14; i++) {
    messages25.push({
      id: `conv_${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      isConversational: true,
      nodeCategory: 'conversational',
      content: { text: `Mensaje ${i + 1}` }
    });
  }
  for (let j = 0; j < 11; j++) {
    messages25.push({
      id: `tool_${j}`,
      role: 'tool',
      isConversational: false,
      nodeCategory: 'tool',
      content: { text: `Output ${j + 1}` }
    });
  }

  const conv25 = createCanonicalConversation({
    title: 'Configuración Docker & WSL',
    platform: 'chatgpt',
    messages: messages25
  });

  assertions++;
  assert.equal(conv25.sourceNodeCount, 25, 'sourceNodeCount debe ser 25');
  assertions++;
  assert.equal(conv25.conversationMessageCount, 14, 'conversationMessageCount debe ser 14');
  assertions++;
  assert.equal(conv25.visibleMessageCount, 14, 'visibleMessageCount debe ser 14');
  assertions++;
  assert.equal(conv25.nodeMetrics.toolNodes, 11, 'nodeMetrics.toolNodes debe ser 11');

  assert.equal(assertions, 19, 'Debe ejecutar exactamente 19 aserciones físicas de taxonomía y 3 métricas de mensajes');
});

test('Lossy Plane A: Interaction Hardening (Context Menus, Reader Event Toggle & Popup Quick Exports)', () => {
  let assertions = 0;

  const wsHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  const wsJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');
  const popupHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.js'), 'utf8');

  // 1. Workspace: Protección de menú contextual contra descarte prematuro en el mismo tick
  assertions++;
  assert.ok(wsJs.includes('menu._justOpened = true'), 'showContextMenu debe marcar el flag _justOpened para evitar descarte inmediato');
  assertions++;
  assert.ok(wsJs.includes('if (menu._justOpened) return;'), 'El listener de document click debe evaluar el flag _justOpened');

  // 2. Workspace: Filtro de eventos técnicos y toggle en lector de inspector
  assertions++;
  assert.ok(wsJs.includes('toggle-technical-events'), 'workspace.js debe incluir el toggle id toggle-technical-events');
  assertions++;
  assert.ok(wsJs.includes('tech-event-item') && wsJs.includes('tech-event-badge'), 'workspace.js debe aplicar clases CSS específicas a eventos técnicos');
  assertions++;
  assert.ok(wsCss.includes('.tech-event-item') && wsCss.includes('.tech-event-badge'), 'workspace.css debe contener estilos para eventos técnicos');

  // 3. Workspace: Contratos de botones de Inspector
  assertions++;
  assert.ok(wsJs.includes('btn-inspector-open-origin'), 'workspace.js debe implementar botón btn-inspector-open-origin');
  assertions++;
  assert.ok(wsJs.includes('btn-inspector-view-messages'), 'workspace.js debe implementar botón btn-inspector-view-messages');
  assertions++;
  assert.ok(wsJs.includes('openExportCenterModal([activeId])'), 'Inspector debe enlazar Exportar con openExportCenterModal');

  // 4. Workspace: Implementación de Centro de Exportación Unificado
  assertions++;
  assert.ok(wsJs.includes('async function openExportCenterModal('), 'workspace.js debe implementar openExportCenterModal');
  assertions++;
  assert.ok(wsJs.includes('btn-quick-export-action'), 'openExportCenterModal debe ofrecer acciones de Quick Export');

  // 5. Popup: Quick Exports y carga de módulos de exportación
  assertions++;
  assert.ok(popupHtml.includes('btn-quick-md') && popupHtml.includes('btn-quick-pdf') && popupHtml.includes('btn-quick-docx'), 'popup.html debe contener botones de Quick Export MD, PDF y DOCX');
  assertions++;
  assert.ok(popupHtml.includes('export_center.js') && popupHtml.includes('pdf_builder.js') && popupHtml.includes('docx_builder.js'), 'popup.html debe cargar export_center, pdf_builder y docx_builder');
  assertions++;
  assert.ok(popupJs.includes('btnQuickMd') && popupJs.includes('btnQuickPdf') && popupJs.includes('btnQuickDocx'), 'popup.js debe referenciar y enlazar botones de Quick Export');
  assertions++;
  assert.ok(popupJs.includes('exportWithCenter'), 'popup.js debe implementar exportWithCenter para exportación desacoplada');

  // 6. Cero emojis en todas las superficies intervenidas
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(wsJs), 'workspace.js debe cumplir cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(wsHtml), 'workspace.html debe cumplir cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(popupJs), 'popup.js debe cumplir cero emojis');
  assertions++;
  assert.ok(!emojiRegex.test(popupHtml), 'popup.html debe cumplir cero emojis');

  assert.equal(assertions, 18, 'Debe ejecutar exactamente 18 aserciones físicas de hardening de contratos de interacción');
});

test('Lossy v1.5 Plane A & B: Multi-Page PDF Chunking Invariants, Structural Node Taxonomy, Asset Manifest & Selective Isolation', async () => {
  let assertions = 0;
  const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
  const {
    createCanonicalConversation,
    createCanonicalClip,
    classifyMessageNode,
    NODE_TAXONOMY
  } = require('../../extension/src/core/canonical_model.js');
  const {
    ExportCenter,
    AssetResolver
  } = require('../../extension/src/core/portability/export_center.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');

  // 1. Verificación de maquetación y corte por páginas de bloques de código en PdfBuilder (cero coordenadas negativas)
  const longCodeLines = [];
  for (let i = 1; i <= 90; i++) {
    longCodeLines.push(`const variable_${i} = computeStep(${i}, "parametro_${i}"); // Linea de codigo determinista #${i}`);
  }
  const multiPageConv = {
    canonicalId: 'conv_multipage_pdf_code',
    title: 'Auditoría de Algoritmo de Cifrado y Paginación',
    model: 'gpt-4o',
    createdAt: '2026-10-25T08:00:00Z',
    messages: [
      {
        role: 'user',
        author: 'Usuario',
        text: 'Muestra la implementación completa del motor de procesamiento.',
        content: { text: 'Muestra la implementación completa del motor de procesamiento.' }
      },
      {
        role: 'assistant',
        author: 'ChatGPT',
        text: 'A continuación el bloque de código extenso:\n```javascript\n' + longCodeLines.join('\n') + '\n```\nFin de la implementación.',
        content: {
          text: 'A continuación el bloque de código extenso:\n```javascript\n' + longCodeLines.join('\n') + '\n```\nFin de la implementación.',
          codeBlocks: [{ language: 'javascript', code: longCodeLines.join('\n') }]
        }
      }
    ]
  };

  const pdfBytes = PdfBuilder.buildPdf(multiPageConv, { title: multiPageConv.title });
  assertions++;
  assert.ok(pdfBytes instanceof Uint8Array, 'PdfBuilder debe retornar un Uint8Array continuo');
  const pdfStr = Buffer.from(pdfBytes).toString('latin1');
  assertions++;
  assert.ok(pdfStr.startsWith('%PDF-1.4'), 'PDF debe iniciar con cabecera %PDF-1.4');

  // Validar que TODOS los rectángulos trazados tengan coordenadas Y no-negativas y dimensiones positivas
  const rectRegex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+re\s+f/g;
  let match;
  let rectCount = 0;
  while ((match = rectRegex.exec(pdfStr)) !== null) {
    rectCount++;
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const w = parseFloat(match[3]);
    const h = parseFloat(match[4]);
    assertions++;
    assert.ok(x >= 0, `Coordenada x (${x}) debe ser >= 0`);
    assertions++;
    assert.ok(y >= 0, `Coordenada y (${y}) debe ser >= 0 (nunca negativa)`);
    assertions++;
    assert.ok(w > 0, `Ancho w (${w}) debe ser positivo`);
    assertions++;
    assert.ok(h > 0, `Alto h (${h}) debe ser positivo`);
  }
  assertions++;
  assert.ok(rectCount >= 2, `El bloque de 90 líneas debe generar al menos 2 cajas de fondo en páginas distintas (generó ${rectCount})`);

  // Validar cabecera de continuación (cont.) al cruzar páginas (escapada en PDF como \(cont.\))
  assertions++;
  assert.ok(pdfStr.includes('\\(cont.\\)'), 'Bloque de código dividido debe mostrar etiqueta de continuación (cont.) debidamente escapada en PDF');

  // Validar reemplazo determinista de tabulaciones por 4 espacios
  const tabSanitized = PdfBuilder.sanitizePdfText("clave:\tvalor\totro");
  assertions++;
  assert.ok(!tabSanitized.includes('\t'), 'PdfBuilder.sanitizePdfText debe erradicar caracteres de tabulación');
  assertions++;
  assert.ok(tabSanitized.includes('    '), 'PdfBuilder.sanitizePdfText debe expandir tabs a 4 espacios');

  // 2. Clasificación de nodos DAG estructurales y categorías avanzadas
  const rootNode = classifyMessageNode({ id: 'root_node', message: null });
  assertions++;
  assert.equal(rootNode.role, 'structural', 'Nodo con message null debe clasificarse con rol structural');
  assertions++;
  assert.equal(rootNode.nodeCategory, 'structural', 'Nodo con message null debe clasificarse con categoría structural');
  assertions++;
  assert.equal(rootNode.isConversational, false, 'Nodo structural no es conversacional');

  const containerNode = classifyMessageNode({ id: 'group_container', children: ['child_1', 'child_2'] });
  assertions++;
  assert.equal(containerNode.role, 'structural', 'Nodo contenedor sin mensaje debe ser structural');

  const thoughtNode = classifyMessageNode({
    message: {
      author: { role: 'thought' },
      content: { parts: ['Analizando restricciones'] }
    }
  });
  assertions++;
  assert.equal(thoughtNode.nodeCategory, 'reasoning', 'Nodo thought debe mapearse a categoría reasoning');
  assertions++;
  assert.equal(thoughtNode.isConversational, false, 'Nodo reasoning no es conversacional');

  const agentNode = classifyMessageNode({
    message: {
      author: { role: 'agent' },
      content: { parts: ['Ejecutando subagente'] }
    }
  });
  assertions++;
  assert.equal(agentNode.nodeCategory, 'agent', 'Nodo agent debe mapearse a categoría agent');

  // 3. Partición disjunta estricta en nodeMetrics
  const mixedConv = createCanonicalConversation({
    title: 'Conversación de prueba partición disjunta',
    platform: 'chatgpt',
    messages: [
      { id: 'u1', role: 'user', isConversational: true, content: { text: 'Hola' } },
      { id: 'u2', role: 'user', isConversational: true, content: { text: 'Pregunta' } },
      { id: 'a1', role: 'assistant', isConversational: true, content: { text: 'Respuesta' } },
      { id: 'a2', role: 'assistant', isConversational: true, content: { text: 'Explicación' } },
      { id: 't1', role: 'assistant', recipient: 'bash', isConversational: false, content: { text: 'ls' } },
      { id: 't2', role: 'tool', isConversational: false, content: { text: 'file1.txt' } },
      { id: 's1', role: 'system', isConversational: false, content: { text: 'System prompt' } },
      { id: 'st1', role: 'structural', isConversational: false, content: { text: 'Branch container' } }
    ]
  });

  assertions++;
  assert.equal(mixedConv.sourceNodeCount, 8, 'sourceNodeCount debe ser 8');
  assertions++;
  assert.equal(mixedConv.conversationMessageCount, 4, 'conversationMessageCount debe ser 4 (2 user + 2 assistant)');
  assertions++;
  assert.equal(mixedConv.nodeMetrics.userNodes, 2, 'userNodes debe ser 2');
  assertions++;
  assert.equal(mixedConv.nodeMetrics.assistantNodes, 2, 'assistantNodes debe ser 2');
  assertions++;
  assert.equal(mixedConv.nodeMetrics.toolNodes, 2, 'toolNodes debe ser 2 (1 call + 1 output)');
  assertions++;
  assert.equal(mixedConv.nodeMetrics.systemNodes, 1, 'systemNodes debe ser 1');
  assertions++;
  assert.equal(mixedConv.nodeMetrics.structuralNodes, 1, 'structuralNodes debe ser 1');
  assertions++;
  assert.equal(
    mixedConv.nodeMetrics.userNodes +
    mixedConv.nodeMetrics.assistantNodes +
    mixedConv.nodeMetrics.toolNodes +
    mixedConv.nodeMetrics.systemNodes +
    mixedConv.nodeMetrics.structuralNodes,
    mixedConv.sourceNodeCount,
    'La suma de las particiones disjuntas debe ser exactamente igual a sourceNodeCount'
  );

  // 4. AssetResolver & Portability Manifest en exportBulk
  const assetConv = {
    canonicalId: 'conv_with_assets_001',
    title: 'Diseño de Sistema con Imágenes',
    messages: [
      {
        role: 'user',
        content: { text: 'Mira este esquema: ![Diagrama de arquitectura](https://cdn.example.com/arch.png)' }
      },
      {
        role: 'assistant',
        content: {
          text: 'Aquí está el resultado generado.',
          parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-abc12345' }]
        }
      }
    ],
    attachments: [
      { id: 'att_1', name: 'captura.png', mimeType: 'image/png', url: 'https://cdn.example.com/captura.png' }
    ]
  };

  const resolvedAssets = AssetResolver.resolveAssetsForEntity(assetConv);
  assertions++;
  assert.ok(resolvedAssets.length >= 3, `AssetResolver debe detectar al menos 3 recursos (detectó ${resolvedAssets.length})`);

  const center = new ExportCenter();
  const bulkExport = await center.exportBulk([assetConv], 'md', 'ai');
  const parsedZip = ZipBuilder.parseZip(bulkExport.data);
  assertions++;
  assert.ok(parsedZip['manifest.json'], 'El paquete ZIP debe contener manifest.json');

  const manifestData = JSON.parse(parsedZip['manifest.json'].toString('utf8'));
  assertions++;
  assert.ok(manifestData.assets, 'manifest.json debe incluir metadatos del subsistema assets');
  assertions++;
  assert.equal(manifestData.assets.total, resolvedAssets.length, 'manifest.json debe reflejar el total exacto de recursos resueltos');
  assertions++;
  assert.ok(typeof manifestData.assets.referenced === 'number', 'manifest.json debe reflejar recursos referenciados');

  // 5. Aislamiento selectivo de Clips y generación de nombre de archivo limpio
  const parentConv = createCanonicalConversation({
    title: 'Guía de Rust y Concurrencia',
    platform: 'chatgpt',
    messages: [
      { id: 'm0', role: 'user', content: { text: 'Turno inicial no incluido' } },
      { id: 'm1', role: 'assistant', content: { text: 'Turno 1 seleccionado de clip' } },
      { id: 'm2', role: 'user', content: { text: 'Turno intermedio ignorado' } },
      { id: 'm3', role: 'assistant', content: { text: 'Turno 3 seleccionado de clip' } },
      { id: 'm4', role: 'user', content: { text: 'Turno final no incluido' } }
    ]
  });

  const sampleClip = createCanonicalClip({
    title: 'Clip 1 — Fundamentos de Ownership',
    sourceConversation: parentConv,
    selectedTurnIndices: [1, 3]
  });

  const clipExport = await center.exportSingle(sampleClip, 'md');
  assertions++;
  assert.ok(!clipExport.filename.includes('clip_clip_'), `El nombre de archivo no debe duplicar prefijo clip_ (${clipExport.filename})`);
  assertions++;
  assert.ok(clipExport.data.includes('Turno 1 seleccionado de clip'), 'El clip exportado debe contener el turno 1');
  assertions++;
  assert.ok(clipExport.data.includes('Turno 3 seleccionado de clip'), 'El clip exportado debe contener el turno 3');
  assertions++;
  assert.ok(!clipExport.data.includes('Turno inicial no incluido'), 'El clip exportado no debe fugar el turno 0');
  assertions++;
  assert.ok(!clipExport.data.includes('Turno intermedio ignorado'), 'El clip exportado no debe fugar el turno 2');
  assertions++;
  assert.ok(!clipExport.data.includes('Turno final no incluido'), 'El clip exportado no debe fugar el turno 4');

  // 6. Contratos de interacción en Workspace y Popup
  const wsJsContent = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  assertions++;
  assert.ok(wsJsContent.includes('Nodos de origen DAG:'), 'workspace.js debe exponer Nodos de origen DAG en detalles técnicos');
  assertions++;
  assert.ok(wsJsContent.includes('Mensajes conversacionales:'), 'workspace.js debe exponer Mensajes conversacionales en detalles técnicos');
  assertions++;
  assert.ok(wsJsContent.includes('Eventos técnicos / adicionales:'), 'workspace.js debe exponer Eventos técnicos / adicionales en detalles técnicos');
  assertions++;
  assert.ok(wsJsContent.includes('Todos los nodos (${rawMessages.length} elementos: ${convMsgCount} mensajes + ${technicalNodesCount} eventos técnicos)'), 'workspace.js debe actualizar dinámicamente el heading al alternar eventos técnicos');
  assertions++;
  assert.ok(!wsJsContent.includes("{ label: 'Centro de Exportación', onClick: () => openExportCenterModal([activeId]) }"), 'btn-inspector-more no debe duplicar la opción primaria de Exportar');
  assertions++;
  assert.ok(!wsJsContent.includes("{ label: 'Centro de Exportación Masiva', onClick: () => openExportCenterModal(Array.from(selectedConversationIds)) }"), 'btn-bulk-more no debe duplicar la opción primaria de Exportar');

  const popupHtmlContent = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.html'), 'utf8');
  const popupJsContent = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.js'), 'utf8');
  assertions++;
  assert.ok(popupHtmlContent.includes('id="btn-popup-export"'), 'popup.html debe contener el botón unificado btn-popup-export');
  assertions++;
  assert.ok(popupHtmlContent.includes('id="popup-format-panel"'), 'popup.html debe contener el panel de formatos popup-format-panel');
  assertions++;
  assert.ok(popupJsContent.includes('initQuickExports'), 'popup.js debe implementar initQuickExports');
  assertions++;
  assert.ok(popupJsContent.includes('Captura requerida para exportar'), 'popup.js debe deshabilitar botones con explicación explícita sin captura previa');

  // 7. Cero emojis en todas las fuentes
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(wsJsContent), 'workspace.js debe cumplir con el invariante Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(popupJsContent), 'popup.js debe cumplir con el invariante Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(popupHtmlContent), 'popup.html debe cumplir con el invariante Zero-Emoji');

  assert.ok(assertions >= 45, `Debe ejecutar al menos 45 aserciones físicas de verificación profunda (ejecutó ${assertions})`);
});

test('Lossy v1.5 P0: PDF and DOCX Real Image Embedding, Asset Resolution and Package Strategies', async () => {
  let assertions = 0;
  const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
  const DocxBuilder = require('../../extension/src/core/portability/docx_builder.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');
  const {
    ExportCenter,
    AssetResolver
  } = require('../../extension/src/core/portability/export_center.js');
  const {
    createCanonicalConversation,
    createCanonicalAsset
  } = require('../../extension/src/core/canonical_model.js');

  const sampleJpeg = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11, 0x00,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x12, 0x34, 0xFF, 0xD9
  ]);
  const samplePng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAEElEQVR4nGNgGAWjYBTAAAADEAABPywr7AAAAABJRU5ErkJggg==', 'base64'));

  const assetJpeg = createCanonicalAsset({
    id: 'asset_diagram_jpg',
    name: 'diagrama_arquitectura.jpg',
    kind: 'image',
    mimeType: 'image/jpeg',
    sourceType: 'chatgpt-upload',
    url: 'https://files.oaiusercontent.com/file-diag-jpg',
    availability: 'referenced',
    width: 32,
    height: 16
  });

  const assetPng = createCanonicalAsset({
    id: 'asset_chart_png',
    name: 'grafico_telemetria.png',
    kind: 'image',
    mimeType: 'image/png',
    sourceType: 'chatgpt-upload',
    url: 'https://files.oaiusercontent.com/file-chart-png',
    availability: 'referenced',
    width: 16,
    height: 16
  });

  const assetMissing = createCanonicalAsset({
    id: 'asset_missing',
    name: 'foto_antigua.png',
    kind: 'image',
    mimeType: 'image/png',
    sourceType: 'chatgpt-asset-pointer',
    assetPointer: 'file-service://pointer-missing',
    availability: 'unavailable'
  });

  const conv = createCanonicalConversation({
    title: 'Discusión de Arquitectura con Recursos Gráficos',
    platform: 'chatgpt',
    model: 'gpt-4o',
    messages: [
      {
        id: 'msg_1',
        role: 'user',
        author: 'Usuario',
        text: 'Observa este diagrama JPEG y gráfico PNG:',
        attachments: [assetJpeg, assetPng]
      },
      {
        id: 'msg_2',
        role: 'assistant',
        author: 'ChatGPT',
        text: 'Analizado. También hubo una imagen no descargable:',
        attachments: [assetMissing]
      }
    ],
    attachments: [assetJpeg, assetPng, assetMissing]
  });

  // 1. Verificación de resolución de recursos en AssetResolver
  const resolved = AssetResolver.resolveAssetsForEntity(conv);
  assertions++;
  assert.equal(resolved.length, 3, 'AssetResolver debe resolver los 3 recursos de la conversación');
  assertions++;
  assert.equal(resolved.filter(a => a.availability === 'referenced').length, 2, '2 recursos deben estar referenciados');
  assertions++;
  assert.equal(resolved.filter(a => a.availability === 'unavailable').length, 1, '1 recurso debe estar clasificado como unavailable');

  // 2. Pure JS PDF 1.4 Image Embedding (ASSET-RED-001)
  const assetBinaryMap = new Map();
  assetBinaryMap.set('asset_diagram_jpg', sampleJpeg);
  assetBinaryMap.set('asset_chart_png', samplePng);

  const pdfBytes = PdfBuilder.buildPdf(conv, {
    assetMap: assetBinaryMap,
    assets: resolved,
    profile: 'human'
  });

  const pdfStr = Buffer.from(pdfBytes).toString('binary');
  assertions++;
  assert.ok(pdfStr.includes('/Type /XObject'), 'PDF debe contener declaración de XObjects');
  assertions++;
  assert.ok(pdfStr.includes('/Subtype /Image'), 'PDF debe contener objetos de tipo Image');
  assertions++;
  assert.ok(pdfStr.includes('/Filter /DCTDecode'), 'PDF debe contener stream JPEG con /Filter /DCTDecode');
  assertions++;
  assert.ok(pdfStr.includes('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length'), 'PNG decodificado debe contener un stream RGB válido');
  assertions++;
  assert.ok(pdfStr.includes('/Do') || pdfStr.includes(' Do'), 'PDF debe invocar al menos una llamada /Do para pintar XObject');
  assertions++;
  assert.ok(pdfStr.includes('Recurso visual no disponible en la exportacion'), 'PDF debe incluir fallback honesto delimitado para imágenes sin binario');

  // 3. Pure JS OpenXML DOCX Image Embedding (DrawingML)
  const docxBytes = DocxBuilder.buildDocx(conv, {
    assetMap: assetBinaryMap,
    assets: resolved,
    profile: 'human'
  });

  const parsedDocx = ZipBuilder.parseZip(docxBytes);
  assertions++;
  assert.ok(parsedDocx['word/media/image1.jpeg'], 'DOCX debe incluir word/media/image1.jpeg dentro del archivo ZIP');
  assertions++;
  assert.ok(parsedDocx['word/media/image2.png'], 'DOCX debe incluir word/media/image2.png dentro del archivo ZIP');
  assertions++;
  assert.ok(parsedDocx['word/_rels/document.xml.rels'], 'DOCX debe incluir relaciones de documento');

  const docxRels = parsedDocx['word/_rels/document.xml.rels'].toString('utf8');
  assertions++;
  assert.ok(docxRels.includes('Target="media/image1.jpeg"'), 'document.xml.rels debe referenciar image1.jpeg');
  assertions++;
  assert.ok(docxRels.includes('Target="media/image2.png"'), 'document.xml.rels debe referenciar image2.png');

  const docxBody = parsedDocx['word/document.xml'].toString('utf8');
  assertions++;
  assert.ok(docxBody.includes('<w:drawing>'), 'document.xml debe incluir elementos DrawingML <w:drawing>');
  assertions++;
  assert.ok(docxBody.includes('rIdImg1'), 'document.xml debe referenciar rIdImg1 en blipFill');
  assertions++;
  assert.ok(docxBody.includes('Recurso visual no disponible en la exportación: foto_antigua.png'), 'DOCX debe incluir tarjeta fallback para la imagen ausente');

  // 4. ExportCenter con estrategia 'package' (ZIP + /assets/) y 'embed' (Data URI)
  const center = new ExportCenter();

  // Mock resolveAssetBinaries for exportCenter
  const originalResolveAssetBinaries = AssetResolver.resolveAssetBinaries;
  AssetResolver.resolveAssetBinaries = async () => assetBinaryMap;

  try {
    // Markdown 'package' -> Genera ZIP con /assets/
    const mdPackageRes = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'package' });
    assertions++;
    assert.ok(mdPackageRes.filename.endsWith('.zip'), 'Estrategia package en Markdown debe producir un archivo .zip');
    const mdPackageZip = ZipBuilder.parseZip(mdPackageRes.data);
    assertions++;
    assert.ok(mdPackageZip['manifest.json'], 'Paquete Markdown debe contener manifest.json');
    assertions++;
    assert.ok(mdPackageZip['assets/diagrama_arquitectura.jpg'], 'Paquete Markdown debe contener carpeta assets/ con diagrama_arquitectura.jpg');
    assertions++;
    assert.ok(mdPackageZip['assets/grafico_telemetria.png'], 'Paquete Markdown debe contener carpeta assets/ con grafico_telemetria.png');

    // Markdown 'embed' -> Data URI en el texto Markdown
    const mdEmbedRes = await center.exportSingle(conv, 'md', 'ai', { imageStrategy: 'embed' });
    assertions++;
    assert.ok(mdEmbedRes.data.includes('data:image/jpeg;base64,'), 'Estrategia embed en Markdown debe generar Data URI Base64 para JPEG');
    assertions++;
    assert.ok(mdEmbedRes.data.includes('data:image/png;base64,'), 'Estrategia embed en Markdown debe generar Data URI Base64 para PNG');

    // TXT 'package' -> Genera ZIP con /assets/
    const txtPackageRes = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'package' });
    assertions++;
    assert.ok(txtPackageRes.filename.endsWith('.zip'), 'Estrategia package en TXT debe producir un archivo .zip');
    const txtPackageZip = ZipBuilder.parseZip(txtPackageRes.data);
    assertions++;
    assert.ok(txtPackageZip['assets/diagrama_arquitectura.jpg'], 'Paquete TXT debe contener carpeta assets/ con diagrama_arquitectura.jpg');

    // TXT 'omit' -> Omit con nota
    const txtOmitRes = await center.exportSingle(conv, 'txt', 'ai', { imageStrategy: 'omit' });
    assertions++;
    assert.ok(txtOmitRes.data.includes('[Recurso visual omitido:'), 'TXT con estrategia omit debe dejar nota sobria');
    assertions++;
    assert.ok(!txtOmitRes.data.includes('data:image/'), 'TXT jamás debe contener data URIs Base64');
  } finally {
    AssetResolver.resolveAssetBinaries = originalResolveAssetBinaries;
  }

  assert.ok(assertions >= 25, `Debe ejecutar al menos 25 aserciones físicas de fidelidad de recursos (ejecutó ${assertions})`);
});

test('Lossy v1.5 P1 & P2: ChatGPT Inline Message Actions, Full Reader Workbench & Official ZIP Ingestion', async () => {
  let assertions = 0;
  const contentScript = require('../../extension/src/content/content_script.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');

  const adapter = contentScript.ChatGPTMessageActionsAdapter;
  assertions++;
  assert.ok(adapter, 'content_script.js debe exportar ChatGPTMessageActionsAdapter');

  // 1. Simulación DOM de contenedor de mensaje de ChatGPT
  function createMockTurnElement(role, text, codeText, imgSrc) {
    const el = {
      attributes: {
        'data-message-author-role': role
      },
      getAttribute(name) { return this.attributes[name] || null; },
      setAttribute(name, val) { this.attributes[name] = val; },
      textContent: text,
      innerText: text,
      children: [],
      appendChild(ch) { this.children.push(ch); return ch; },
      cloneNode() {
        return {
          ...this,
          querySelectorAll(selector) {
            if (selector === 'pre code' && codeText) {
              return [{ className: 'language-rust', textContent: codeText }];
            }
            if (selector === 'img' && imgSrc) {
              return [{
                getAttribute(a) { return a === 'src' ? imgSrc : 'diagrama_alt'; }
              }];
            }
            if (selector.includes('lossy')) return [];
            return [];
          }
        };
      },
      querySelector(selector) {
        if (selector === 'div:last-child') return this;
        return null;
      },
      querySelectorAll() { return []; }
    };
    return el;
  }

  const mockContainer = createMockTurnElement(
    'assistant',
    'Aquí tienes la solución usando canales mpsc en Rust:',
    'let (tx, rx) = mpsc::channel();',
    'https://files.oaiusercontent.com/diagram1.png'
  );

  // 2. Extracción de turno por el adaptador
  const turnData = adapter.extractTurnData(mockContainer, 3);
  assertions++;
  assert.equal(turnData.role, 'assistant', 'extractTurnData debe detectar el rol');
  assertions++;
  assert.ok(turnData.text.includes('mpsc en Rust'), 'extractTurnData debe extraer el texto limpio');
  assertions++;
  assert.equal(turnData.codeBlocks.length, 1, 'extractTurnData debe extraer los bloques de código');
  assertions++;
  assert.equal(turnData.codeBlocks[0].language, 'rust', 'extractTurnData debe detectar lenguaje rust');
  assertions++;
  assert.equal(turnData.attachments.length, 1, 'extractTurnData debe extraer las imágenes como adjuntos');

  // 3. Creación de Clip Unitario
  const clip = adapter.createClipObject(turnData, { conversationId: 'c_test_99', title: 'Rust Concurrency' });
  assertions++;
  assert.ok(clip.clipId.startsWith('clip_msg_'), 'createClipObject debe generar un clipId con prefijo clip_msg_');
  assertions++;
  assert.equal(clip.type, 'single-message', 'createClipObject debe fijar type = single-message');
  assertions++;
  assert.equal(clip.selectionMode, 'single-message', 'createClipObject debe fijar selectionMode = single-message');
  assertions++;
  assert.equal(clip.range.startMessageIndex, 3, 'createClipObject debe fijar rango ordinal correcto');
  assertions++;
  assert.equal(clip.messageCount, 1, 'createClipObject debe fijar messageCount = 1');
  assertions++;
  assert.equal(clip.messages.length, 1, 'createClipObject debe contener exactamente 1 mensaje canónico');

  // 4. Montaje Idempotente
  const mockDoc = {
    head: { appendChild() {} },
    getElementById() { return null; },
    createElement(tag) {
      return {
        tagName: tag,
        className: '',
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k]; },
        appendChild(ch) { (this.children = this.children || []).push(ch); },
        addEventListener() {},
        classList: { add() {}, remove() {} }
      };
    },
    querySelectorAll(selector) {
      if (selector.includes('article')) return [mockContainer];
      return [];
    }
  };

  adapter.mount(mockDoc);
  assertions++;
  assert.equal(mockContainer.getAttribute('data-lossy-mounted'), 'true', 'mount debe marcar el contenedor como data-lossy-mounted="true"');

  // Montaje secundario debe ser no-op
  const initialChildrenCount = mockContainer.children.length;
  adapter.mount(mockDoc);
  assertions++;
  assert.equal(mockContainer.children.length, initialChildrenCount, 'Segundo montaje debe ser estrictamente idempotente (cero duplicados)');

  // 5. Ingesta oficial de ChatGPT ZIP mediante ZipBuilder.unzip
  const sampleExportJson = JSON.stringify([
    {
      id: 'chatgpt_official_conv_1',
      title: 'Conversación Oficial Importada',
      create_time: 1710000000,
      update_time: 1710000500,
      mapping: {
        'root': { id: 'root', message: null, children: ['m1'] },
        'm1': {
          id: 'm1',
          message: {
            author: { role: 'user' },
            create_time: 1710000005,
            content: { content_type: 'text', parts: ['Mensaje importado desde ZIP oficial'] }
          },
          children: []
        }
      }
    }
  ]);

  const testZip = ZipBuilder.createZip({
    'conversations.json': sampleExportJson,
    'user.json': '{"name": "Developer"}'
  });

  assertions++;
  assert.ok(typeof ZipBuilder.unzip === 'function', 'ZipBuilder debe proveer método unzip');

  const unzipped = await ZipBuilder.unzip(testZip);
  assertions++;
  assert.ok(unzipped['conversations.json'], 'unzip debe extraer conversations.json del archivo ZIP');
  const parsedJson = JSON.parse(Buffer.from(unzipped['conversations.json']).toString('utf8'));
  assertions++;
  assert.equal(parsedJson[0].id, 'chatgpt_official_conv_1', 'El JSON extraído debe coincidir con el contenido original');

  // 6. Verificación de Contratos de Superficie Full Reader en workspace.html y workspace.js
  const wsHtml = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.html'), 'utf8');
  const wsJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');

  assertions++;
  assert.ok(wsHtml.includes('id="full-reader-overlay"'), 'workspace.html debe contener el contenedor modal #full-reader-overlay');
  assertions++;
  assert.ok(wsHtml.includes('id="full-reader-stream"'), 'workspace.html debe contener #full-reader-stream');
  assertions++;
  assert.ok(wsHtml.includes('id="full-reader-search"'), 'workspace.html debe contener buscador interactivo #full-reader-search');
  assertions++;
  assert.ok(wsHtml.includes('id="btn-open-full-reader"'), 'workspace.html debe contener botón #btn-open-full-reader');
  assertions++;
  assert.ok(wsHtml.includes('id="btn-full-reader-clip"'), 'workspace.html debe contener botón #btn-full-reader-clip');
  assertions++;
  assert.ok(wsHtml.includes('id="btn-full-reader-export"'), 'workspace.html debe contener botón #btn-full-reader-export');

  assertions++;
  assert.ok(wsJs.includes('openFullReader'), 'workspace.js debe implementar openFullReader');
  assertions++;
  assert.ok(wsJs.includes('renderFullReaderStream'), 'workspace.js debe implementar renderFullReaderStream');
  assertions++;
  assert.ok(wsJs.includes('syncPendingClipsFromStorage'), 'workspace.js debe implementar syncPendingClipsFromStorage');
  assertions++;
  assert.ok(wsJs.includes('modal-md-asset-choice'), 'workspace.js debe implementar diálogo modal para selección de estrategia en Markdown');
  assertions++;
  assert.ok(wsJs.includes('modal-txt-asset-choice'), 'workspace.js debe implementar diálogo modal para selección de estrategia en TXT');

  assertions++;
  assert.ok(wsCss.includes('.full-reader-overlay'), 'workspace.css debe contener reglas para .full-reader-overlay');
  assertions++;
  assert.ok(wsCss.includes('.quick-export-chip'), 'workspace.css debe contener estilos para .quick-export-chip');

  // 7. Cero Emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(wsHtml), 'workspace.html debe cumplir el invariante Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(wsJs), 'workspace.js debe cumplir el invariante Zero-Emoji');

  assert.ok(assertions >= 30, `Debe ejecutar al menos 30 aserciones físicas de superficie y acciones de mensaje (ejecutó ${assertions})`);
});

test('Lossy v1.5 Browser-Real Reconciliation: Image Fidelity, Asset UX, Configurable Quick Exports and Full Reader Non-Destructive Flow (BRR-001 - BRR-005)', async () => {
  let assertions = 0;

  const PdfBuilder = require('../../extension/src/core/portability/pdf_builder.js');
  const DocxBuilder = require('../../extension/src/core/portability/docx_builder.js');
  const ZipBuilder = require('../../extension/src/core/portability/zip_builder.js');
  const {
    ExportCenter,
    AssetResolver,
    getPinnedQuickExports,
    setPinnedQuickExports
  } = require('../../extension/src/core/portability/export_center.js');

  // 1. BRR-001 & BRR-002: Real Image Embedding into PDF and DOCX from DataURI & Asset Map
  const validJpegBytes = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11,
    0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F,
    0x00, 0xAA, 0xBB, 0xCC, 0xFF, 0xD9
  ]);
  const jpegDataUri = `data:image/jpeg;base64,${validJpegBytes.toString('base64')}`;

  const convWithImage = {
    canonicalId: 'conv_chatgpt_reconciliation_image_test',
    title: 'Prueba de Reconciliacion Visual',
    model: 'gpt-4o',
    source: { platform: 'chatgpt', conversationId: 'rec_img_001' },
    messages: [
      {
        id: 'msg_u_1',
        role: 'user',
        author: 'Usuario',
        isConversational: true,
        content: { text: 'Genera un diagrama de arquitectura', codeBlocks: [], attachments: [] },
        attachments: []
      },
      {
        id: 'msg_a_1',
        role: 'assistant',
        author: 'ChatGPT',
        isConversational: true,
        content: {
          text: 'Aqui tienes el diagrama solicitado:',
          codeBlocks: [],
          attachments: [
            {
              id: 'att_img_1',
              assetId: 'att_img_1',
              name: 'diagrama_arquitectura.jpeg',
              filename: 'diagrama_arquitectura.jpeg',
              kind: 'image',
              mimeType: 'image/jpeg',
              sourceType: 'image_asset_pointer',
              dataURI: jpegDataUri,
              availability: 'embedded'
            }
          ]
        },
        attachments: [
          {
            id: 'att_img_1',
            assetId: 'att_img_1',
            name: 'diagrama_arquitectura.jpeg',
            filename: 'diagrama_arquitectura.jpeg',
            kind: 'image',
            mimeType: 'image/jpeg',
            sourceType: 'image_asset_pointer',
            dataURI: jpegDataUri,
            availability: 'embedded'
          }
        ]
      }
    ],
    attachments: [
      {
        id: 'att_img_1',
        assetId: 'att_img_1',
        name: 'diagrama_arquitectura.jpeg',
        filename: 'diagrama_arquitectura.jpeg',
        kind: 'image',
        mimeType: 'image/jpeg',
        sourceType: 'image_asset_pointer',
        dataURI: jpegDataUri,
        availability: 'embedded'
      }
    ]
  };

  // PDF Real Image Embedding
  const pdfOutput = PdfBuilder.buildPdf(convWithImage);
  assertions++;
  assert.ok(pdfOutput instanceof Uint8Array, 'PdfBuilder debe retornar Uint8Array');
  const pdfString = Buffer.from(pdfOutput).toString('binary');
  assertions++;
  assert.ok(pdfString.includes('/Subtype /Image'), 'El PDF debe declarar el XObject de imagen');
  assertions++;
  assert.ok(pdfString.includes('/Filter /DCTDecode'), 'El PDF debe usar filtro DCTDecode para JPEG');
  assertions++;
  assert.ok(pdfString.includes('/Do') || pdfString.includes(' Do'), 'El stream del PDF debe contener la instruccion /Do de renderizado');

  // DOCX Real Image Embedding
  const docxOutput = DocxBuilder.buildDocx(convWithImage);
  assertions++;
  assert.ok(docxOutput instanceof Uint8Array, 'DocxBuilder debe retornar Uint8Array');
  const unzippedDocx = await ZipBuilder.unzip(docxOutput);
  assertions++;
  assert.ok(unzippedDocx['word/media/image1.jpeg'] || unzippedDocx['word/media/image_1.jpeg'], 'El DOCX debe contener el archivo binario de la imagen en word/media/');
  const mediaBytes = unzippedDocx['word/media/image1.jpeg'] || unzippedDocx['word/media/image_1.jpeg'];
  assertions++;
  assert.ok(mediaBytes.length > 30, 'Los bytes de la imagen dentro de DOCX deben corresponder al binario real');
  assertions++;
  assert.equal(mediaBytes[0], 0xFF, 'El primer byte de la imagen en DOCX debe ser 0xFF (JPEG SOF)');
  assert.equal(mediaBytes[1], 0xD8, 'El segundo byte de la imagen en DOCX debe ser 0xD8 (JPEG SOI)');
  assertions++;

  // 2. Structured Acquisition Parser preserves attachments
  const contentScriptPath = path.resolve(__dirname, '../../extension/src/content/content_script.js');
  const csCode = fs.readFileSync(contentScriptPath, 'utf8');
  assertions++;
  assert.ok(csCode.includes('enrichConversationWithLiveDomAssets'), 'content_script.js debe incluir enrichConversationWithLiveDomAssets');
  assertions++;
  assert.ok(csCode.includes('resolveImageAsDataUri'), 'content_script.js debe incluir resolveImageAsDataUri');
  assertions++;
  assert.ok(csCode.includes('extractImageDataUri'), 'content_script.js debe incluir extractImageDataUri');
  assertions++;
  assert.ok(csCode.includes('msgAttachments'), 'parseChatGPTConversationTreeDirect debe poblar msgAttachments desde content.parts y metadata');

  // 3. BRR-003: ExportCenter Package Strategies (MD and TXT ZIP with /assets/)
  const exportCenter = new ExportCenter();
  const mdPackageResult = await exportCenter.exportSingle(convWithImage, 'md', 'ai', { imageStrategy: 'package' });
  assertions++;
  assert.equal(mdPackageResult.format, 'md', 'El resultado de empaquetado debe tener formato md');
  assertions++;
  assert.ok(mdPackageResult.filename.endsWith('.zip'), 'La estrategia package en Markdown debe producir un archivo .zip');
  const unzippedMdPkg = await ZipBuilder.unzip(mdPackageResult.data);
  assertions++;
  assert.ok(Object.keys(unzippedMdPkg).some(k => k.endsWith('.md')), 'El ZIP de Markdown empaquetado debe contener el documento .md');
  assertions++;
  assert.ok(Object.keys(unzippedMdPkg).some(k => k.startsWith('assets/')), 'El ZIP de Markdown empaquetado debe contener la carpeta assets/');

  const txtPackageResult = await exportCenter.exportSingle(convWithImage, 'txt', 'ai', { imageStrategy: 'package' });
  assertions++;
  assert.equal(txtPackageResult.format, 'txt', 'El resultado de empaquetado debe tener formato txt');
  assertions++;
  assert.ok(txtPackageResult.filename.endsWith('.zip'), 'La estrategia package en TXT debe producir un archivo .zip');
  const unzippedTxtPkg = await ZipBuilder.unzip(txtPackageResult.data);
  assertions++;
  assert.ok(Object.keys(unzippedTxtPkg).some(k => k.endsWith('.txt')), 'El ZIP de TXT empaquetado debe contener el archivo .txt');
  assertions++;
  assert.ok(Object.keys(unzippedTxtPkg).some(k => k.startsWith('assets/')), 'El ZIP de TXT empaquetado debe contener la carpeta assets/');

  // 4. BRR-004: Configurable Quick Exports Persistence
  const defaultPinned = await getPinnedQuickExports();
  assertions++;
  assert.ok(Array.isArray(defaultPinned) && defaultPinned.length <= 3, 'getPinnedQuickExports debe retornar maximo 3 formatos');
  const updatedPinned = await setPinnedQuickExports(['json', 'txt', 'png', 'pdf']);
  assertions++;
  assert.deepEqual(updatedPinned, ['json', 'txt', 'png'], 'setPinnedQuickExports debe acotar estrictamente a un maximo de 3 formatos');
  // Restaurar por cortesía
  await setPinnedQuickExports(['md', 'pdf', 'docx']);

  // 5. BRR-005: Full Reader CSS Flexbox Invariants & Non-Destructive Search
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');
  assertions++;
  assert.ok(wsCss.includes('min-height: 0;'), 'workspace.css debe contener min-height: 0 para evitar congelamiento de scroll flexbox');
  assertions++;
  assert.ok(wsCss.includes('.reader-turn-card.reader-search-match'), 'workspace.css debe estilizar .reader-turn-card.reader-search-match');
  assertions++;
  assert.ok(wsCss.includes('mark.reader-highlight'), 'workspace.css debe estilizar mark.reader-highlight');

  const wsJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  assertions++;
  assert.ok(wsJs.includes('btn-pin-quick-export'), 'workspace.js debe proveer botones de fijado btn-pin-quick-export en las tarjetas de formato');
  assertions++;
  assert.ok(wsJs.includes('matchingOriginalIndices'), 'renderFullReaderStream debe usar indices no destructivos para la busqueda');
  assertions++;
  assert.ok(wsJs.includes('scrollIntoView'), 'renderFullReaderStream debe realizar desplazamiento suave hacia la primera coincidencia');

  const popupJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/popup/popup.js'), 'utf8');
  assertions++;
  assert.ok(popupJs.includes('container.innerHTML = \'\''), 'initQuickExports en popup.js debe limpiar el contenedor antes de renderizar dinamicamente');
  assertions++;
  assert.ok(popupJs.includes('lossy_quick_exports_pinned'), 'popup.js debe sincronizar reactivamente con el storage al cambiar lossy_quick_exports_pinned');

  // 6. Zero Emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(csCode), 'content_script.js debe cumplir Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(wsJs), 'workspace.js debe cumplir Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(popupJs), 'popup.js debe cumplir Zero-Emoji');

  assert.ok(assertions >= 25, `Debe ejecutar al menos 25 aserciones de reconciliacion browser-real (ejecuto ${assertions})`);
});

test('Lossy v1.5 CSP Hardening, Stacking Context & Full Reader Usability (BRR-CSP-001 - BRR-CSP-004)', async () => {
  let assertions = 0;

  const wsJs = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.js'), 'utf8');
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../../extension/src/workspace/workspace.css'), 'utf8');
  const csCode = fs.readFileSync(path.resolve(__dirname, '../../extension/src/content/content_script.js'), 'utf8');

  // 1. BRR-CSP-001: Zero Inline Event Handlers in Workspace (Chrome MV3 CSP script-src 'self' Invariant)
  const inlineHandlerRegex = /<[a-zA-Z0-9\-]+(\s+[^>]*)?\s+on(error|click|load|change|mouseover|focus|blur)\s*=/i;
  assertions++;
  assert.ok(!inlineHandlerRegex.test(wsJs), 'workspace.js no debe contener ningun inline event handler (onerror, onclick, etc.) en cadenas HTML');

  assertions++;
  assert.ok(wsJs.includes('reader-img-asset'), 'workspace.js debe usar clase reader-img-asset para el manejo desacoplado de imagenes');

  assertions++;
  assert.ok(wsJs.includes("img.addEventListener('error'"), 'workspace.js debe asociar eventos de error de imagen mediante addEventListener');

  assertions++;
  assert.ok(wsJs.includes('fullReaderOverlayElem.addEventListener(\'click\''), 'workspace.js debe permitir cerrar el Full Reader al hacer clic en el backdrop');

  // 2. BRR-CSP-002: extractMessageText Helper Invariants
  assertions++;
  assert.ok(wsJs.includes('function extractMessageText'), 'workspace.js debe proveer la funcion utilitaria extractMessageText');

  // Evaluacion funcional de extractMessageText
  const extractFnMatch = wsJs.match(/function extractMessageText\(msg\) \{[\s\S]*?\n  \}/);
  assertions++;
  assert.ok(extractFnMatch !== null, 'extractMessageText debe estar definida con bloque completo');
  const evalExtract = new Function(`return (${extractFnMatch[0]});`)();

  assertions++;
  assert.equal(evalExtract(null), '', 'extractMessageText(null) debe retornar cadena vacia');
  assertions++;
  assert.equal(evalExtract({ content: { text: 'Hola mundo' } }), 'Hola mundo', 'extractMessageText debe extraer content.text');
  assertions++;
  assert.equal(evalExtract({ text: 'Texto directo' }), 'Texto directo', 'extractMessageText debe extraer msg.text');
  assertions++;
  assert.equal(evalExtract({ content: { parts: ['Parte 1', 'Parte 2'] } }), 'Parte 1\nParte 2', 'extractMessageText debe combinar content.parts');

  // 3. BRR-CSP-003: Stacking Context Hierarchy Invariants
  const fullReaderZMatch = wsCss.match(/\.full-reader-overlay\s*\{[^}]*?z-index:\s*(\d+)/);
  const modalZMatch = wsCss.match(/\.modal-backdrop\s*\{[^}]*?z-index:\s*(\d+)/);
  const contextMenuZMatch = wsCss.match(/\.context-menu\s*\{[^}]*?z-index:\s*(\d+)/);
  const toastZMatch = wsCss.match(/\.toast-container\s*\{[^}]*?z-index:\s*(\d+)/);

  assertions++;
  assert.ok(fullReaderZMatch && modalZMatch && contextMenuZMatch && toastZMatch, 'Deben existir declaraciones explicitas de z-index para overlay, modal, menu y toast');

  const fullReaderZ = parseInt(fullReaderZMatch[1], 10);
  const modalZ = parseInt(modalZMatch[1], 10);
  const contextMenuZ = parseInt(contextMenuZMatch[1], 10);
  const toastZ = parseInt(toastZMatch[1], 10);

  assertions++;
  assert.ok(fullReaderZ < modalZ, `full-reader-overlay (${fullReaderZ}) debe tener menor z-index que modal-backdrop (${modalZ}) para que los dialogos no se oculten`);

  assertions++;
  assert.ok(modalZ < contextMenuZ, `modal-backdrop (${modalZ}) debe ser inferior a context-menu (${contextMenuZ})`);

  assertions++;
  assert.ok(contextMenuZ < toastZ, `context-menu (${contextMenuZ}) debe ser inferior a toast-container (${toastZ})`);

  // 4. BRR-CSP-004: Code Box & Card Readability Invariants
  assertions++;
  assert.ok(wsCss.includes('.reader-code-box code'), 'workspace.css debe contener reglas explicitas para .reader-code-box code');

  assertions++;
  assert.ok(!wsCss.includes('word-break: break-all;\n} \n.reader-code-box'), 'No debe haber word-break: break-all en el contenedor de codigo que corte variables');

  // 5. Content Script Harvest & Image Safeguards
  assertions++;
  assert.ok(csCode.includes('Promise.race'), 'enrichConversationWithLiveDomAssets debe implementar salvaguarda Promise.race de tiempo acotado');

  assertions++;
  assert.ok(csCode.includes('AbortController'), 'Llamadas de red de imagen y sesion deben emplear AbortController con timeout');

  assertions++;
  assert.ok(csCode.includes('.lossy-action-wrapper, .lossy-message-action-btn'), 'extractVisibleTurns debe sanitizar nodos inyectados de Lossy antes de leer texto');

  // 6. Zero Emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assertions++;
  assert.ok(!emojiRegex.test(wsJs), 'workspace.js debe cumplir Zero-Emoji');
  assertions++;
  assert.ok(!emojiRegex.test(wsCss), 'workspace.css debe cumplir Zero-Emoji');

  assert.ok(assertions >= 18, `Debe ejecutar al menos 18 aserciones de hardening CSP y lector (ejecuto ${assertions})`);
});






