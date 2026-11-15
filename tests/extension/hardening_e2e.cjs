'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.LOSSY_QA_ROOT||path.join(__dirname,'../..')),modules=path.resolve(process.env.LOSSY_QA_MODULES||'node_modules');
if(process.env.LOSSY_QA_BROWSER_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(process.env.LOSSY_QA_BROWSER_PATH);
const {chromium}=require(path.join(modules,'playwright'));const fixture=require('./fixtures/chatgpt_assets.json');
const out=path.resolve(process.env.LOSSY_QA_OUTPUTS||'scratch/hardening-qa');fs.mkdirSync(out,{recursive:true});
const {deflatedZip}=require('./fixtures/zip_cases.cjs');
const profile=path.resolve(process.env.LOSSY_QA_PROFILE||'scratch/hardening-profile');
(async()=>{
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1200,height:900},colorScheme:'dark',acceptDownloads:true,args:['--disable-extensions-except='+path.join(root,'extension'),'--load-extension='+path.join(root,'extension')]});context.setDefaultTimeout(12000);
 let gate;const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('https://chatgpt.com/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;
  if(p==='/api/auth/session')return route.fulfill({json:{accessToken:'test-token'}});
   if(p==='/backend-api/conversations')return route.fulfill({json:{items:[{id:'fixture-chat',title:'Renombrada desde sincronización'}],total:1,offset:0,limit:30}});
  if(p==='/backend-api/conversation/fixture-chat'){
    if(gate)await gate.promise;
    try{return await route.fulfill({json:fixture.raw});}catch(error){if(route.request().failure())return;throw error;}
  }
  if(p.startsWith('/backend-api/files/download/')){const id=p.split('/').pop();return route.fulfill({json:{download_url:'https://files.oaiusercontent.com/'+id,file_name:fixture.images[id].name}});}
  if(p.startsWith('/backend-api/'))return route.fulfill({status:404,body:'not found'});
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hardening - ChatGPT</title><main><article><h4>ChatGPT dijo:</h4><div data-message-author-role="assistant" data-message-id="assistant-msg"><div class="markdown"><p>Respuesta visible</p></div></div></article></main>'});
 });
 await context.route('https://files.oaiusercontent.com/**',route=>{const image=fixture.images[new URL(route.request().url()).pathname.slice(1)];return route.fulfill({body:Buffer.from(image.base64,'base64'),contentType:image.mime,headers:{'access-control-allow-origin':'*'}});});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});const chat=await context.newPage();await chat.goto('https://chatgpt.com/c/fixture-chat');
  const event=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('src/popup/popup.html'),active:false}));const popup=await event;await popup.setViewportSize({width:400,height:780});await popup.locator('#conversation-info').waitFor({state:'visible'});
  if(!process.argv.includes('--storage-only')){
    let release;gate={promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};
    const request=chat.waitForRequest(r=>r.url().includes('/backend-api/conversation/fixture-chat'));await popup.locator('#btn-capture-update').click();await request;await popup.locator('#btn-cancel-capture').click();
    try{await popup.locator('#btn-cancel-capture').waitFor({state:'hidden',timeout:5000});}finally{gate.release();gate=undefined;}
    const saved=await popup.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat'));assert.equal(saved,null);assert.match(await popup.locator('#status-title').textContent(),/cancelada/i);
    await popup.screenshot({path:path.join(out,'capture-cancelled.png'),animations:'disabled'});console.log('PASS delayed structured capture cancellation: request aborted; no DOM fallback or saved record.');
  }
  await popup.evaluate(()=>{const prototype=LinerDB.prototype;globalThis.restoreSave=prototype.saveConversation;prototype.saveConversation=async()=>{throw new DOMException('Storage full','QuotaExceededError');};});
  await popup.locator('#btn-capture-update').click();await popup.locator('#status-title').filter({hasText:'Captura sin guardar'}).waitFor({timeout:60000});
  assert.equal(await popup.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat')),null);
  assert.equal(await popup.locator('#btn-popup-export').isEnabled(),true);
  assert.doesNotMatch(await popup.locator('#asset-readiness').textContent(),/sin conexión|imágenes guardadas/);
  await popup.screenshot({path:path.join(out,'storage-failure.png'),animations:'disabled'});
  const download=popup.waitForEvent('download');await popup.getByRole('button',{name:'Exportar PDF',exact:true}).click();const file=await download;await file.saveAs(path.join(out,'unsaved-capture.pdf'));const bytes=fs.readFileSync(path.join(out,'unsaved-capture.pdf'));assert.equal((bytes.toString('latin1').match(/\/Subtype \/Image/g)||[]).length,5);
  await popup.evaluate(()=>{LinerDB.prototype.saveConversation=globalThis.restoreSave;});
  await popup.locator('#btn-capture-update').click();await popup.locator('#status-title').filter({hasText:'Conversación capturada'}).waitFor({timeout:60000});
  assert.ok(await popup.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat')));
  console.log('PASS storage failure: no false saved/offline status; buffered PDF remains exportable; retry persists successfully.');
   const workerId=new URL(worker.url()).host;
   const workspace=await context.newPage();await workspace.goto('chrome-extension://'+workerId+'/src/workspace/workspace.html');
   await workspace.locator('#nav-settings').click();
   const official=JSON.stringify([{...structuredClone(fixture.raw),id:'fixture-chat'}]);
   const compressed=deflatedZip('conversations.json',official);
   const decoded=await workspace.evaluate(async bytes=>{const files=await Lossy.ZipBuilder.unzip(new Uint8Array(bytes));return new TextDecoder().decode(files['conversations.json']);},Array.from(compressed));assert.equal(decoded,official);
   await workspace.locator('#file-import-export').setInputFiles({name:'official.zip',mimeType:'application/zip',buffer:Buffer.from(compressed)});
   await workspace.locator('#import-status').filter({hasText:'Se importaron y normalizaron con éxito 1'}).waitFor();
   const imported=await workspace.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat'));
   for(const message of imported.messages)for(const asset of message.attachments)assert.ok(asset.dataURI,'existing image must survive reimport');
   assert.equal((await workspace.evaluate(()=>new LinerDB().listMetadata())).filter(m=>m.entityType==='conversation').length,1);
   await workspace.locator('#btn-header-refresh').click();
   await workspace.waitForFunction(async()=>{const conv=await new LinerDB().getConversation('conv_chatgpt_fixture-chat');return conv?.title==='Renombrada desde sincronización';});
   const afterSync=await workspace.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat'));assert.equal(afterSync.title,'Renombrada desde sincronización');assert.equal(afterSync.messages.length,imported.messages.length);
   const broken=compressed.slice();broken[35]^=1;
   await workspace.locator('#file-import-export').setInputFiles({name:'damaged.zip',mimeType:'application/zip',buffer:Buffer.from(broken)});
   await workspace.locator('#import-status').filter({hasText:'Error en importación'}).waitFor();
   const afterError=await workspace.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_fixture-chat'));assert.deepEqual(afterError,afterSync);
   await workspace.screenshot({path:path.join(out,'damaged-import.png'),animations:'disabled'});
   console.log('PASS browser Deflate import, damaged ZIP rejection, image retention and metadata refresh without data loss.');
   const {createZip}=require('../../extension/src/core/portability/zip_builder');
   const importInput=workspace.locator('#file-import-export');
   const importStatus=workspace.locator('#import-status');
   const snapshot=await workspace.evaluate(()=>new LinerDB().listMetadata());
   const invalidFiles=[
     {name:'unrelated.json',buffer:Buffer.from('{"hello":"world"}')},
     {name:'null.json',buffer:Buffer.from('null')},
     {name:'mixed.json',buffer:Buffer.from(JSON.stringify([{...structuredClone(fixture.raw),id:'must-not-save'},{foo:'unrelated'}]))},
     {name:'duplicates.json',buffer:Buffer.from(JSON.stringify([{...structuredClone(fixture.raw),id:'repeated'},{...structuredClone(fixture.raw),id:'repeated'}]))},
     {name:'misleading.zip',buffer:Buffer.from(createZip({'notconversations.json':official}))},
     {name:'ambiguous.zip',buffer:Buffer.from(createZip({'a/conversations.json':official,'b/conversations.json':official}))}
   ];
   for(const file of invalidFiles){
     await importInput.setInputFiles({...file,mimeType:file.name.endsWith('.zip')?'application/zip':'application/json'});
     await importStatus.filter({hasText:'Error en importación'}).waitFor();
     await workspace.waitForFunction(()=>!document.querySelector('#file-import-export').disabled);
     assert.equal(await importInput.inputValue(),'');
     assert.deepEqual(await workspace.evaluate(()=>new LinerDB().listMetadata()),snapshot,'invalid input must leave the library intact: '+file.name);
   }
   await workspace.evaluate(()=>{globalThis.originalImportSave=LinerDB.prototype.saveConversation;LinerDB.prototype.saveConversation=async function(conv){if(conv.canonicalId==='conv_chatgpt_partial-b')throw new DOMException('Storage full','QuotaExceededError');return globalThis.originalImportSave.call(this,conv);};});
   const retryFile={name:'retry.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{...structuredClone(fixture.raw),id:'partial-a'},{...structuredClone(fixture.raw),id:'partial-b'}]))};
   await importInput.setInputFiles(retryFile);
   await importStatus.filter({hasText:'Se guardaron 1 de 2 conversaciones'}).waitFor();
   assert.equal(await importInput.inputValue(),'');assert.equal(await importInput.isEnabled(),true);
   assert.ok(await workspace.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_partial-a')));
   assert.equal(await workspace.evaluate(()=>new LinerDB().getConversation('conv_chatgpt_partial-b')),null);
   await workspace.screenshot({path:path.join(out,'partial-import.png'),animations:'disabled'});
   await workspace.evaluate(()=>{LinerDB.prototype.saveConversation=globalThis.originalImportSave;});
   await importInput.setInputFiles(retryFile);
   await importStatus.filter({hasText:'Se importaron y normalizaron con éxito 2'}).waitFor();
   for(const id of ['partial-a','partial-b'])assert.ok(await workspace.evaluate(id=>new LinerDB().getConversation('conv_chatgpt_'+id),id));
   assert.equal((await workspace.evaluate(()=>new LinerDB().listMetadata())).length,snapshot.length+2);
   console.log('PASS invalid/mixed JSON and ambiguous ZIP rejection; partial storage failure is explicit and the same file can be retried without duplicates.');
  assert.deepEqual(errors,[]);
   fs.writeFileSync(path.join(out,'failure-results.json'),JSON.stringify({cancelledCapture:true,storageFailure:true,recoveryRetry:true,validDeflateImport:true,damagedImportRejected:true,localImagesRetainedOnImport:true,syncPreservesContent:true,invalidInputsRejected:invalidFiles.length,partialImportReported:true,sameFileRetry:true,bufferedImagesExported:5,uncaughtErrors:errors},null,2));
 }finally{gate?.release();await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
