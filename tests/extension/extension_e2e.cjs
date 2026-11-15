'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');const dependencies=path.resolve(process.env.LOSSY_QA_MODULES||'node_modules');
if(process.env.LOSSY_QA_BROWSER_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(process.env.LOSSY_QA_BROWSER_PATH);
const {chromium}=require(path.join(dependencies,'playwright'));const {parseZip}=require(path.join(root,'extension/src/core/portability/zip_builder'));
const fixture=require('./fixtures/chatgpt_assets.json');
const output=path.resolve(process.env.LOSSY_QA_OUTPUTS||'scratch/extension-e2e');fs.mkdirSync(output,{recursive:true});
const profile=path.resolve(process.env.LOSSY_QA_PROFILE||'scratch/extension-test-profile');
(async()=>{
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,timeout:20000,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1200,height:900},colorScheme:'dark',args:['--lang=es-ES','--disable-extensions-except='+path.join(root,'extension'),'--load-extension='+path.join(root,'extension')],acceptDownloads:true});
 context.setDefaultTimeout(20000);
 console.log('Extension test browser started.');
 let popup;const failures=[];const network=[];
 context.on('page',p=>p.on('pageerror',error=>failures.push(error.message)));
 await context.route('https://chatgpt.com/**',async route=>{
  const url=new URL(route.request().url());const p=url.pathname;network.push({path:p,authorization:route.request().headers().authorization});
  if(p.startsWith('/vendor/'))return route.fulfill({body:fs.readFileSync(path.join(dependencies,'pdfjs-dist/build',path.basename(p))),contentType:'text/javascript'});
  if(p==='/api/auth/session')return route.fulfill({json:{accessToken:'fixture-session-token'}});
  if(p==='/backend-api/conversation/fixture-chat')return route.fulfill({json:fixture.raw});
  if(p.startsWith('/backend-api/files/download/')){
   assert.equal(route.request().headers().authorization,'Bearer fixture-session-token');const id=p.split('/').pop();return route.fulfill({json:{download_url:'https://files.oaiusercontent.com/'+id,file_name:fixture.images[id].name}});
  }
  if(p.startsWith('/backend-api/'))return route.fulfill({status:404,json:{detail:'fixture endpoint unavailable'}});
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Create Avatar Illustration - ChatGPT</title><main><article data-testid="conversation-turn-2"><h4 class="sr-only">ChatGPT dijo:</h4><div data-message-author-role="assistant" data-message-id="assistant-msg"><div class="markdown"><div data-testid="plugin-header"><button>Complemento · control interno</button></div><p>Estas son las dos variantes del diseño.</p></div></div></article></main>'});
 });
 await context.route('https://files.oaiusercontent.com/**',route=>{
  assert.equal(route.request().headers().authorization,undefined);const image=fixture.images[new URL(route.request().url()).pathname.slice(1)];return route.fulfill({body:Buffer.from(image.base64,'base64'),contentType:image.mime,headers:{'access-control-allow-origin':'*'}});
 });
 async function openPopup(worker){const next=context.waitForEvent('page',{timeout:10000});await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('src/popup/popup.html'),active:false}));const p=await next;await p.setViewportSize({width:400,height:780});await p.waitForLoadState('domcontentloaded');return p;}
 async function download(button,name){const event=popup.waitForEvent('download');await button.click();const file=await event;const target=path.join(output,name||file.suggestedFilename());await file.saveAs(target);return {bytes:fs.readFileSync(target),name:file.suggestedFilename(),path:target};}
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});const extensionId=new URL(worker.url()).host;
  console.log('Extension service worker loaded.');
  const chat=await context.newPage();await chat.goto('https://chatgpt.com/c/fixture-chat');
  popup=await openPopup(worker);await popup.locator('#conversation-info').waitFor({state:'visible'});await popup.locator('#btn-capture-update').click();await popup.locator('#asset-readiness').filter({hasText:'5 de 5 imágenes guardadas'}).waitFor({timeout:60000});
  assert.equal(await popup.locator('#btn-popup-export').isEnabled(),true);assert.equal(await popup.locator('#btn-claude-packet').isEnabled(),true);
  const saved=await popup.evaluate(async()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat'));
  assert.equal(saved.messages[0].attachments.length,3);assert.equal(saved.messages[1].attachments.length,2);assert.ok(saved.messages.every(m=>m.attachments.every(a=>a.dataURI)));
  assert.equal(network.filter(n=>n.path.startsWith('/backend-api/files/download/')).length,5);
  const bounds=await popup.locator('.quick-format-card').first().boundingBox();assert.ok(Math.abs(bounds.width-bounds.height)<2 && bounds.width>=100);
  await popup.screenshot({path:path.join(output,'popup-dark.png'),animations:'disabled'});console.log('PASS actual extension capture: 5 offscreen images persisted in IndexedDB; square controls.');
  await popup.getByRole('button',{name:'Exportar MD',exact:true}).click();await popup.locator('#md-export-dialog').waitFor({state:'visible'});await popup.screenshot({path:path.join(output,'markdown-choice.png'),animations:'disabled'});
  await popup.locator('#btn-cancel-md-export').click();await popup.locator('#md-export-dialog').waitFor({state:'hidden'});
  await popup.getByRole('button',{name:'Exportar MD',exact:true}).click();
  const zip=await download(popup.locator('[data-md-strategy="package"]'),'markdown-with-images.zip');const files=parseZip(zip.bytes);
  assert.equal(Object.keys(files).filter(k=>k.startsWith('assets/')).length,5);const md=Buffer.from(files[Object.keys(files).find(k=>k.endsWith('.md'))]).toString();assert.doesNotMatch(md,/app:\/\/|plugins_6ada/);
  for(const match of md.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g))assert.ok(files[decodeURIComponent(match[1])]);
  await popup.getByRole('button',{name:'Exportar MD',exact:true}).click();const single=await download(popup.locator('[data-md-strategy="embed"]'),'conversation.md');assert.equal((single.bytes.toString().match(/data:image\//g)||[]).length,5);
  await popup.locator('#btn-popup-export').click();
  const pdf=await download(popup.locator('[data-format="pdf"]'),'conversation.pdf');assert.equal((pdf.bytes.toString('latin1').match(/\/Subtype \/Image/g)||[]).length,5);assert.doesNotMatch(pdf.bytes.toString('latin1'),/Recurso visual no disponible|app:\/\//);
  const docx=await download(popup.getByRole('button',{name:'Exportar DOCX',exact:true}),'conversation.docx');assert.equal(Object.keys(parseZip(docx.bytes)).filter(p=>p.startsWith('word/media/')).length,5);
  console.log('PASS real popup downloads: MD, Markdown ZIP, PDF and DOCX contain all 5 images and clean app mention.');
  const json=await download(popup.locator('[data-format="json"]'),'conversation.json');assert.equal(JSON.parse(json.bytes).messages[0].attachments.length,3);
  const text=await download(popup.locator('[data-format="txt"]'),'conversation.txt');assert.doesNotMatch(text.bytes.toString(),/app:\/\/|plugins_6ada/);
  const png=await download(popup.locator('[data-format="png"]'),'conversation-png-pages.zip');
  const pngFiles=parseZip(png.bytes);assert.ok(Object.keys(pngFiles).length>=2);
  for(const [name,bytes] of Object.entries(pngFiles)){assert.ok(Buffer.from(bytes).subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));fs.writeFileSync(path.join(output,name),bytes);}
  const sharp=require(path.join(dependencies,'sharp'));
  const imageColors=[];for(const bytes of Object.values(pngFiles)){const {data,info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});for(let y=0;y<info.height;y+=20)for(let x=0;x<info.width;x+=20){const i=(y*info.width+x)*info.channels;if(Math.abs(data[i]-124)<10&&Math.abs(data[i+1]-95)<10&&Math.abs(data[i+2]-224)<10)imageColors.push('purple');}}
  assert.ok(imageColors.length>30,'PNG pages must include pixels from the captured JPEG, not only text.');
  console.log('PASS JSON, TXT and PNG downloads; PNG pages contain the captured image pixels.');
  await popup.evaluate(async()=>{const db=new LinerDB();const conv=await db.getConversation('conv_chatgpt_fixture-chat');for(const msg of conv.messages){for(const a of msg.attachments){a.dataURI=null;a.data=null;a.availability='unavailable';}msg.content.attachments=msg.attachments;}conv.attachments=conv.messages.flatMap(m=>m.attachments);await new Promise((resolve,reject)=>{const tx=db.db.transaction(['conversations'],'readwrite');tx.objectStore('conversations').put(conv);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});});
  await popup.close();await chat.bringToFront();popup=await openPopup(worker);await popup.locator('#asset-readiness').filter({hasText:'0 de 5 imágenes guardadas'}).waitFor();
  await popup.locator('#btn-popup-export').click();
  const repaired=await download(popup.locator('[data-format="pdf"]'),'recovered-existing-capture.pdf');assert.equal((repaired.bytes.toString('latin1').match(/\/Subtype \/Image/g)||[]).length,5);await popup.locator('#asset-readiness').filter({hasText:'5 de 5 imágenes guardadas'}).waitFor();
  await popup.emulateMedia({colorScheme:'light'});await popup.screenshot({path:path.join(output,'popup-light.png'),animations:'disabled'});
  assert.equal(await popup.locator('.quick-format-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  console.log('PASS existing saved capture: missing image bytes recovered and persisted from the export action.');
  await chat.bringToFront();await chat.evaluate(()=>{const image=document.createElement('img');image.src='https://files.oaiusercontent.com/file_fixture_4';image.width=640;image.height=320;image.alt='Imagen del mensaje';document.querySelector('[data-message-id="assistant-msg"] .markdown').append(image);});
  assert.equal(await chat.locator('.lossy-message-action-btn').count(),1);
  await chat.getByRole('button',{name:'Acciones de contexto Lossy'}).click();await chat.getByText('Guardar como Clip',{exact:true}).click();await chat.locator('.lossy-toast-notice').filter({hasText:'Clip guardado'}).waitFor();
  const clips=await popup.evaluate(async()=>{const db=new LinerDB();return (await db.listMetadata()).filter(m=>m.entityType==='clip');});assert.equal(clips.length,1);assert.equal(clips[0].messageCount,1);
  const clipData=await popup.evaluate(async id=>new LinerDB().getClip(id),clips[0].canonicalId);assert.ok(clipData.selectedMessages[0].attachments[0].dataURI);
  console.log('PASS inline clip action: one control per message, image bytes and message count saved by the real service worker.');
  const workspaceEvent=context.waitForEvent('page');await popup.locator('#btn-claude-packet').click();const workspace=await workspaceEvent;await workspace.waitForLoadState('domcontentloaded');
  await workspace.locator('#view-transfers.active').waitFor();await workspace.locator('#transfer-selected-preview').filter({hasText:'Create Avatar Illustration'}).waitFor();assert.match(await workspace.locator('#transfer-selected-preview').textContent(),/Create Avatar Illustration/);
  await workspace.locator('#transfer-goal').fill('Continuar el diseño del avatar conservando las referencias.');
  for(const target of ['generic','claude','markdown']){
    await workspace.locator('input[name="transfer-target"][value="'+target+'"]').check();
    const pending=workspace.waitForEvent('download');await workspace.locator('#btn-execute-transfer').click();const artifact=await pending;
    const destination=path.join(output,'context-'+target+'.zip');await artifact.saveAs(destination);const packageFiles=parseZip(fs.readFileSync(destination));
    assert.equal(Object.keys(packageFiles).filter(name=>/^assets\/(?!manifest)/.test(name)).length,5);
    assert.match(Buffer.from(packageFiles['CONTEXT_BRIEF.md']).toString(),/Continuar el diseño/);
    const receiptPath=Object.keys(packageFiles).find(name=>name.endsWith('receipt.json'));
    const receipt=JSON.parse(Buffer.from(packageFiles[receiptPath]).toString());
    for(const [name,expected]of Object.entries(receipt.fileHashes))assert.equal(require('node:crypto').createHash('sha256').update(packageFiles[name]).digest('hex'),expected,name);
  }
  await workspace.screenshot({path:path.join(output,'prepare-context.png'),animations:'disabled'});console.log('PASS context preparation: selected conversation carried from popup; 3 complete destination ZIPs with correct binary and Unicode digests.');
  await workspace.locator('#nav-library').click();await workspace.locator('#library-table-body tr[data-id]').first().waitFor();
  assert.equal(await workspace.locator('#summary-saved').textContent(),'1');await workspace.locator('tr[data-id="conv_chatgpt_fixture-chat"] .btn-row-menu').click();await workspace.getByText('Ver detalles',{exact:true}).waitFor();await workspace.keyboard.press('Escape');
  assert.equal(await workspace.locator('#summary-clips').textContent(),'1');
  await workspace.locator('#nav-collections').click();await workspace.locator('#btn-new-collection').click();await workspace.locator('#modal-new-coll-name').fill('Diseño de avatares');await workspace.locator('#app-modal-confirm').click();await workspace.getByText('Diseño de avatares',{exact:true}).first().waitFor();
  const collections=await workspace.evaluate(async()=>new LinerDB().listCollections());assert.equal(collections.length,1);assert.equal(collections[0].name,'Diseño de avatares');
  await workspace.locator('#nav-library').click();console.log('PASS collection creation and library conversation/clip counts.');
  await workspace.screenshot({path:path.join(output,'workspace.png')});
  const verify=await context.newPage();await verify.goto('https://chatgpt.com/validation');
  const pages=await verify.evaluate(async bytes=>{const lib=await import('/vendor/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';const doc=await lib.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;document.body.replaceChildren();for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i),v=p.getViewport({scale:1.25}),canvas=document.createElement('canvas');canvas.id='pdf-page-'+i;canvas.width=v.width;canvas.height=v.height;document.body.append(canvas);await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;}return doc.numPages;},Array.from(pdf.bytes));
  for(let i=1;i<=pages;i++)await verify.locator('#pdf-page-'+i).screenshot({path:path.join(output,'pdf-page-'+i+'.png')});
  assert.deepEqual(failures,[]);console.log('PASS workspace and PDF.js rendering: '+pages+' PDF pages; no uncaught browser errors.');
  fs.writeFileSync(path.join(output,'e2e-results.json'),JSON.stringify({extensionId,imagesPersisted:5,renderedPdfPages:pages,formats:['md','zip','pdf','docx','json','txt','png'],source:'isolated Chromium profile and routed ChatGPT fixtures',uncaughtErrors:failures},null,2));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
