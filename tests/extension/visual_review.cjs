'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.LOSSY_QA_ROOT||path.join(__dirname,'../..')),modules=path.resolve(process.env.LOSSY_QA_MODULES||'node_modules');
if(process.env.LOSSY_QA_BROWSER_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(process.env.LOSSY_QA_BROWSER_PATH);
const {chromium}=require(path.join(modules,'playwright')),fixture=require('./fixtures/chatgpt_assets.json');
const out=path.resolve(process.env.LOSSY_QA_OUTPUTS||'scratch/visual-review'),profile=path.resolve(process.env.LOSSY_QA_PROFILE||'scratch/visual-profile');fs.mkdirSync(out,{recursive:true});
const baseline=process.argv.includes('--baseline');
async function screenshot(page,name){await page.screenshot({path:path.join(out,name+'.png')});}
async function noPageOverflow(page){return page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));}
async function contrasts(page,selectors){return page.evaluate(selectors=>{
 const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
 const luminance=values=>values.slice(0,3).map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 return selectors.map(selector=>{const element=document.querySelector(selector);if(!element)throw Error('Missing contrast target '+selector);const fg=rgb(getComputedStyle(element).color);let node=element,bg;
  while(node){const color=rgb(getComputedStyle(node).backgroundColor);if(color.length===3||color[3]===1){bg=color;break;}node=node.parentElement;}
  if(!bg)bg=[255,255,255];const a=luminance(fg),b=luminance(bg);return {selector,ratio:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};});
 },selectors);}
(async()=>{
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1440,height:1000},colorScheme:'dark',acceptDownloads:true,args:['--lang=es-ES','--disable-extensions-except='+path.join(root,'extension'),'--load-extension='+path.join(root,'extension')]});await context.addInitScript(()=>{try{localStorage.setItem('lossy.uiLanguage','es');}catch(_){}});context.setDefaultTimeout(20000);
 const errors=[],results={source:'isolated Chromium with synthetic conversations',contrast:[],layouts:[]};let activeTitle=fixture.raw.title;context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.route('https://chatgpt.com/**',route=>{const url=new URL(route.request().url()),p=url.pathname;if(p==='/api/auth/session')return route.fulfill({json:{accessToken:'fixture-token'}});if(p==='/backend-api/conversation/fixture-chat')return route.fulfill({json:{...fixture.raw,title:activeTitle}});if(p.startsWith('/backend-api/files/download/')){const id=p.split('/').pop();return route.fulfill({json:{download_url:'https://files.oaiusercontent.com/'+id,file_name:fixture.images[id].name}});}if(p.startsWith('/backend-api/'))return route.fulfill({status:404});return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Identidad visual — ChatGPT</title><main><article><div data-message-author-role="assistant" data-message-id="assistant-msg"><div class="markdown"><p>Estas son las variantes del diseño.</p></div></div></article></main>'});});
 await context.route('https://files.oaiusercontent.com/**',route=>{const image=fixture.images[new URL(route.request().url()).pathname.slice(1)];return route.fulfill({body:Buffer.from(image.base64,'base64'),contentType:image.mime,headers:{'access-control-allow-origin':'*'}});});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const chat=await context.newPage();await chat.goto('https://chatgpt.com/c/fixture-chat');
  const opened=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('src/popup/popup.html'),active:false}));const popup=await opened;await popup.setViewportSize({width:400,height:780});await popup.locator('#conversation-info').waitFor({state:'visible'});await popup.locator('#btn-capture-update').click();await popup.locator('#asset-readiness').filter({hasText:'5 de 5 imágenes guardadas'}).waitFor({timeout:60000});
  for(const scheme of ['dark','light']){
   await popup.emulateMedia({colorScheme:scheme});await popup.evaluate(()=>{const body=document.querySelector('.chrome-body');if(body)body.scrollTop=0;});
   await screenshot(popup,'popup-'+scheme);const values=await contrasts(popup,['.brand-subtitle','.status-sub','.quick-format-note','.action-subtitle','#btn-capture-label']);results.contrast.push({view:'popup-'+scheme,values});
   if(!baseline){await popup.locator('#btn-claude-packet').scrollIntoViewIfNeeded();const action=await popup.locator('#btn-claude-packet').boundingBox(),footer=await popup.locator('.chrome-footer').boundingBox();assert.ok(action.y+action.height<=footer.y+1,'primary popup actions must remain reachable above footer at 400 × 780');}
   if(!baseline)for(const item of values)assert.ok(item.ratio>=4.5,scheme+' '+JSON.stringify(item));
  }
  await popup.emulateMedia({colorScheme:'dark'});await popup.getByRole('button',{name:'Exportar MD',exact:true}).click();await popup.locator('#md-export-dialog').waitFor({state:'visible'});await popup.screenshot({path:path.join(out,'markdown-dialog.png')});await popup.locator('#btn-cancel-md-export').click();
  await popup.locator('#btn-popup-export').click();await popup.locator('#popup-format-panel').scrollIntoViewIfNeeded();await screenshot(popup,'format-panel');await popup.locator('#btn-close-format-panel').click();
  await popup.setViewportSize({width:360,height:600});await popup.evaluate(()=>{const body=document.querySelector('.chrome-body');if(body)body.scrollTop=0;});await screenshot(popup,'popup-compact');results.layouts.push({view:'popup-compact',...await noPageOverflow(popup)});
  if(!baseline){const size=await popup.locator('.quick-format-card').first().boundingBox();assert.ok(size.width>=100&&size.height>=80);assert.equal((await noPageOverflow(popup)).document,360);}
  activeTitle='Identidad visual de Lossy: referencias, variantes y decisiones para continuar el diseño del producto';
  await popup.locator('#btn-capture-update').click();await popup.locator('#conv-title').filter({hasText:activeTitle}).waitFor();await popup.locator('#status-title').filter({hasText:'Conversación capturada'}).waitFor();await popup.evaluate(()=>{document.querySelector('.chrome-body').scrollTop=0;});await screenshot(popup,'popup-long-title');
  if(!baseline){const title=await popup.locator('#conv-title').boundingBox();assert.ok(title.height<=44);assert.equal((await noPageOverflow(popup)).document,360);}
  const workspace=await context.newPage();await workspace.goto('chrome-extension://'+id+'/src/workspace/workspace.html');await workspace.locator('#nav-library').waitFor();
  await workspace.evaluate(async()=>{
   const db=new LinerDB();const names=['Identidad visual · referencias y decisiones','Plan de lanzamiento de Lossy','Sistema de diseño para la extensión','Investigación de usuarios y entrevistas','Documentación técnica del proyecto','Ideas para la próxima iteración','Propuesta de colaboración y próximos pasos','Una conversación con un título extenso para comprobar que el contenido continúa siendo legible en ventanas pequeñas'];
   for(let i=0;i<names.length;i++)await db.saveConversation({canonicalId:'conv_demo_'+i,title:names[i],source:{platform:i===6?'claude':'chatgpt',conversationId:'demo_'+i},model:i%3===0?'':i===6?'Claude':'GPT',createdAt:'2026-10-20T14:00:00Z',updatedAt:'2026-10-28T14:00:00Z',messages:[{id:'u'+i,role:'user',content:{text:'Revisa las referencias y conserva las decisiones del proyecto.'}},{id:'a'+i,role:'assistant',content:{text:'Decisiones guardadas. Podemos continuar desde este punto.'}}],integrity:{status:i===3?'partial':i===5?'uncaptured':'captured'}});
   for(let i=0;i<2;i++)await db.saveClip({canonicalId:'clip_demo_'+i,id:'clip_demo_'+i,entityType:'clip',title:i?'Notas para continuar':'Decisiones de tipografía',sourceConversationId:'demo_0',sourceConversationCanonicalId:'conv_demo_0',sourceConversationTitle:names[0],sourcePlatform:'chatgpt',selectedMessages:[{id:'clip_m'+i,role:'assistant',content:{text:'Conservar la jerarquía y un acento de color discreto.'}}],integrity:{status:'captured'},createdAt:'2026-10-28T14:00:00Z'});
   for(const [name,description,ids]of [['Diseño de producto','Referencias y decisiones de interfaz',['conv_demo_0','conv_demo_2']],['Lossy','Construcción y documentación',['conv_demo_1','conv_demo_4']],['Investigación','Hallazgos y próximos pasos',['conv_demo_3','conv_demo_5']]]){const col=await db.createCollection(name,description);await db.addConversationsToCollection(col.collectionId,ids);}
  });
  await workspace.locator('#nav-library').click();await workspace.waitForFunction(()=>document.querySelectorAll('#library-table-body tr[data-id]').length===11);
  for(const scheme of ['dark','light']){
   await workspace.evaluate(scheme=>document.body.className='theme-'+scheme,scheme);await screenshot(workspace,'workspace-'+scheme);
   const values=await contrasts(workspace,['.library-heading p','.overview-item > span','.overview-item small','.filter-label','.data-table .col-date','.clip-label','#btn-header-new-transfer']);results.contrast.push({view:'workspace-'+scheme,values});if(!baseline)for(const value of values)assert.ok(value.ratio>=4.5,scheme+' '+JSON.stringify(value));
  }
  await workspace.locator('#nav-settings').click();await workspace.locator('[data-theme="theme-dark"]').click();await screenshot(workspace,'settings-dark');
  await workspace.locator('#nav-collections').click();await workspace.getByText('Diseño de producto',{exact:true}).first().waitFor();await screenshot(workspace,'collections-dark');
  await workspace.locator('#nav-library').click();await workspace.locator('.row-select').first().check();await workspace.locator('#btn-header-new-transfer').click();await workspace.locator('#view-transfers.active').waitFor();await workspace.locator('#transfer-goal').fill('Continuar la identidad visual conservando las referencias y las decisiones.');await screenshot(workspace,'transfer-dark');
  await workspace.locator('#nav-library').click();await workspace.locator('tr[data-id="conv_demo_0"] .btn-inspect-title').click();await workspace.locator('#full-reader-overlay').waitFor({state:'visible'});await screenshot(workspace,'reader-dark');await workspace.locator('#btn-full-reader-close').click();
  for(const width of [900,640,390]){
   await workspace.setViewportSize({width,height:900});await screenshot(workspace,'workspace-'+width);const layout=await noPageOverflow(workspace);results.layouts.push({view:'workspace-'+width,...layout});if(!baseline)assert.equal(layout.document,width,'page overflow at '+width);
  }
  if(!baseline){for(const label of ['Biblioteca','Proyectos','Transferencias','Diagnósticos','Configuración'])assert.equal(await workspace.getByRole('button',{name:label,exact:true}).count(),1);}
  await workspace.locator('#nav-collections').click();await workspace.locator('#btn-new-collection').click();await workspace.locator('#app-modal-backdrop').waitFor({state:'visible'});await screenshot(workspace,'modal-compact');await workspace.locator('#app-modal-cancel').click();
  await workspace.emulateMedia({reducedMotion:'reduce'});assert.equal(await workspace.locator('.btn-primary').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  const blank=await context.newPage();await blank.goto('about:blank');const idleOpened=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('src/popup/popup.html'),active:false}));const idle=await idleOpened;await idle.setViewportSize({width:400,height:780});await idle.waitForFunction(()=>!document.querySelector('#status-title').textContent.includes('Detectando'));assert.equal(await idle.locator('#btn-popup-export').isDisabled(),true);assert.equal(await idle.locator('#btn-open-workspace').isEnabled(),true);await screenshot(idle,'popup-empty');results.longTitle=true;results.idleActions=true;
  assert.deepEqual(errors,[]);results.uncaughtErrors=errors;fs.writeFileSync(path.join(out,'visual-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
