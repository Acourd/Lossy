/** Project packages are validated in full before a restoration plan can write anything. */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./zip_builder'),require('../crypto_util'));
 else{root.Lossy=root.Lossy||{};root.Lossy.ProjectBundle=factory(root.Lossy.ZipBuilder,root.Lossy.Crypto);}
})(typeof globalThis!=='undefined'?globalThis:this,function(zip,crypto){
 'use strict';
 const contextLimits={goal:6000,decisions:12000,openQuestions:12000,nextStep:6000};
 const digest=value=>crypto.sha256(typeof value==='string'?value:JSON.stringify(value));
 const text=bytes=>typeof bytes==='string'?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 function cleanContext(context={}){
  if(!context||typeof context!=='object'||Array.isArray(context))throw Error('El contexto del proyecto no es válido');const result={};
  for(const[key,limit]of Object.entries(contextLimits)){const value=context[key]??'';if(typeof value!=='string'||value.length>limit)throw Error('Campo de proyecto inválido: '+key);result[key]=value;}
  result.status=context.status||'active';if(!['active','paused','completed'].includes(result.status))throw Error('Estado de proyecto inválido');return result;
 }
 const ALLOWED_PLATFORMS=new Set(['chatgpt','gemini','claude','unknown']);
 const isSafeCount=v=>v===undefined||v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10000000);
 function validateAttachments(list){
  if(list===undefined||list===null)return;
  if(!Array.isArray(list)||list.length>5000)throw Error('Lista de adjuntos inválida');
  for(const a of list){
   if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Adjunto inválido');
   for(const k of ['id','assetId','fileId','assetPointer','filename','name','mimeType','kind','sourceType','sourceURL','url','dataURI','availability']){
    if(a[k]!==undefined&&a[k]!==null&&typeof a[k]!=='string')throw Error('Campo de adjunto inválido: '+k);
   }
  }
 }
 function validateCodeBlocks(list){
  if(list===undefined||list===null)return;
  if(!Array.isArray(list)||list.length>5000)throw Error('Lista de bloques de código inválida');
  for(const cb of list){
   if(!cb||typeof cb!=='object'||Array.isArray(cb))throw Error('Bloque de código inválido');
   if(cb.language!==undefined&&cb.language!==null&&typeof cb.language!=='string')throw Error('Lenguaje de código inválido');
   if(cb.code!==undefined&&cb.code!==null&&typeof cb.code!=='string')throw Error('Contenido de código inválido');
  }
 }
 function validateEntity(entity){
  if(!entity||typeof entity!=='object'||typeof entity.canonicalId!=='string'||!entity.canonicalId||entity.canonicalId.length>300)throw Error('Una fuente del proyecto no tiene un identificador válido');
  if(entity.title!==undefined&&entity.title!==null&&(typeof entity.title!=='string'||entity.title.length>2000))throw Error('Título de fuente inválido');
  const messages=entity.selectedMessages||entity.messages;if(!Array.isArray(messages)||messages.some(m=>!m||typeof m!=='object'||typeof m.role!=='string'||(m.text!==undefined&&m.text!==null&&typeof m.text!=='string')||(m.content?.text!==undefined&&typeof m.content.text!=='string')))throw Error('Una fuente del proyecto contiene mensajes inválidos');
  if(entity.entityType==='clip'&&!Array.isArray(entity.selectedMessages))throw Error('Clip sin selección de mensajes');
  for(const plat of [entity.source?.platform, entity.sourcePlatform]){
   if(plat!==undefined&&plat!==null&&(typeof plat!=='string'||!ALLOWED_PLATFORMS.has(plat.toLowerCase())))throw Error('Plataforma de fuente inválida');
  }
  validateAttachments(entity.attachments);
  for(const m of messages){validateAttachments(m.attachments);validateAttachments(m.content?.attachments);validateCodeBlocks(m.codeBlocks);validateCodeBlocks(m.content?.codeBlocks);}
  for(const k of ['conversationMessageCount','visibleMessageCount','sourceNodeCount'])if(!isSafeCount(entity[k]))throw Error('Métrica numérica inválida: '+k);
  if(entity.nodeMetrics!==undefined&&entity.nodeMetrics!==null){
   if(typeof entity.nodeMetrics!=='object'||Array.isArray(entity.nodeMetrics))throw Error('Métricas de nodo inválidas');
   for(const [mk,mv] of Object.entries(entity.nodeMetrics))if(!isSafeCount(mv))throw Error('Métrica de nodo inválida: '+mk);
  }
  return entity;
 }
 function cleanOrganization(value, sourceIds){
  if(value==null)return undefined;
  if(value.version!==1||!Array.isArray(value.folders)||value.folders.length>20000)throw Error('Organización de proyecto inválida');
  const allowed=new Set(sourceIds),byId=new Map();
  for(const folder of value.folders){if(!folder||typeof folder.id!=='string'||!folder.id||folder.id.length>200||byId.has(folder.id)||typeof folder.name!=='string'||!folder.name.trim()||folder.name.length>2000||!(folder.parentId==null||typeof folder.parentId==='string')||!Array.isArray(folder.conversationIds)||folder.conversationIds.some(id=>!allowed.has(id)))throw Error('Carpeta de proyecto inválida');byId.set(folder.id,folder);}
  const done=new Set(),active=new Set();const visit=id=>{if(done.has(id))return;if(active.has(id))throw Error('Las carpetas contienen un ciclo');active.add(id);const folder=byId.get(id);if(folder.parentId!=null){const parent=byId.get(folder.parentId);if(!parent)throw Error('Carpeta superior ausente');if(folder.conversationIds.some(source=>!parent.conversationIds.includes(source)))throw Error('Las fuentes de una subcarpeta no coinciden con su carpeta');visit(folder.parentId);}active.delete(id);done.add(id);};for(const id of byId.keys())visit(id);
  return structuredClone(value);
 }
 async function readProjectPackage(buffer){
  const files=await zip.unzip(buffer,{maxEntries:65534});if(!files['project.json'])throw Error('Este ZIP no contiene un proyecto Lossy (project.json)');
  const receiptPath=['portability/receipt.json','receipt.json'].find(name=>files[name]);if(!receiptPath)throw Error('El proyecto no contiene un recibo de integridad');
  const receipt=JSON.parse(text(files[receiptPath])),hashes=receipt.fileHashes;if(!hashes||typeof hashes!=='object'||Array.isArray(hashes))throw Error('Recibo de proyecto inválido');
  for(const[name,bytes]of Object.entries(files)){if(name===receiptPath)continue;if(!Object.hasOwn(hashes,name)||!/^[a-f\d]{64}$/i.test(hashes[name])||crypto.sha256(bytes)!==hashes[name])throw Error('El paquete está incompleto o fue modificado: '+name);}
  for(const name of Object.keys(hashes))if(!files[name])throw Error('Falta un archivo del proyecto: '+name);
  const raw=JSON.parse(text(files['project.json']));if(!['1.0','1.1'].includes(raw.version)||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>500||!Array.isArray(raw.sourceIds)||raw.sourceIds.length>20000||raw.sourceIds.some(id=>typeof id!=='string'||!id))throw Error('Formato de proyecto no reconocido');
  if(new Set(raw.sourceIds).size!==raw.sourceIds.length)throw Error('El proyecto contiene identificadores de fuente repetidos');
  const sources=[],byId=new Map();
  const paths=Array.isArray(raw.sources)?raw.sources.map(item=>item?.path):Object.keys(files).filter(name=>/^(?:conversations|CONVERSATIONS)\/[^/]+\.json$/.test(name));
  for(const name of paths){if(typeof name!=='string'||!files[name]||name==='project.json')throw Error('Falta una fuente del proyecto');const item=validateEntity(JSON.parse(text(files[name])));if(byId.has(item.canonicalId))throw Error('El proyecto contiene fuentes duplicadas');byId.set(item.canonicalId,item);}
  for(const id of raw.sourceIds){if(!byId.has(id))throw Error('Este paquete no conserva la fuente completa '+id+'. Usa un ZIP de proyecto o un paquete con datos canónicos.');sources.push(byId.get(id));}
  if(byId.size!==sources.length)throw Error('Las fuentes no coinciden con el índice del proyecto');
  if(Array.isArray(raw.sources)&&raw.sources.some((entry,i)=>entry.canonicalId!==raw.sourceIds[i]||!byId.has(entry.canonicalId)))throw Error('Índice de fuentes de proyecto inválido');
  return{project:{id:typeof raw.id==='string'?raw.id:null,name:raw.name.trim(),description:typeof raw.description==='string'?raw.description:'',createdAt:raw.createdAt,context:cleanContext(raw.context),organization:cleanOrganization(raw.organization,raw.sourceIds),migration:raw.migration&&typeof raw.migration==='object'?structuredClone(raw.migration):undefined},sources,packageDigest:crypto.sha256(buffer instanceof Uint8Array?buffer:new Uint8Array(buffer)),fileCount:Object.keys(files).length};
 }
 async function planRestore(db,bundle,options={}){
  const mode=options.mode||'copy';if(!['copy','update'].includes(mode))throw Error('Modo de restauración inválido');
  const target=mode==='update'?await db.getCollection(options.targetId||bundle.project.id):undefined;if(mode==='update'&&!target)throw Error('Selecciona un proyecto existente para actualizar');
  const expectedSources=Object.create(null),writes=[],mapping=new Map();let reused=0,copied=0;
  let sourceIndex=0;
  for(const source of [...bundle.sources].sort((a,b)=>(a.entityType==='clip')-(b.entityType==='clip'))){
   if(options.signal?.aborted)throw new Error('Importación cancelada');options.onProgress?.(++sourceIndex,bundle.sources.length);
   validateEntity(source);const original=source.canonicalId,originalDigest=digest(source),identity=options.sourceIdentity?.(source)||originalDigest,existing=await db.getConversation(original);expectedSources[original]=existing?JSON.stringify(existing):null;
   let item=structuredClone(source);
   if(item.entityType==='clip'){
    const parent=item.sourceConversationCanonicalId||item.provenance?.sourceConversationCanonicalId;
    if(mapping.has(parent)){item.sourceConversationCanonicalId=mapping.get(parent);if(item.provenance)item.provenance={...item.provenance,sourceConversationCanonicalId:mapping.get(parent)};}
   }
   if(existing&&(digest(existing)===digest(item)||options.reuseEquivalentSources?.(item,existing))){mapping.set(original,original);reused++;continue;}
   if(existing){
    const base='restored_'+original.slice(0,130)+'_'+identity.slice(0,16);let chosen;
    for(let i=0;i<100;i++){const id=base+(i?'_'+i:''),candidate={...item,canonicalId:id,id,restoration:{originalCanonicalId:original,contentDigest:originalDigest}},found=await db.getConversation(id);expectedSources[id]=found?JSON.stringify(found):null;if(!found||digest(found)===digest(candidate)||options.reuseEquivalentSources?.(candidate,found)){chosen={item:candidate,found};break;}}
    if(!chosen)throw Error('No se pudo asignar un identificador a una fuente restaurada');item=chosen.item;copied++;if(chosen.found){mapping.set(original,item.canonicalId);reused++;continue;}
   }
   mapping.set(original,item.canonicalId);writes.push(item);
  }
  for(const item of writes){
   if(item.entityType==='clip'){
    const parent=item.sourceConversationCanonicalId||item.provenance?.sourceConversationCanonicalId;
    if(mapping.has(parent)){item.sourceConversationCanonicalId=mapping.get(parent);if(item.provenance)item.provenance={...item.provenance,sourceConversationCanonicalId:mapping.get(parent)};}
   }
  }
  const now=new Date().toISOString(),id=target?.collectionId||'coll_restored_'+Date.now()+'_'+Math.random().toString(36).slice(2,10),members=bundle.sources.map(item=>mapping.get(item.canonicalId));
  const project={...(target||{}),collectionId:id,id,name:bundle.project.name+(mode==='copy'?(options.copySuffix??' · restaurado'):''),description:bundle.project.description,createdAt:target?.createdAt||(Number.isFinite(Date.parse(bundle.project.createdAt))?bundle.project.createdAt:now),updatedAt:now,conversationIds:mode==='update'?[...new Set([...(target.conversationIds||[]),...members])]:members,projectContext:{...cleanContext(bundle.project.context),revision:(target?.projectContext?.revision||0)+1,updatedAt:now}};
  if(bundle.project.organization){const organization=cleanOrganization(bundle.project.organization,bundle.sources.map(source=>source.canonicalId));project.organization={...organization,folders:organization.folders.map(folder=>({...folder,conversationIds:[...new Set(folder.conversationIds.map(id=>mapping.get(id)))]}))};}
  if(options.mergeOrganization&&target?.organization&&project.organization){
   const folders=new Map(target.organization.folders.map(folder=>[folder.id,structuredClone(folder)]));
   for(const folder of project.organization.folders){const previous=folders.get(folder.id);folders.set(folder.id,{...folder,conversationIds:[...new Set([...(previous?.conversationIds||[]),...folder.conversationIds])]});}
   project.organization=cleanOrganization({...project.organization,folders:[...folders.values()]},project.conversationIds);
  }
  if(bundle.project.migration)project.migration=structuredClone(bundle.project.migration);
  return{mode,project,sources:writes,expectedProject:target?JSON.stringify(target):null,expectedSources,summary:{total:bundle.sources.length,inserted:writes.length,reused,conflictingCopies:copied,preservedMembers:target?.conversationIds?.filter(id=>!members.includes(id)).length||0}};
 }
 return{readProjectPackage,planRestore,cleanContext,cleanOrganization,validateEntity};
});
