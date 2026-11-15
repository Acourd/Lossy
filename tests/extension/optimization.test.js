'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {AssetResolver}=require('../../extension/src/core/portability/export_center');
const zip=require('../../extension/src/core/portability/zip_builder');

function entity(count, urls=i=>'https://example.com/'+i+'.png') {
 return {canonicalId:'conv_test',messages:Array.from({length:count},(_,i)=>({id:'message_'+i,role:'user',content:{text:'Referencia '+i},attachments:[{id:'file_'+i,filename:i+'.png',mimeType:'image/png',sourceURL:urls(i)}]}))};
}
function response(bytes=[1,2,3],mime='image/png') {
 return {ok:true,headers:{get:()=>mime},arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
}

test('export downloads each repeated URL once while preserving every asset and its bytes',async()=>{
 const input=entity(8,i=>'https://example.com/'+(i%2)+'.png'),snapshot=structuredClone(input);let calls=0;
 const result=await AssetResolver.resolveAssetBinaries(input,{fetch:async address=>{calls++;return response(address.includes('/0.')?[11]:[22]);}});
 assert.equal(calls,2);assert.equal(result.assets.length,8);
 for(let i=0;i<8;i++)assert.deepEqual(Array.from(result.assetBinaryMap.get('file_'+i)),[i%2?22:11]);
 assert.deepEqual(input,snapshot);
});

test('resource workers overlap requests, respect the concurrency option and never exceed four',async()=>{
 for(const [limit,expected] of [[undefined,4],[2,2],[100,4],[0,1]]){
  let release;const gate=new Promise(resolve=>{release=resolve;});let active=0,peak=0;
  const pending=AssetResolver.resolveAssetBinaries(entity(10),{assetConcurrency:limit,fetch:async()=>{active++;peak=Math.max(peak,active);await gate;active--;return response();}});
  await new Promise(setImmediate);const initialPeak=peak;release();const result=await pending;
  assert.equal(initialPeak,expected);assert.ok(peak<=expected);assert.equal(result.assets.length,10);
  assert.deepEqual(result.assets.map(a=>a.assetId),Array.from({length:10},(_,i)=>'file_'+i));
 }
});

test('failed shared downloads are attempted once per export and can recover in the next export',async()=>{
 const input=entity(5,()=> 'https://example.com/shared.png');let calls=0,healthy=false;
 const fetch=async()=>{calls++;if(!healthy)return {ok:false,status:429};return response([7]);};
 const failed=await AssetResolver.resolveAssetBinaries(input,{fetch});
 assert.equal(calls,1);assert.equal(failed.assetBinaryMap.size,0);assert.ok(failed.assets.every(a=>a.availability==='referenced'&&a.warnings.some(w=>w.includes('429'))));
 healthy=true;const recovered=await AssetResolver.resolveAssetBinaries(input,{fetch});assert.equal(calls,2);assert.ok(recovered.assets.every(a=>a.availability==='downloaded'));assert.deepEqual(Array.from(recovered.assetBinaryMap.get('file_0')),[7]);
});

test('a shared non-image response never becomes an image even when a document requested it first',async()=>{
 const input=entity(2,()=> 'https://example.com/shared');input.messages[0].attachments[0].mimeType='application/octet-stream';let calls=0;
 const result=await AssetResolver.resolveAssetBinaries(input,{fetch:async()=>{calls++;return response([60,104,116,109,108,62],'text/html');}});
 assert.equal(calls,1);assert.equal(result.assets[0].availability,'downloaded');assert.equal(result.assets[1].availability,'referenced');assert.equal(result.assetBinaryMap.has('file_1'),false);
});

test('an image-only download rejects a non-image header before allocating its response body',async()=>{
 let bodyReads=0;
 const result=await AssetResolver.resolveAssetBinaries(entity(3,()=> 'https://example.com/expired'),{fetch:async()=>({ok:true,headers:{get:()=> 'text/html'},arrayBuffer:async()=>{bodyReads++;return new Uint8Array(1024).buffer;}})});
 assert.equal(bodyReads,0);assert.ok(result.assets.every(a=>a.availability==='referenced'));assert.equal(result.assetBinaryMap.size,0);
});

test('repeated data URIs share one decoded buffer inside an export and do not leak cached data to another',async()=>{
 const input=entity(12);for(const msg of input.messages){delete msg.attachments[0].sourceURL;msg.attachments[0].dataURI='data:image/png;base64,AQID';}
 const first=await AssetResolver.resolveAssetBinaries(input);const bytes=first.assetBinaryMap.get('file_0');assert.deepEqual(Array.from(bytes),[1,2,3]);
 assert.equal(new Set(first.assets.map(a=>a.data)).size,1);
 const next=await AssetResolver.resolveAssetBinaries(input);assert.notEqual(next.assetBinaryMap.get('file_0'),bytes);
});

test('indexed asset discovery retains pointer aliases, inline resources and message associations',()=>{
 const pointer='sediment://file_a',url='https://example.com/a.png';
 const input={messages:[{id:'m1',role:'user',content:{text:'![original]('+url+')',parts:[{content_type:'image_asset_pointer',asset_pointer:pointer}]},attachments:[{id:'pointer-a',fileId:'file_a',assetPointer:pointer,sourceURL:url,filename:'a.png',mimeType:'image/png'},{id:'file_a',dataURI:'data:image/png;base64,AQID',mimeType:'image/png'}]},{id:'m2',role:'assistant',content:{text:'![otra]('+url+')'}}]};
 const assets=AssetResolver.resolveAssetsForEntity(input);
 assert.equal(assets.length,2);assert.equal(assets[0].assetId,'pointer-a');assert.equal(assets[0].dataURI,'data:image/png;base64,AQID');assert.equal(assets[0].sourceMessageId,'m1');assert.equal(assets[1].sourceMessageId,'m2');
});

function centralEntries(bytes) {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),central=view.getUint32(bytes.length-6,true);let offset=central;const entries=[];
 while(offset<bytes.length-22){const size=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);entries.push({offset,size});offset+=size;}
 return {view,central,entries};
}

test('ZIP validation accepts central entries in a different order from their local file headers',()=>{
 const bytes=zip.createZip({'a.txt':'A','b.txt':'B','c.txt':'C'}),{central,entries}=centralEntries(bytes),reversed=Buffer.concat(entries.toReversed().map(e=>bytes.slice(e.offset,e.offset+e.size)));
 bytes.set(reversed,central);const files=zip.parseZip(bytes);assert.deepEqual(Object.keys(files),['c.txt','b.txt','a.txt']);for(const [name,data]of Object.entries(files))assert.equal(data.toString(),name[0].toUpperCase());
});

test('ZIP validation still rejects a valid local header nested inside another file payload',()=>{
 const nested=zip.createZip({'inner.txt':'NEST'}),inner=centralEntries(nested),payload=nested.slice(0,inner.central);
 const bytes=zip.createZip({'outer.bin':payload,'inner.txt':'NEST'}),{view,entries}=centralEntries(bytes),start=30+view.getUint16(26,true);
 view.setUint32(entries[1].offset+42,start,true);
 assert.throws(()=>zip.parseZip(bytes),/superpuest/i);
});
