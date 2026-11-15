(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./zip_builder'),require('../crypto_util'),require('../../platforms/chatgpt/acquisition_manager'),require('../../platforms/chatgpt/chatgpt_assets'));
 else{root.Lossy=root.Lossy||{};root.Lossy.ChatGPTArchive=factory(root.Lossy.ZipBuilder,root.Lossy.Crypto,root.Liner,root.Lossy.ChatGPTAssets);}
})(typeof globalThis!=='undefined'?globalThis:this,function(zip,crypto,acquisition,resources){
 'use strict';
 const MiB=1024*1024,historyName=name=>/(?:^|\/)conversations(?:[-_]\d+)?\.json$/i.test(name),basename=name=>name.split('/').pop();
 function pathName(name){const path=String(name).replace(/\\/g,'/');if(path.startsWith('/')||/^[a-z]:/i.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f]/.test(path))throw Error('Nombre de archivo no válido');return path;}
 function dateFor(raw){for(const value of [raw.create_time,raw.created_at]){if(value==null)continue;const time=typeof value==='number'?value*1000:Date.parse(value);if(Number.isFinite(time)&&time>0)return new Date(time).toISOString();}return null;}
 function groupFor(raw){const project=raw.project_id||raw.project?.id||raw.metadata?.project_id,name=raw.project_name||raw.project?.name||raw.metadata?.project_name;if(typeof project==='string'||typeof name==='string')return{kind:'project',id:String(project||name),name:typeof name==='string'?name:'Proyecto '+project};const gpt=raw.gizmo_id||raw.gpt_id||raw.gizmo?.id;if(typeof gpt==='string'){const named=raw.gizmo?.name||raw.gpt_name;return{kind:named||raw.gpt_id?'gpt':'reference',id:gpt,name:named||(raw.gpt_id?'GPT ':'Identificador ')+gpt};};return null;}
 function mime(bytes,declared,name){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return'image/png';if(bytes[0]===255&&bytes[1]===216)return'image/jpeg';if(String.fromCharCode(...bytes.subarray(0,3))==='GIF')return'image/gif';if(String.fromCharCode(...bytes.subarray(8,12))==='WEBP')return'image/webp';if(String.fromCharCode(...bytes.subarray(0,4))==='%PDF')return'application/pdf';return declared?.startsWith('image/')?'application/octet-stream':declared||(/\.txt$/i.test(name)?'text/plain':'application/octet-stream');}
 function base64(bytes){if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let result='';for(let i=0;i<bytes.length;i+=24576)result+=btoa(String.fromCharCode(...bytes.subarray(i,i+24576)));return result;}
 async function inputSource(input){
  const provided=(input.files||[]).map(value=>value.file?{name:value.name,webkitRelativePath:value.path,size:value.file.size,arrayBuffer:()=>value.file.arrayBuffer()}:value);input={...input,files:provided};
  if(input.zipBytes||input.files?.length===1&&/\.zip$/i.test(input.files[0].name)){
   const file=input.files?.[0];if(file?.size>512*MiB)throw Error('Este ZIP supera 512 MB. Descomprímelo y selecciona su carpeta para leer solo el historial y los recursos necesarios.');
   const bytes=input.zipBytes instanceof Uint8Array?input.zipBytes:input.zipBytes?new Uint8Array(input.zipBytes):new Uint8Array(await file.arrayBuffer()),entries=zip.inspect(bytes);
   return{entries,read:async names=>zip.unzip(bytes,{maxEntries:65534,filter:entry=>names.has(entry.name)}),name:input.name||file?.name||'Exportación ChatGPT'};
  }
  const handles=new Map(),entries=[];
  for(const file of input.files||[]){const name=pathName(file.webkitRelativePath||file.name);if(handles.has(name))throw Error('Archivos con la misma ruta. Selecciona una sola exportación.');handles.set(name,file);entries.push({name,size:file.size});}
  for(const[name,value]of Object.entries(input.fileMap||{})){const clean=pathName(name),bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);if(handles.has(clean))throw Error('Archivos duplicados');handles.set(clean,bytes);entries.push({name:clean,size:bytes.length});}
  return{entries,name:input.name||'Carpeta de exportación',read:async names=>{const result={};for(const name of names){const file=handles.get(name);if(!file)throw Error('Falta el archivo '+name);Object.defineProperty(result,name,{value:file instanceof Uint8Array?file:new Uint8Array(await file.arrayBuffer()),enumerable:true});}return result;}};
 }
 function resourceMatcher(entries){
  const full=new Map(entries.map(entry=>[entry.name,entry])),byName=new Map();for(const entry of entries){const name=basename(entry.name);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(entry);}
  const ordered=[...byName.keys()].sort();
  function prefix(value){let lo=0,hi=ordered.length;while(lo<hi){const mid=(lo+hi)>>>1;if(ordered[mid]<value)lo=mid+1;else hi=mid;}const found=[];for(let i=lo;i<ordered.length&&ordered[i].startsWith(value);i++){const next=ordered[i][value.length];if(!next||['-','_','.'].includes(next))found.push(...byName.get(ordered[i]));if(found.length>2)break;}return found;}
  return attachment=>{
   const candidates=[attachment.fileId,attachment.assetPointer,attachment.id].filter(value=>typeof value==='string').map(value=>value.replace(/^(?:sediment|file-service):\/\//,''));
   for(const value of candidates){const found=full.has(value)?[full.get(value)]:prefix(value);if(found.length===1)return{entry:found[0]};if(found.length>1)return{reason:'ambiguous'};}
   for(const value of [attachment.name,attachment.filename,attachment.sourceURL].filter(value=>typeof value==='string')){let clean=value;try{if(/^https?:/.test(clean))clean=decodeURIComponent(new URL(clean).pathname.replace(/^\//,''));else clean=decodeURIComponent(clean);}catch(error){clean=value;}
    const found=full.has(clean)?[full.get(clean)]:(byName.get(basename(clean))||[]);if(found.length===1)return{entry:found[0]};if(found.length>1)return{reason:'ambiguous'};
   }
   return{reason:'missing'};
  };
 }
 async function read(input,options={}){
  const progress=options.onProgress||(()=>undefined),archive=await inputSource(input),entries=archive.entries.filter(entry=>!entry.name.endsWith('/'));let history=entries.filter(entry=>historyName(entry.name));
  if(!history.length&&!input.zipBytes&&input.files?.every(file=>/\.json$/i.test(file.name)))history=entries.filter(entry=>/\.json$/i.test(entry.name));
  if(!history.length)throw Error('No se encontraron conversations.json ni sus archivos numerados. Selecciona el ZIP oficial o la carpeta descomprimida.');
  if(history.reduce((sum,file)=>sum+file.size,0)>256*MiB)throw Error('El historial supera 256 MB. Selecciona una parte de los archivos conversations-*.json.');
  progress({stage:'history',completed:0,total:history.length});const historyFiles=await archive.read(new Set(history.map(entry=>entry.name))),sources=[],identities=new Map(),manager=new acquisition.ChatGPTAcquisitionManager();let duplicateCount=0,unrepresentedParts=0;
  for(const[index,file]of history.entries()){
   let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(historyFiles[file.name]).replace(/^\uFEFF/,''));}catch(error){throw Error('No se pudo leer '+basename(file.name)+': JSON no válido');}
   const list=Array.isArray(parsed)?parsed:Array.isArray(parsed?.conversations)?parsed.conversations:parsed?.mapping?[parsed]:null;if(!list)throw Error(basename(file.name)+' no contiene conversaciones reconocibles');
   const canonical=manager.ingestOfficialExport(list);
   for(let i=0;i<list.length;i++){
    const raw=list[i],sourceDigest=crypto.sha256(JSON.stringify(raw)),entity=canonical[i],previous=identities.get(entity.canonicalId);if(previous){if(previous!==sourceDigest)throw Error('Hay versiones distintas de la misma conversación en los archivos seleccionados. Importa una exportación a la vez.');duplicateCount++;continue;}identities.set(entity.canonicalId,sourceDigest);
    if(sources.length>=20000)throw Error('Selecciona un lote de hasta 20 000 conversaciones para importar.');
    const unknown=Object.values(raw.mapping).flatMap(node=>node.message?.content?.parts||[]).filter(part=>part&&typeof part==='object'&&part.content_type!=='image_asset_pointer').length;unrepresentedParts+=unknown;
    for(const message of entity.messages||[]){message.attachments=resources.mergeAttachments(message.attachments||message.content?.attachments||[]);if(message.content)message.content.attachments=message.attachments;}
    entity.migration={sourceDigest,date:dateFor(raw),group:groupFor(raw),rawExport:raw,unsupportedContentParts:unknown};sources.push(entity);
   }
   progress({stage:'history',completed:index+1,total:history.length});
  }
  if(!sources.length)throw Error('El archivo no contiene conversaciones para importar.');
  const match=resourceMatcher(entries.filter(entry=>!historyName(entry.name))),requests=[],wanted=new Set();let bytesBudget=0,pending=0,ambiguous=0;
  for(const source of sources){for(const message of source.messages||[]){const attachments=message.attachments||message.content?.attachments||[];for(const attachment of attachments){if(attachment.dataURI||attachment.data)continue;const found=match(attachment);if(!found.entry){pending++;if(found.reason==='ambiguous')ambiguous++;continue;}const entry=found.entry;
    if(entry.size>(options.maxAssetBytes||20*MiB)||!wanted.has(entry.name)&&bytesBudget+entry.size>(options.maxAssetTotalBytes||64*MiB)){pending++;continue;}if(!wanted.has(entry.name)){wanted.add(entry.name);bytesBudget+=entry.size;}requests.push({source,message,attachment,entry});
   }}
  }
  progress({stage:'assets',completed:0,total:wanted.size});const binaries=await archive.read(wanted),dataUris=new Map();let included=0;
  for(const{attachment,entry}of requests){const bytes=binaries[entry.name];if(!bytes?.length){pending++;continue;}const type=mime(bytes,attachment.mimeType,entry.name);if(attachment.mimeType?.startsWith('image/')&&!type.startsWith('image/')){pending++;continue;}if(!dataUris.has(entry.name))dataUris.set(entry.name,'data:'+type+';base64,'+base64(bytes));attachment.dataURI=dataUris.get(entry.name);attachment.mimeType=type;attachment.availability='embedded';attachment.downloadable=true;included++;}
  for(const source of sources){source.attachments=(source.messages||[]).flatMap(message=>message.attachments||message.content?.attachments||[]);for(const message of source.messages||[])if(message.content)message.content.attachments=message.attachments||message.content.attachments||[];source.migration.resourceDigest=crypto.sha256(JSON.stringify(source.attachments.map(attachment=>({id:attachment.fileId||attachment.id,name:attachment.name,mimeType:attachment.mimeType,dataURI:attachment.dataURI||null}))));}
  progress({stage:'assets',completed:wanted.size,total:wanted.size});
  const warnings=[];if(pending)warnings.push(pending+' referencias a archivos no se recuperaron del material seleccionado.');if(ambiguous)warnings.push(ambiguous+' referencias tienen varios archivos posibles; no se eligió uno por suposición.');if(unrepresentedParts)warnings.push(unrepresentedParts+' partes no textuales se conservan en los datos originales, pero no se convierten a texto.');
  return{sources,archive:{name:archive.name,digest:crypto.sha256(JSON.stringify([...identities].sort())),historyFiles:history.map(file=>file.name),duplicateCount,sourceCount:sources.length,resourceReferencesIncluded:included,resourceReferencesPending:pending,resourcesIncluded:dataUris.size,omittedFiles:entries.length-history.length-wanted.size,unsupportedContentParts:unrepresentedParts,warnings}};
 }
 function organize(sources,mode='date'){
  const folders=new Map();const add=(id,name,parentId,sourceId)=>{if(!folders.has(id))folders.set(id,{id,name,parentId,conversationIds:[]});folders.get(id).conversationIds.push(sourceId);};
  for(const source of sources){const group=mode==='source'?source.migration?.group:null;if(group){const root=group.kind==='project'?'projects':group.kind==='gpt'?'gpts':'references',id=root+'_'+crypto.sha256(group.id).slice(0,16);add(root,group.kind==='project'?'Proyectos indicados':group.kind==='gpt'?'GPTs indicados':'Identificadores del archivo',null,source.canonicalId);add(id,group.name,root,source.canonicalId);continue;}const date=source.migration?.date;
   if(date){const year=date.slice(0,4),month=date.slice(0,7);add('year_'+year,year,null,source.canonicalId);add('month_'+month,month,'year_'+year,source.canonicalId);}else add('undated','Sin fecha indicada',null,source.canonicalId);
  }
  return{version:1,mode,folders:[...folders.values()].sort((a,b)=>(a.parentId||'').localeCompare(b.parentId||'')||a.name.localeCompare(b.name))};
 }
 return{read,organize,historyName,resourceMatcher};
});
