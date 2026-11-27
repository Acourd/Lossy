'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Widgets = require('../../extension/src/core/chatgpt_widgets.js');
const ExportCenterMod = require('../../extension/src/core/portability/export_center.js');
const DocumentModel = require('../../extension/src/core/portability/document_model.js');

const SAMPLE_GRID = [
  '¿Qué sucede si solamente tienes el límite semanal?',
  '',
  '<grid columns={2} gap={3}> <grid-item> <card gap={2}> Usuario A <caption>Límite de 5 horas</caption> <box height={7} background="#e5e7eb" radius="full"> <box height={7} width="80%" background="#16a34a" radius="full"/> </box> <caption>Límite semanal</caption> <box height={7} background="#e5e7eb" radius="full"> <box height={7} width="90%" background="#16a34a" radius="full"/> </box> <text size="sm">Dos ventanas de uso visibles. </text> </card> </grid-item> <grid-item> <card gap={2}> Usuario B <caption>Límite de 5 horas</caption> <text color="secondary" size="sm">No aparece</text> <caption>Límite semanal</caption> <box height={7} background="#e5e7eb" radius="full"> <box height={7} width="90%" background="#16a34a" radius="full"/> </box> <text size="sm">Una sola ventana de uso visible.</text> </card> </grid-item> </grid>'
].join('\n');

const SAMPLE_SVG_BOX = `<box border radius="lg" padding={3} gap={3}>
  <text weight="medium" size="sm">Integración mediante el motor oficial</text>
  <svg viewBox="0 0 320 76" width="100%">
    <rect x="2" y="10" width="88" height="54" rx="8" fill="#16a34a" fillOpacity=".10" stroke="#16a34a"/>
    <text x="46" y="32" fontSize="11" fill="currentColor" textAnchor="middle">Cliente</text>
    <text x="275" y="41" fontSize="12" fill="currentColor" textAnchor="middle">OpenAI</text>
  </svg>
  <caption>Vía de integración documentada oficialmente.</caption>
</box>`;

const SAMPLE_DIL_SIMULATOR = `{@body const [saving,setSaving]=DIL.useState(63)}
{@body const [daily,setDaily]=DIL.useState(2)}
{@body const multiplier=1/(1-saving/100)}
<card gap={4}>
  <title>Simulador de ahorro de tokens</title>
  <row align="center"> Ahorro efectivo <spacer/> <title size="lg" color="success">{saving}%</title> </row>
  <slider min={0} max={80} step={1} value={saving}/>
  <grid columns={2}>
    <grid-item><caption>Consumo por trabajo equivalente</caption><title size="2xl">{(20*(1-saving/100)).toFixed(1)}%</title></grid-item>
    <grid-item><caption>Capacidad de trabajo</caption><title size="2xl">{multiplier.toFixed(2)}x</title></grid-item>
  </grid>
  <row align="center"><text size="sm">Codex</text><box flex={1}><box height={24} background="#94a3b8" width={\`\${100/multiplier}%\`}/></box><text size="sm">1x</text></row>
</card>`;

const SAMPLE_DIL_EACH = `<card gap={2}>
  <title>Distribución del razonamiento automático</title>
  {#each [{n:"Low",v:105,c:"#94a3b8"},{n:"Medium",v:591,c:"#3b82f6"},{n:"High",v:127,c:"#8b5cf6"},{n:"XHigh",v:2,c:"#d97706"}] as d}
    <row align="center"><text size="sm">{d.n}</text><box flex={1}><box height={10} background={d.c} width={\`\${(d.v/825*100).toFixed(1)}%\`}/></box><text size="sm">{(d.v/825*100).toFixed(1)}%</text></row>
  {/each}
</card>`;

const SAMPLE_ROW_FAVICON = `<row align="center">
  <favicon url="https://codexreset.ai/" size="32px"/>
  <box gap=1>
    **[CodexReset.ai](https://codexreset.ai/)**

    Historial de resets globales.
  </box>
</row>
<divider/>`;

test('ChatGPTWidgets renders multi-column grid preserving ALL nested bars (Usuario A & B)', () => {
  const md = Widgets.renderWidgetsToMarkdown(SAMPLE_GRID);
  assert.ok(!md.includes('<grid') && !md.includes('<box'));
  assert.ok(md.includes('**Usuario A**') && md.includes('**Usuario B**'));
  assert.ok(md.includes('████████░░') && md.includes('80%'));
  assert.ok(md.includes('█████████░') && md.includes('90%'));

  const html = Widgets.renderWidgetsToHtml(SAMPLE_GRID);
  assert.ok(html.includes('lossy-widget-cols-2'));
  assert.ok(html.includes('width:80%;background:#16a34a'));
  // Both Usuario A and Usuario B have 90% bars -> must appear twice
  assert.equal((html.match(/width:90%;background:#16a34a/g) || []).length, 2);
});

test('ChatGPTWidgets renders inline SVG diagrams safely with normalized SVG attributes', () => {
  const html = Widgets.renderWidgetsToHtml(SAMPLE_SVG_BOX);
  assert.ok(html.includes('<svg viewBox="0 0 320 76" width="100%"'));
  assert.ok(html.includes('fill-opacity=".10"'));
  assert.ok(html.includes('font-size="11"'));
  assert.ok(html.includes('text-anchor="middle"'));
  assert.ok(!html.includes('fillOpacity'));

  const md = Widgets.renderWidgetsToMarkdown(SAMPLE_SVG_BOX);
  assert.ok(md.includes('Cliente') && md.includes('OpenAI') && !md.includes('<svg'));
});

test('ChatGPTWidgets evaluates DIL {@body} state, arithmetic, and template literals without eval', () => {
  const html = Widgets.renderWidgetsToHtml(SAMPLE_DIL_SIMULATOR);
  assert.ok(!html.includes('{@body'));
  assert.ok(!html.includes('{saving}'));
  assert.ok(html.includes('63%'));
  assert.ok(html.includes('7.4%'));
  assert.ok(html.includes('2.70x'));
  assert.ok(html.includes('width:37%;background:#94a3b8'));

  const md = Widgets.renderWidgetsToMarkdown(SAMPLE_DIL_SIMULATOR);
  assert.ok(md.includes('63%') && md.includes('7.4%') && md.includes('2.70x') && !md.includes('{@body'));
});

test('ChatGPTWidgets expands {#each ... as d} loops into graphical bars and Markdown rows', () => {
  const html = Widgets.renderWidgetsToHtml(SAMPLE_DIL_EACH);
  assert.ok(!html.includes('{#each') && !html.includes('{/each}'));
  assert.ok(html.includes('Medium') && html.includes('71.6%'));
  assert.ok(html.includes('width:72%;background:#3b82f6'));
  assert.ok(html.includes('width:15%;background:#8b5cf6'));

  const md = Widgets.renderWidgetsToMarkdown(SAMPLE_DIL_EACH);
  assert.ok(md.includes('Low') && md.includes('Medium') && md.includes('71.6%') && !md.includes('{#each'));
});

test('ChatGPTWidgets renders <row> + <favicon> + <divider/> cleanly without raw tags', () => {
  const html = Widgets.renderWidgetsToHtml(SAMPLE_ROW_FAVICON);
  assert.ok(html.includes('lossy-widget-row') && html.includes('lossy-widget-favicon'));
  assert.ok(html.includes('CodexReset.ai') && !html.includes('<row') && !html.includes('<favicon'));

  const md = Widgets.renderWidgetsToMarkdown(SAMPLE_ROW_FAVICON);
  assert.ok(md.includes('[CodexReset.ai](https://codexreset.ai/)') && !md.includes('<row') && !md.includes('<favicon'));
});

test('ChatGPTWidgets preserves fenced code blocks and blocks XSS/CSS injection', () => {
  const fenced = 'Ejemplo:\n\n```jsx\n<grid columns={2}><card>Literal</card></grid>\n```';
  assert.equal(Widgets.hasVisualWidgets(fenced), false);
  assert.equal(Widgets.renderWidgetsToMarkdown(fenced), fenced);

  const malicious = '<card><box height={7} background="red;expression(alert(1))"><box width="50%" background="javascript:alert(1)"/></box><text><script>alert(1)</script></text></card>';
  const html = Widgets.renderWidgetsToHtml(malicious);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('expression('));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('width:50%;background:#16a34a'));
});

test('DocumentModel & ExportCenter strip <Cite/>, <SuggestAutomation/>, <DisplayAutomation/>, inline <text>, and internal Automation JSON', async () => {
  const entity = {
    canonicalId: 'conv_dil_full',
    title: 'Límites de Codex',
    source: { platform: 'chatgpt', conversationId: 'c1' },
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        isConversational: true,
        text: [
          'Texto con cita. <Cite refs={["turn524724search0"]}/>',
          '',
          '| Funcionalidad | Mixdog |',
          '|---|---|',
          '| Navegar | <text color="success">Sí</text> |',
          '| Imágenes | <text color="warning">No confirmado</text> |',
          '',
          SAMPLE_DIL_EACH,
          '',
          '<SuggestAutomation label="Avisarme"/>',
          '<DisplayAutomation automation_id="abc123"/>'
        ].join('\n')
      },
      {
        id: 'm2',
        role: 'assistant',
        isConversational: true,
        text: '{"path":"/Automations/implicit_link::connector_openai_automations/create","args":{"title":"Test"}}'
      }
    ]
  };

  const prepared = await DocumentModel.prepare([entity], { title: 'Límites de Codex', includeImages: false });
  assert.equal(prepared.messageCount, 1, 'Internal Automation JSON turn must be excluded');
  assert.ok(!prepared.html.includes('Cite') && !prepared.html.includes('SuggestAutomation') && !prepared.html.includes('DisplayAutomation'));
  assert.ok(!prepared.html.includes('&lt;text') && prepared.html.includes('color:#15803d'));
  assert.ok(prepared.html.includes('width:72%;background:#3b82f6'));
  assert.ok(!prepared.markdown.includes('<Cite') && !prepared.markdown.includes('<text') && !prepared.markdown.includes('{#each'));

  const center = new ExportCenterMod.ExportCenter();
  const mdRes = await center.exportSingle(entity, 'md', 'ai', { imageStrategy: 'omit' });
  assert.ok(!mdRes.data.includes('<Cite') && !mdRes.data.includes('<text') && !mdRes.data.includes('/Automations/'));
});

test('Extension PNG icons have exact square proportions and transparent SVG logo exists', () => {
  const iconsDir = path.join(__dirname, '..', '..', 'extension', 'icons');
  for (const size of [16, 32, 48, 128]) {
    const buf = fs.readFileSync(path.join(iconsDir, `icon${size}.png`));
    assert.equal(buf.readUInt32BE(16), size);
    assert.equal(buf.readUInt32BE(20), size);
  }
  assert.ok(fs.existsSync(path.join(iconsDir, 'logo-lossy.svg')));
});
