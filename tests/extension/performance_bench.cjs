'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const root=path.resolve(process.argv[2]||process.env.LOSSY_QA_ROOT||path.join(__dirname,'../..')),label=process.argv[3]||'current',out=path.resolve(process.env.LOSSY_QA_OUTPUTS||'scratch/optimization-bench');fs.mkdirSync(out,{recursive:true});
const {AssetResolver}=require(path.join(root,'extension/src/core/portability/export_center'));
const zip=require(path.join(root,'extension/src/core/portability/zip_builder'));
function fixture(n,remote=false,repeated=false){return {canonicalId:'conv_bench',title:'Bench',messages:Array.from({length:n},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:{text:'Imagen de referencia'},attachments:[{id:'file_'+i,fileId:'file_'+i,filename:'image_'+i+'.png',kind:'image',mimeType:'image/png',...(remote?{sourceURL:'https://example.com/image-'+(repeated?i%2:i)+'.png'}:{dataURI:'data:image/png;base64,AA=='})}]}))};}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
function measure(run,verify){run();const times=[];for(let i=0;i<5;i++){const t=performance.now(),result=run();times.push(performance.now()-t);verify(result);}return Number(median(times).toFixed(2));}
(async()=>{
 const results={label,source:root,runs:5,assetIndex:[],zipRead:[]};
 for(const count of [2000,10000]){const entity=fixture(count);results.assetIndex.push({count,medianMs:measure(()=>AssetResolver.resolveAssetsForEntity(entity),assets=>assert.equal(assets.length,count))});}
 for(const count of [2000,10000]){const data=zip.createZip(Object.fromEntries(Array.from({length:count},(_,i)=>['files/'+i+'.txt','x'])));results.zipRead.push({count,bytes:data.length,medianMs:measure(()=>zip.parseZip(data),files=>assert.equal(Object.keys(files).length,count))});}
 for(const repeated of [false,true]){let calls=0,active=0,peak=0;const entity=fixture(8,true,repeated),start=performance.now();const resolved=await AssetResolver.resolveAssetBinaries(entity,{fetch:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,30));active--;return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};}});assert.equal(resolved.assets.length,8);results[repeated?'repeatedRemote':'uniqueRemote']={count:8,simulatedLatencyMs:30,calls,peakConcurrency:peak,elapsedMs:Number((performance.now()-start).toFixed(2))};}
 fs.writeFileSync(path.join(out,label+'-core.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
