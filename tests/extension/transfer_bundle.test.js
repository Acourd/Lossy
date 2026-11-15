'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {raw,images}=require('./fixtures/chatgpt_assets.json');
const {parseChatGPTConversationTree}=require('../../extension/src/platforms/chatgpt/structured/chatgpt_structured_acquisition');
const {mergeAttachments,fileId}=require('../../extension/src/platforms/chatgpt/chatgpt_assets');
const {GenericTargetAdapter}=require('../../extension/src/targets/generic_target_adapter');
const {ClaudeTargetAdapter}=require('../../extension/src/targets/claude_target_adapter');
const {MarkdownBundleAdapter}=require('../../extension/src/targets/markdown_bundle_adapter');
const {createZip,parseZip}=require('../../extension/src/core/portability/zip_builder');
function fixture(){const conv=parseChatGPTConversationTree(raw);for(const msg of conv.messages){msg.attachments=mergeAttachments(msg.attachments);for(const asset of msg.attachments){const image=images[fileId(asset)];asset.dataURI='data:'+image.mime+';base64,'+image.base64;asset.mimeType=image.mime;}msg.content.attachments=msg.attachments;}conv.attachments=conv.messages.flatMap(m=>m.attachments);return conv;}
for(const Adapter of [GenericTargetAdapter,ClaudeTargetAdapter,MarkdownBundleAdapter])test(Adapter.name+': downloadable package includes five images, linked text, context objective and exact file hashes',()=>{
 const conv=fixture();const original=JSON.stringify(conv);const pkg=new Adapter().generatePackage([conv],{projectTitle:'Diseño de avatares',summaryGoal:'Continuar el diseño con las referencias originales.'});
 const files=parseZip(createZip(pkg.files));assert.equal(Object.keys(files).filter(p=>/^assets\/(?!manifest)/.test(p)).length,5);
 const brief=Buffer.from(files['CONTEXT_BRIEF.md']).toString();assert.match(brief,/Continuar el diseño/);assert.doesNotMatch(brief,/app:\/\//);
 const md=Object.keys(files).find(p=>/^(conversations|CONVERSATIONS)\/.*\.md$/.test(p));
 for(const match of Buffer.from(files[md]).toString().matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(md),decodeURIComponent(match[1])));assert.ok(files[target],target);}
 for(const [name,expected]of Object.entries(pkg.receipt.fileHashes))assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'),expected,name);
 assert.equal(pkg.receipt.totalFiles,Object.keys(files).length-1);assert.equal(JSON.stringify(conv),original);
});
test('browser SHA-256 matches standard Unicode and binary digests',()=>{
 const context={TextEncoder,Uint8Array,ArrayBuffer};context.globalThis=context;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/src/core/crypto_util.js'),'utf8'),context);
 for(const value of ['Diseño, imágenes, evolución 😀',new Uint8Array([0,255,128,42,13,10]),''])assert.equal(context.Lossy.Crypto.sha256(value),crypto.createHash('sha256').update(value).digest('hex'));
});
test('missing images are reported without claiming the context is complete',()=>{
 const conv=fixture();delete conv.messages[0].attachments[0].dataURI;const pkg=new GenericTargetAdapter().generatePackage([conv]);
 assert.equal(pkg.assetSummary.unavailable,1);assert.match(pkg.files['CONTEXT_BRIEF.md'],/recursos pendientes/);
});
