'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportCenter, AssetResolver } = require('../../extension/src/core/portability/export_center');
const { parseZip } = require('../../extension/src/core/portability/zip_builder');
const HtmlBuilder = require('../../extension/src/core/portability/html_builder');
const ChatGPTWidgets = require('../../extension/src/core/chatgpt_widgets');

test('R14 P1: application/octet-stream + original.png con HTML no se empaqueta como imagen via Blob, dataURI o fetch', async () => {
  const htmlBytes = Buffer.from('<!DOCTYPE html><html><body>Access Denied</body></html>', 'utf8');
  const htmlDataUri = `data:application/octet-stream;base64,${htmlBytes.toString('base64')}`;

  // 1) Blob / Uint8Array (incluso sin kind:'image')
  const blobConv = {
    canonicalId: 'r14_blob',
    title: 'Blob HTML',
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: 'Adjunto',
      attachments: [{
        id: 'att_blob',
        filename: 'original.png',
        mimeType: 'application/octet-stream',
        data: new Uint8Array(htmlBytes)
      }]
    }]
  };
  const blobRes = await AssetResolver.resolveAssetBinaries(blobConv);
  assert.equal(blobRes.assets[0].availability, 'unavailable');
  assert.equal(blobRes.assetBinaryMap.has('att_blob'), false);

  const blobZipRes = await new ExportCenter().exportSingle(blobConv, 'md', 'ai', { imageStrategy: 'package' });
  const blobZip = parseZip(blobZipRes.data);
  assert.equal(Object.prototype.hasOwnProperty.call(blobZip, 'assets/original.png'), false);

  // 2) dataURI
  const uriConv = {
    canonicalId: 'r14_uri',
    title: 'DataURI HTML',
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: 'Adjunto',
      attachments: [{
        id: 'att_uri',
        filename: 'original.png',
        mimeType: 'application/octet-stream',
        dataURI: htmlDataUri
      }]
    }]
  };
  const uriRes = await AssetResolver.resolveAssetBinaries(uriConv);
  assert.equal(uriRes.assets[0].availability, 'unavailable');
  assert.equal(uriRes.assetBinaryMap.has('att_uri'), false);

  const uriZipRes = await new ExportCenter().exportSingle(uriConv, 'md', 'ai', { imageStrategy: 'package' });
  const uriZip = parseZip(uriZipRes.data);
  assert.equal(Object.prototype.hasOwnProperty.call(uriZip, 'assets/original.png'), false);

  // 3) fetch con kind:'image' y sin kind:'image' en paquete ZIP
  const fetchWithKind = {
    canonicalId: 'r14_fetch_kind',
    title: 'Fetch Kind HTML',
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: 'Adjunto',
      attachments: [{
        id: 'att_fk',
        kind: 'image',
        filename: 'original.png',
        mimeType: 'application/octet-stream',
        sourceURL: 'https://example.com/login.html'
      }]
    }]
  };
  const fakeFetchHtml = async () => new Response(htmlBytes, { headers: { 'content-type': 'text/html' } });
  const fkRes = await AssetResolver.resolveAssetBinaries(fetchWithKind, { fetch: fakeFetchHtml });
  assert.notEqual(fkRes.assets[0].availability, 'downloaded');
  assert.equal(fkRes.assetBinaryMap.has('att_fk'), false);

  const fetchUntyped = {
    canonicalId: 'r14_fetch_untyped',
    title: 'Fetch Untyped HTML',
    messages: [{
      id: 'm1',
      role: 'assistant',
      text: 'Adjunto',
      attachments: [{
        id: 'att_fu',
        filename: 'original.png',
        mimeType: 'application/octet-stream',
        sourceURL: 'https://example.com/login.html'
      }]
    }]
  };
  const fuZipRes = await new ExportCenter().exportSingle(fetchUntyped, 'md', 'ai', { imageStrategy: 'package', fetch: fakeFetchHtml });
  const fuZip = parseZip(fuZipRes.data);
  assert.equal(Object.prototype.hasOwnProperty.call(fuZip, 'assets/original.png'), false);
  const manifest = JSON.parse(Buffer.from(fuZip['manifest.json']).toString('utf8'));
  assert.equal(manifest.assets.unavailable, 1);
});

test('R14 P2a: span inline multi-línea `<grid>\\nend` no filtra widgetDepth a bloques indentados posteriores', () => {
  const mdInput = [
    '`<grid>',
    'end`',
    '',
    '    <Cite id="keep-cite"/>'
  ].join('\n');

  const mdOut = ChatGPTWidgets.renderWidgetsToMarkdown(mdInput);
  const txtOut = ChatGPTWidgets.renderWidgetsToPlainText(mdInput);
  const htmlOut = ChatGPTWidgets.renderWidgetsToHtml(mdInput);
  const stripOut = ChatGPTWidgets.stripControlTokensOnly(mdInput);

  assert.match(mdOut, /<Cite id="keep-cite"\/>/, 'Markdown debe preservar <Cite/> en bloque indentado');
  assert.match(txtOut, /<Cite id="keep-cite"\/>/, 'TXT debe preservar <Cite/> en bloque indentado');
  assert.match(htmlOut, /<Cite id="keep-cite"\/>/, 'HTML widget renderer debe preservar <Cite/> en bloque indentado');
  assert.match(stripOut, /<Cite id="keep-cite"\/>/, 'stripControlTokensOnly debe preservar <Cite/> en bloque indentado');

  const docHtml = HtmlBuilder.buildStandaloneHtml({
    title: 'R14 Multi-line Inline Code',
    messages: [{ id: 'm1', role: 'assistant', text: mdInput }]
  });
  assert.match(docHtml, /&lt;Cite id=&quot;keep-cite&quot;\/&gt;|&lt;Cite id=&#39;keep-cite&#39;\/&gt;|&lt;Cite id="keep-cite"\/&gt;/);
  assert.equal(ChatGPTWidgets.hasVisualWidgets(mdInput), false);
});

test('R14 P2b: `<grid>literal</grid>` en código inline y etiquetas escapadas \\<grid>...\\</grid> se preservan literalmente', () => {
  const inlineBalanced = 'Literal inline: `<grid>literal</grid>` y multi:\n`<grid>\n<card title="x"/>\n</grid>`';
  assert.equal(ChatGPTWidgets.hasVisualWidgets(inlineBalanced), false);
  assert.equal(ChatGPTWidgets.renderWidgetsToMarkdown(inlineBalanced), inlineBalanced);
  assert.equal(ChatGPTWidgets.renderWidgetsToPlainText(inlineBalanced), inlineBalanced);
  assert.equal(ChatGPTWidgets.renderWidgetsToHtml(inlineBalanced), inlineBalanced);

  const inlineDoc = HtmlBuilder.buildStandaloneHtml({
    title: 'R14 Balanced Inline',
    messages: [{ id: 'm1', role: 'assistant', text: inlineBalanced }]
  });
  assert.equal(inlineDoc.includes('<div class="lossy-widget-root"'), false);
  assert.match(inlineDoc, /<code>&lt;grid&gt;literal&lt;\/grid&gt;<\/code>/);

  const escaped1 = 'Escapado: \\<grid>literal</grid> fin';
  const escaped2 = 'Escapado total: \\<grid\\>literal\\</grid\\> fin';
  const escaped3 = 'Escapado mixto: \\<grid>literal\\</grid> fin';

  for (const sample of [escaped1, escaped2, escaped3]) {
    assert.equal(ChatGPTWidgets.hasVisualWidgets(sample), false);
    assert.equal(ChatGPTWidgets.renderWidgetsToMarkdown(sample), sample);
    assert.equal(ChatGPTWidgets.renderWidgetsToPlainText(sample), sample);
    assert.equal(ChatGPTWidgets.renderWidgetsToHtml(sample), sample);
    const doc = HtmlBuilder.buildStandaloneHtml({
      title: 'R14 Escaped Widgets',
      messages: [{ id: 'm1', role: 'assistant', text: sample }]
    });
    assert.equal(doc.includes('<div class="lossy-widget-root"'), false);
  }

  // Control positivo: \\\\ seguido de <grid> sí debe renderizar widget (backslash escapado)
  const unescapedAfterEvenBs = 'Control: \\\\<grid cols="2"><card title="Uno"/><card title="Dos"/></grid>';
  assert.equal(ChatGPTWidgets.hasVisualWidgets(unescapedAfterEvenBs), true);
  assert.match(ChatGPTWidgets.renderWidgetsToHtml(unescapedAfterEvenBs), /lossy-widget-root/);
});
