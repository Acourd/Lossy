'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {ExportCenter,AssetResolver}=require('../../extension/src/core/portability/export_center');
const {createZip,parseZip,crc32}=require('../../extension/src/core/portability/zip_builder');
const pdf=require('../../extension/src/core/portability/pdf_builder');
function chunk(name,data){const n=Buffer.from(name);const result=Buffer.alloc(12+data.length);result.writeUInt32BE(data.length);n.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([n,data])),8+data.length);return result;}
function png(){const hdr=Buffer.alloc(13);hdr.writeUInt32BE(2);hdr.writeUInt32BE(1,4);hdr[8]=8;hdr[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255,0,0,255,128]))),chunk('IEND',Buffer.alloc(0))]);}
function entity(){return {title:'Análisis con imágenes',canonicalId:'conv_a',messages:[{id:'m1',role:'assistant',content:{text:'Resultado útil pluginconnector-test',codeBlocks:[]},attachments:[{id:'a1',kind:'image',filename:'resultado.png',mimeType:'image/png',dataURI:'data:image/png;base64,'+png().toString('base64')}]}]};}
test('PDF decodes real RGBA pixels and composites transparency against paper white',()=>{
 const e=entity();const b=Buffer.from(pdf.buildPdf(e));
 assert.ok(b.includes(Buffer.from([255,0,0,127,127,255])));
 assert.match(b.toString('latin1'),/\/Width 2 \/Height 1/);
 assert.doesNotMatch(b.toString('utf8'),/connector-test||/);
});
test('Markdown embeds a local image once, removes connector control tokens and preserves code examples',async()=>{
 const e=entity();e.messages[0].content.text+='\n![Resultado]('+e.messages[0].attachments[0].dataURI+')\n```text\nliteral\n```';
 const r=await new ExportCenter().exportSingle(e,'md');
 assert.equal((r.data.match(/!\[/g)||[]).length,1);
 assert.match(r.data,/data:image\/png;base64/);assert.doesNotMatch(r.data,/connector-test/);assert.match(r.data,/literal/);
 assert.match(e.messages[0].content.text,/connector-test/);
});
test('Markdown ZIP uses safe unique assets, no double extension, every image link resolves',async()=>{
 const e=entity();e.messages[0].attachments.push({...e.messages[0].attachments[0],id:'a2',filename:'../../resultado.png'});
 const r=await new ExportCenter().exportSingle(e,'md',null,{imageStrategy:'package'});const files=parseZip(r.data);
 assert.equal(r.filename,'analisis_con_imagenes.zip');assert.ok(files['analisis_con_imagenes.md']);
 const md=Buffer.from(files['analisis_con_imagenes.md']).toString();const links=[...md.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g)];assert.equal(links.length,2);
 for(const link of links)assert.ok(files[decodeURIComponent(link[1])]);
 assert.equal(Object.keys(files).filter(k=>k.startsWith('assets/')).length,2);
 assert.ok(Object.keys(files).every(k=>!k.includes('..')));
});
test('omit and JSON avoid all resource downloads; omit suppresses images',async()=>{
 const e=entity();let calls=0;const fetch=async()=>{calls++;throw Error('Unexpected fetch');};
 const r=await new ExportCenter().exportSingle(e,'md',null,{imageStrategy:'omit',fetch});assert.doesNotMatch(r.data,/!\[|data:image/);
 const j=await new ExportCenter().exportSingle(e,'json',null,{fetch});assert.deepEqual(JSON.parse(j.data),e);assert.equal(calls,0);
});
test('Blob resources retain their actual bytes',async()=>{
 const e=entity();delete e.messages[0].attachments[0].dataURI;e.messages[0].attachments[0].blob=new Blob([png()],{type:'image/png'});
 const r=await AssetResolver.resolveAssetBinaries(e);assert.deepEqual(Buffer.from(r.assetMap.get('a1')),png());
});
test('bulk export never overwrites conversations with identical titles',async()=>{
 const r=await new ExportCenter().exportBulk([entity(),{...entity(),canonicalId:'conv_b'}],'md');const files=parseZip(r.data);
 assert.equal(Object.keys(files).filter(k=>k.endsWith('.md')).length,2);
 const manifest=JSON.parse(Buffer.from(files['manifest.json']).toString());assert.notEqual(manifest.entities[0].path,manifest.entities[1].path);
});
test('image-only conversational messages survive technical filtering',async()=>{
 const e=entity();e.messages[0].content.text='';e.messages.push({id:'tool',role:'tool',content:{text:'SECRET_TOOL_EVENT'}});
 const r=await new ExportCenter().exportSingle(e,'md');assert.match(r.data,/!\[/);assert.doesNotMatch(r.data,/SECRET_TOOL_EVENT/);
});
test('PDF preserves indentation and breaks long code and URLs within the page width',()=>{
 assert.equal(pdf.wrapText('    const x = 1;',400,10,true)[0],'    const x = 1;');
 assert.ok(pdf.wrapText('x'.repeat(1000),80,10).every(l=>l.length<=15));
});
test('PNG export without a real renderer rejects instead of emitting a corrupt placeholder',async()=>{
 await assert.rejects(new ExportCenter().exportSingle(entity(),'png'),/Canvas/);
});
module.exports={png};

test('PDF retains fenced code even when canonical codeBlocks were not populated',async()=>{
 const e=entity();e.messages[0].content.text='Explicación\n```js\n    const uniqueCodeMarker = 42;\n```';
 const r=await new ExportCenter().exportSingle(e,'pdf');const text=Buffer.from(r.data).toString('latin1');
 assert.equal((text.match(/uniqueCodeMarker/g)||[]).length,1);
});
