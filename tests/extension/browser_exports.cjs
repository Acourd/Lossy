const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const modules=path.resolve(process.env.LOSSY_QA_MODULES || 'node_modules');
if (process.env.LOSSY_QA_BROWSER_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(process.env.LOSSY_QA_BROWSER_PATH);
const {chromium}=require(modules+'/playwright');
const root=path.resolve(__dirname,'../..');const outputs=path.resolve(process.env.LOSSY_QA_OUTPUTS || 'scratch/extension-qa');fs.mkdirSync(outputs,{recursive:true});
const server=http.createServer((req,res)=>{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=pathname.startsWith('/vendor/') ? path.join(modules,'pdfjs-dist/build',path.basename(pathname)) : path.join(root,pathname);if(!file.startsWith(root)&&!file.startsWith(modules)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');res.end(data);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 let browser;
 try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.addInitScript(()=>{try{localStorage.setItem('lossy.uiLanguage','es');}catch(_){}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/extension/src/workspace/workspace.html');
  await page.waitForFunction(()=>!!window.Lossy?.defaultDB);
  await page.evaluate(async()=>{const db=window.Lossy.defaultDB;await db.open();await db.clearAll();const titles=['Arquitectura de un producto digital','Investigación y referencias de diseño','Plan de lanzamiento · noviembre'];for(let i=0;i<titles.length;i++)await db.saveConversation({canonicalId:'fixture_'+i,title:titles[i],model:'Modelo capturado',source:{platform:'chatgpt',url:'https://chatgpt.com/c/fixture-'+i},integrity:{status:i===1?'partial':'captured'},messages:[{id:'m_'+i,role:'user',content:{text:'Necesito organizar las ideas de mi proyecto.'}},{id:'a_'+i,role:'assistant',content:{text:'Podemos avanzar con una estructura clara y decisiones documentadas.'}}]});});
  await page.reload();await page.locator('#library-table-body tr[data-id]').first().waitFor();
  assert.equal(await page.locator('#summary-saved').textContent(),'3');
  await page.waitForFunction(()=>document.querySelector('.brand-glyph-img')?.complete);
  assert.equal(await page.locator('.brand-glyph-img').evaluate(img=>img.naturalWidth>0),true);
  await page.screenshot({path:path.join(outputs,'workspace-preview.png')});
  await page.locator('.btn-row-menu').first().click();await page.getByText('Ver detalles',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#global-search').fill('no-existe-fixture');await page.getByText('No hay resultados con estos filtros',{exact:true}).waitFor();assert.equal(await page.locator('#check-all').isDisabled(),true);
  await page.locator('#global-search').fill('');await page.locator('#library-table-body tr[data-id]').first().waitFor();
  await page.setViewportSize({width:600,height:900});await page.screenshot({path:path.join(outputs,'workspace-mobile-preview.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.body.className='theme-light');await page.screenshot({path:path.join(outputs,'workspace-light-preview.png')});
  // Actual browser image codec, export pipeline and PDF rasterization.
  const result=await page.evaluate(async()=>{
   const c=document.createElement('canvas');c.width=500;c.height=220;const ctx=c.getContext('2d');ctx.fillStyle='#d9eee6';ctx.fillRect(0,0,500,220);ctx.fillStyle='#1b5f4b';ctx.fillRect(25,25,100,170);ctx.fillStyle='#387c68';ctx.fillRect(145,65,100,130);ctx.fillStyle='#7bb39b';ctx.fillRect(265,105,100,90);ctx.fillStyle='#183e31';ctx.font='20px sans-serif';ctx.fillText('Evidencia visual',285,40);
   const image={id:'image-a',kind:'image',mimeType:'image/png',filename:'grafica.png',dataURI:c.toDataURL()};
   const entity={canonicalId:'visual',title:'Revisión de exportación · imágenes',source:{platform:'chatgpt'},integrity:{status:'captured'},messages:[{id:'u',role:'user',content:{text:'Conserva esta imagen y la explicación en el documento.'}},{id:'a',role:'assistant',content:{text:'La gráfica conserva el color, la proporción y los acentos: análisis, diseño y evolución. pluginconnector-raw\n\n```js\n  const resultado = 42;\n```',codeBlocks:[{language:'js',code:'  const resultado = 42;'}]},attachments:[image]}]};
   const center=new Lossy.ExportCenter.ExportCenter();const pdf=await center.exportSingle(entity,'pdf');const md=await center.exportSingle(entity,'md');
   const png=await center.exportSingle(entity,'png');return {pdf:Array.from(pdf.data),md:md.data,png:Array.from(png.data)};
  });
  fs.writeFileSync(path.join(outputs,'export-validation.pdf'),Buffer.from(result.pdf));fs.writeFileSync(path.join(outputs,'export-validation.md'),result.md);assert.ok(Buffer.from(result.png).subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));
  await page.evaluate(async bytes=>{const lib=await import('/vendor/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';const doc=await lib.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;const pdfPage=await doc.getPage(1);const viewport=pdfPage.getViewport({scale:1.5});const canvas=document.createElement('canvas');canvas.id='pdf-validation';canvas.width=viewport.width;canvas.height=viewport.height;document.body.replaceChildren(canvas);await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const text=await pdfPage.getTextContent();window.validationText=text.items.map(i=>i.str).join(' ');},result.pdf);
  await page.locator('#pdf-validation').screenshot({path:path.join(outputs,'pdf-validation-preview.png')});assert.doesNotMatch(await page.evaluate(()=>window.validationText),/connector-raw||/);
  // DOM fixture: tool header removed, real content retained and images matched by message ID.
  await page.goto(url+'/extension/src/workspace/workspace.html');
  await page.evaluate(()=>{window.module={exports:{}};});await page.addScriptTag({url:url+'/extension/src/content/content_script.js'});
  const dom=await page.evaluate(async()=>{const host=document.createElement('main');host.innerHTML='<div data-message-id="right" data-message-author-role="assistant"><div class="markdown"><div data-testid="plugin-header"><img src="https://example.test/plugin-logo.png" width="64" height="64">Complemento interno</div><p>Respuesta útil</p><img src="data:image/png;base64,iVBORw0KGgo=" width="100" height="100"></div></div>';document.body.append(host);const api=module.exports;const turns=api.extractVisibleTurns(host);return {turns,clean:api.ChatGPTMessageActionsAdapter.extractTurnData(host.firstElementChild)};});
  assert.equal(dom.turns.length,1);assert.equal(dom.turns[0].attachments.length,1);assert.doesNotMatch(dom.turns[0].text,/Complemento interno/);assert.equal(dom.clean.attachments.length,1);
  const associations=await page.evaluate(async()=>{const original={messages:[{id:'unrelated',role:'assistant',attachments:[]},{id:'right',role:'assistant',attachments:[]}]};const enriched=await module.exports.enrichConversationWithLiveDomAssets(original);return {unrelated:enriched.messages[0].attachments.length,right:enriched.messages[1].attachments.length,original:original.messages[1].attachments.length};});
  assert.deepEqual(associations,{unrelated:0,right:1,original:0});
  await page.goto(url+'/extension/src/popup/popup.html');await page.screenshot({path:path.join(outputs,'popup-preview.png')});
  assert.deepEqual(errors,[]);console.log('Browser QA passed: menus, search, responsive layout, icons, PNG, Markdown, PDF rendered with PDF.js, DOM connector isolation.');
 } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
