'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||process.env.LOSSY_QA_ROOT||path.join(__dirname,'../..')),label=process.argv[3]||'current',out=path.resolve(process.env.LOSSY_QA_OUTPUTS||'scratch/optimization-bench');fs.mkdirSync(out,{recursive:true});
const modules=path.resolve(process.env.LOSSY_QA_MODULES||'node_modules');if(process.env.LOSSY_QA_BROWSER_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(process.env.LOSSY_QA_BROWSER_PATH);const {chromium}=require(path.join(modules,'playwright'));
(async()=>{
 const context=await chromium.launchPersistentContext(path.resolve(process.env.LOSSY_QA_PROFILE||'scratch/optimization-profile-'+label+'-'+Date.now()),{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1300,height:900},args:['--lang=es-ES','--disable-extensions-except='+path.join(root,'extension'),'--load-extension='+path.join(root,'extension')]});context.setDefaultTimeout(30000);
 const errors=[];try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome-extension://'+id+'/src/workspace/workspace.html');await page.locator('#nav-library').waitFor();await page.waitForFunction(()=>document.querySelector('#library-table-body')?.children.length>0);
  await page.evaluate(async()=>{
   const db=new LinerDB();await db.open();await new Promise((resolve,reject)=>{const tx=db.db.transaction(['conversations','metadata_index'],'readwrite');for(let i=0;i<1500;i++){const canonicalId='conv_fixture_'+String(i).padStart(4,'0'),title=(i<15?'Needle ':'History ')+i;const conv={canonicalId,title,source:{platform:'chatgpt'},messages:[{id:'m'+i,role:'user',content:{text:'Texto guardado '+i}}],integrity:{status:'captured'},updatedAt:'2026-10-28T00:00:00.000Z'};const {record,meta}=db.conversationRecords(conv);tx.objectStore('conversations').put(record);tx.objectStore('metadata_index').put(meta);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
   globalThis.perfState={reads:0,mutations:0};const original=LinerDB.prototype.listMetadata;LinerDB.prototype.listMetadata=async function(...args){perfState.reads++;return original.apply(this,args);};new MutationObserver(records=>{perfState.mutations+=records.filter(r=>r.type==='childList').length;}).observe(document.querySelector('#library-table-body'),{childList:true});
  });
  const start=Date.now();await page.locator('#nav-library').click();await page.waitForFunction(()=>document.querySelectorAll('#library-table-body tr[data-id]').length===100);await page.waitForFunction(()=>document.querySelector('#count-tab-all')?.textContent==='1500');
  const load=await page.evaluate(()=>({...perfState}));load.elapsedMs=Date.now()-start;
  const search=await page.evaluate(async()=>{perfState.mutations=0;perfState.reads=0;const field=document.querySelector('#global-search'),start=performance.now();for(const text of ['N','Ne','Nee','Need','Needl','Needle']){field.value=text;field.dispatchEvent(new Event('input',{bubbles:true}));}await new Promise(resolve=>setTimeout(resolve,250));return {...perfState,elapsedMs:performance.now()-start,rows:document.querySelectorAll('#library-table-body tr[data-id]').length,label:document.querySelector('#library-total-label').textContent};});
  assert.equal(search.rows,15);assert.match(search.label,/15.*1500/);
  await page.locator('.row-select').nth(0).click();await page.locator('.row-select').nth(3).click({modifiers:['Shift']});assert.equal(await page.locator('.row-select:checked').count(),4);
  await page.locator('#check-all').check();assert.equal(await page.locator('.row-select:checked').count(),15);
  await page.locator('#btn-bulk-clear').click();assert.equal(await page.locator('.row-select:checked').count(),0);
  await page.locator('#global-search').fill('No matching rows');await page.waitForFunction(()=>document.querySelector('#library-table-body .empty-row'));assert.equal(await page.locator('#check-all').isDisabled(),true);
  await page.locator('#global-search').fill('Needle');await page.waitForFunction(()=>document.querySelectorAll('#library-table-body tr[data-id]').length===15);
  await page.locator('tr[data-id] .btn-row-menu').first().click();await page.getByText('Ver detalles',{exact:true}).waitFor();await page.keyboard.press('Escape');
  const payload=await page.locator('.drag-handle').first().evaluate(handle=>{const transfer=new DataTransfer();handle.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const value=JSON.parse(transfer.getData('application/lossy-context'));handle.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));return value;});assert.equal(payload.ids.length,1);assert.match(payload.ids[0],/^conv_fixture_/);
  if(label!=='before'){assert.equal(load.reads,1);assert.equal(load.mutations,1);assert.equal(search.mutations,1);}
  const resources=await page.evaluate(async()=>{
   const Resolver=Lossy.ExportCenter.AssetResolver;
   const input={messages:Array.from({length:8},(_,i)=>({id:'image-msg-'+i,role:'user',attachments:[{id:'asset-'+i,filename:i+'.png',mimeType:'image/png',sourceURL:'https://example.com/'+(i%4)+'.png'}]}))};
   let calls=0,active=0,peak=0,bodyReads=0;
   const resolved=await Resolver.resolveAssetBinaries(input,{fetch:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>{bodyReads++;return Uint8Array.from([1,2,3]).buffer;}};}});
   for(const message of input.messages){delete message.attachments[0].sourceURL;message.attachments[0].dataURI='data:image/png;base64,AQID';}
   const local=await Resolver.resolveAssetBinaries(input);
   return {calls,peak,bodyReads,downloaded:resolved.assets.filter(a=>a.availability==='downloaded').length,decodedBuffers:new Set(local.assets.map(a=>a.data)).size,bytes:Array.from(local.assetBinaryMap.get('asset-0'))};
  });
  if(label!=='before'){assert.deepEqual(resources,{calls:4,peak:4,bodyReads:4,downloaded:8,decodedBuffers:1,bytes:[1,2,3]});}
  assert.deepEqual(errors,[]);
  const result={label,count:1500,load,search,selection:true,rangeSelection:true,selectAllVisible:true,drag:true,resources,uncaughtErrors:errors};fs.writeFileSync(path.join(out,label+'-workspace.json'),JSON.stringify(result,null,2));await page.screenshot({path:path.join(out,label+'-workspace.png')});console.log(JSON.stringify(result,null,2));
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
