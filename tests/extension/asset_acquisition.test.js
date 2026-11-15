'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {raw,images}=require('./fixtures/chatgpt_assets.json');
const {parseChatGPTConversationTree}=require('../../extension/src/platforms/chatgpt/structured/chatgpt_structured_acquisition');
const assets=require('../../extension/src/platforms/chatgpt/chatgpt_assets');
const {ExportCenter}=require('../../extension/src/core/portability/export_center');
const {parseZip}=require('../../extension/src/core/portability/zip_builder');
const token='test-ephemeral-token';
function sessionFetch(log=[]){return async(address,options={})=>{const url=new URL(address);log.push({url,options});if(url.origin==='https://chatgpt.com')assert.equal(options.headers.Authorization,'Bearer '+token);else assert.equal(options.headers.Authorization,undefined);const id=url.pathname.split('/').pop();if(url.pathname.startsWith('/backend-api/files/download/'))return new Response(JSON.stringify({download_url:'https://files.oaiusercontent.com/'+id,file_name:images[id].name}),{headers:{'content-type':'application/json'}});const image=images[id];return image?new Response(Buffer.from(image.base64,'base64'),{headers:{'content-type':image.mime}}):new Response('',{status:404});};}
async function acquired(){return assets.resolveConversationAssets(parseChatGPTConversationTree(raw),{getToken:()=>token,fetch:sessionFetch()});}
test('raw structured capture resolves five offscreen images and merges duplicate pointer/attachment metadata',async()=>{
 const log=[];let tokens=0;const parsed=parseChatGPTConversationTree(raw);const result=await assets.resolveConversationAssets(parsed,{fetch:sessionFetch(log),getToken:()=>{tokens++;return token;}});
 assert.deepEqual(result.assetSummary,{total:5,ready:5,missing:0});assert.equal(result.messages[0].attachments.length,3);assert.equal(result.messages[1].attachments.length,2);
 assert.equal(tokens,1);assert.equal(log.length,10);assert.ok(result.messages.every(m=>m.attachments.every(a=>a.dataURI?.startsWith('data:image/'))));assert.equal(parsed.messages[0].attachments[0].dataURI,null);
 assert.equal(result.messages[0].attachments[0].filename,'10.jpg');assert.equal(result.messages[0].attachments[1].filename,'Iso (1).jpg');
 assert.doesNotMatch(JSON.stringify(result),new RegExp(token));
});
test('authenticated backend images retain bearer while signed CDN images never receive it',async()=>{
 const parsed=parseChatGPTConversationTree(raw);const log=[];
 const fetch=async(address,options)=>{log.push({address,options});if(address.includes('/files/download/'))return new Response(JSON.stringify({download_url:'https://chatgpt.com/backend-api/estuary/content?id=file_fixture_0'}),{headers:{'content-type':'application/json'}});assert.equal(options.headers.Authorization,'Bearer '+token);return new Response(Buffer.from(images.file_fixture_0.base64,'base64'));};
 const result=await assets.resolveConversationAssets(parsed,{fetch,getToken:()=>token});assert.equal(result.assetSummary.missing,0);assert.ok(log.some(r=>r.address.includes('/estuary/')));
});
test('resolver tries alternate download routes after a route is unavailable',async()=>{
 const parsed=parseChatGPTConversationTree(raw);let alternate=0;
 const fetch=async(address)=>{if(address.includes('/files/download/'))return new Response('',{status:404});if(address.includes('/backend-api/files/')){alternate++;return new Response(JSON.stringify({download_url:'https://files.oaiusercontent.com/file_fixture_0'}),{headers:{'content-type':'application/json'}});}return new Response(Buffer.from(images.file_fixture_0.base64,'base64'));};
 const result=await assets.resolveConversationAssets(parsed,{fetch,getToken:()=>token});assert.equal(result.assetSummary.ready,5);assert.equal(alternate,5);
});
test('malicious signed hosts and HTML responses never become embedded images or receive credentials',async()=>{
 let unexpected=0;const result=await assets.resolveConversationAssets(parseChatGPTConversationTree(raw),{getToken:()=>token,fetch:async address=>{if(!address.startsWith('https://chatgpt.com'))unexpected++;return new Response(JSON.stringify({download_url:'https://attacker.example/collect'}),{headers:{'content-type':'application/json'}});}});
 assert.equal(unexpected,0);assert.deepEqual(result.assetSummary,{total:5,ready:0,missing:5});
 const invalid=await assets.resolveConversationAssets(parseChatGPTConversationTree(raw),{getToken:()=>token,fetch:async()=>new Response('<html>access denied</html>',{headers:{'content-type':'text/html'}})});assert.equal(invalid.assetSummary.ready,0);
});
test('rate limiting produces pending assets without retry loops or leaking raw request data',async()=>{
 let count=0;const result=await assets.resolveConversationAssets(parseChatGPTConversationTree(raw),{getToken:()=>token,fetch:async()=>{count++;return new Response('',{status:429});}});assert.equal(count,5);assert.equal(result.assetSummary.missing,5);assert.doesNotMatch(JSON.stringify(result),new RegExp(token));
});
test('capture cancellation stops pending image requests and yields no fabricated bytes',async()=>{
 const controller=new AbortController();const pending=assets.resolveConversationAssets(parseChatGPTConversationTree(raw),{getToken:()=>token,signal:controller.signal,fetch:async(_address,{signal})=>new Promise((_resolve,reject)=>{if(signal.aborted)reject(new Error('aborted'));else signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
 setTimeout(()=>controller.abort(),15);const result=await pending;assert.equal(result.assetSummary.ready,0);assert.equal(result.assetSummary.missing,5);
});
test('real acquired images reach Markdown ZIP, PDF and DOCX, and app mentions render as ordinary names',async()=>{
 const conv=await acquired();const center=new ExportCenter();
 const md=await center.exportSingle(conv,'md',null,{imageStrategy:'package'});const files=parseZip(md.data);const document=Object.keys(files).find(f=>f.endsWith('.md'));const text=Buffer.from(files[document]).toString();assert.equal(Object.keys(files).filter(f=>f.startsWith('assets/')).length,5);assert.doesNotMatch(text,/app:\/\/|plugins_6ada/);assert.match(text,/ayzok-rc3/);
 for(const match of text.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g))assert.ok(files[decodeURIComponent(match[1])]);
 const pdf=await center.exportSingle(conv,'pdf');const pdfText=Buffer.from(pdf.data).toString('latin1');assert.equal((pdfText.match(/\/Subtype \/Image/g)||[]).length,5);assert.doesNotMatch(pdfText,/Recurso visual no disponible|app:\/\/|image_asset_pointer/);
 const docx=await center.exportSingle(conv,'docx');const word=parseZip(docx.data);assert.equal(Object.keys(word).filter(k=>k.startsWith('word/media/')).length,5);assert.doesNotMatch(Buffer.from(word['word/document.xml']).toString(),/app:\/\//);
 const json=await center.exportSingle(conv,'json');assert.match(json.data,/app:\/\/plugins_/);
});
test('ZIP delivery remains explicit when every image is unavailable and records missing items',async()=>{
 const conv=parseChatGPTConversationTree(raw);const result=await new ExportCenter().exportSingle(conv,'md',null,{imageStrategy:'package'});assert.equal(result.mimeType,'application/zip');const files=parseZip(result.data);const manifest=JSON.parse(Buffer.from(files['manifest.json']).toString());assert.ok(manifest.assets.unavailable>0);assert.ok(Object.keys(files).some(k=>k.endsWith('.md')));
});
test('omitting resources suppresses DOCX image parts without mutating canonical assets',async()=>{
 const conv=await acquired();const r=await new ExportCenter().exportSingle(conv,'docx',null,{imageStrategy:'omit'});assert.equal(Object.keys(parseZip(r.data)).filter(k=>k.startsWith('word/media/')).length,0);assert.equal(assets.summary(conv).ready,5);
});
test('canonical clips preserve selected message images through storage and PDF export',async()=>{
 const conv=await acquired();const {createCanonicalClip}=require('../../extension/src/core/canonical_model');
 const clip=createCanonicalClip({sourceConversation:conv,selectedTurnIndices:[0]});assert.equal(clip.selectedMessages[0].attachments.length,3);
 const {LinerDB}=require('../../extension/src/core/storage/liner_db');const db=new LinerDB();await db.saveClip(clip);const saved=await db.getClip(clip.canonicalId);
 const r=await new ExportCenter().exportSingle(saved,'pdf');assert.equal((Buffer.from(r.data).toString('latin1').match(/\/Subtype \/Image/g)||[]).length,3);
});
test('DOCX renders a fenced code block once instead of duplicating it into normal paragraphs',async()=>{
 const conv=await acquired();conv.messages[0].content.text='Texto\n```js\n    const preservedCodeMarker = 1;\n```';conv.messages[0].content.codeBlocks=[{language:'js',code:'    const preservedCodeMarker = 1;'}];
 const r=await new ExportCenter().exportSingle(conv,'docx');const xml=Buffer.from(parseZip(r.data)['word/document.xml']).toString();assert.equal((xml.match(/preservedCodeMarker/g)||[]).length,1);
});
