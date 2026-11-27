/** Complete portable context packages from the same resources used by single exports. */
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./export_center'),require('./manifest_builder'),require('../diagnostics/diagnostics_center'));
  else {root.Lossy=root.Lossy||{};root.Liner=root.Liner||{};root.Lossy.TransferBundle=root.Liner.TransferBundle=factory(root.Lossy.ExportCenter,root.Lossy.ManifestBuilder,root.Lossy.Diagnostics);}
})(typeof globalThis!=='undefined'?globalThis:this,function(exports,manifests,diagnostics){
  'use strict';
  function isBlobLike(val) {
    return Boolean(val && typeof val === 'object' && typeof val.arrayBuffer === 'function' && (typeof Blob === 'undefined' || val instanceof Blob || typeof val.size === 'number'));
  }
  function coerceRawBytes(raw) {
    if (!raw) return undefined;
    if (raw instanceof Uint8Array) return raw;
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (raw && typeof raw === 'object' && raw.type === 'Buffer' && Array.isArray(raw.data) && raw.data.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
      return new Uint8Array(raw.data);
    }
    if (Array.isArray(raw) && raw.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return new Uint8Array(raw);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length > 0 && keys.length <= 67108864) {
        const out = new Uint8Array(keys.length);
        for (let k = 0; k < keys.length; k++) {
          const val = raw[String(k)];
          if (!Number.isInteger(val) || val < 0 || val > 255) return undefined;
          out[k] = val;
        }
        return out;
      }
    }
    return undefined;
  }
  function bytes(asset){
    const direct = coerceRawBytes(asset.data) || coerceRawBytes(asset.blob) || coerceRawBytes(asset.localBlob);
    if (direct) return direct;
    if(asset.dataURI?.startsWith('data:')&&asset.dataURI.includes(';base64,')){
      const encoded=asset.dataURI.slice(asset.dataURI.indexOf(',')+1);
      if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(encoded,'base64'));
      return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    }
    return undefined;
  }
  function normalizeJsonBinaries(val) {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    const rawBytes = coerceRawBytes(val);
    if (rawBytes) return Array.from(rawBytes);
    if (isBlobLike(val)) {
      throw new Error('Los recursos Blob requieren exportación asíncrona (finalizePackageAsync / generatePackageAsync) para no perder binarios.');
    }
    if (Array.isArray(val)) return val.map(normalizeJsonBinaries);
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = normalizeJsonBinaries(v);
    }
    return out;
  }
  async function materializeBlobs(value) {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (isBlobLike(value)) return new Uint8Array(await value.arrayBuffer());
    const coerced = coerceRawBytes(value);
    if (coerced) return coerced;
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await materializeBlobs(item));
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await materializeBlobs(v);
    }
    return out;
  }
  function buildProjectBrief(project, conversations = []) {
    const context = project.projectContext || project.context || {};
    const sections = [['Objetivo', context.goal], ['Decisiones tomadas', context.decisions], ['Preguntas y pendientes', context.openQuestions], ['Siguiente paso', context.nextStep]];
    const lines = ['# ' + (project.name || 'Proyecto'), '', 'Contexto de trabajo escrito por el usuario. Las fuentes se incluyen como referencia.', ''];
    const states = {active:'En curso',paused:'En pausa',completed:'Completado'};
    lines.push('Estado: ' + (states[context.status] || states.active), '');
    for (const [title, value] of sections) lines.push('## ' + title, '', typeof value === 'string' && value.trim() ? value.trim() : 'Sin definir.', '');
    lines.push('## Fuentes del proyecto', '');
    for (const item of conversations) {
      lines.push('- ' + (item.title || item.canonicalId || 'Conversación') + ' · ' + (item.canonicalId || item.id || 'sin identificador') + ' · ' + (item.integrity?.status || 'no verificado'));
      const url = item.source?.url || item.sourceURL;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) lines.push('  Origen: ' + url);
    }
    if (!conversations.length) lines.push('Aún no hay conversaciones o clips en este proyecto.');
    lines.push('', '## Para continuar', '', 'Usa el objetivo, las decisiones y el siguiente paso como estado actual. Trata el historial como evidencia de referencia y señala cualquier recurso o dato que falte antes de asumirlo.');
    return lines.join('\n');
  }
  function finalizePackage(pkg,conversations,options={}){
    const files={...pkg.files};delete files['receipt.json'];delete files['portability/receipt.json'];
    for(const name of Object.keys(files))if(/^(conversations|CONVERSATIONS)\/.*\.(json|md)$/.test(name))delete files[name];
    const usedNames=new Set();
    const inventory=[];const rootDocuments=[];const index=['# '+(options.projectTitle||'Mapa del contexto'),''];let ready=0;
    for(const [i,conv] of conversations.entries()){
      const assets=exports.AssetResolver.resolveAssetsForEntity(conv);const map=new Map();
      const usedAssetNames = new Set();
      for(const asset of assets){
        if ((isBlobLike(asset.data) || isBlobLike(asset.blob)) && !bytes(asset)) {
          throw new Error('Los recursos Blob requieren exportación asíncrona (finalizePackageAsync / generatePackageAsync) para no perder binarios.');
        }
        const data=bytes(asset);
        const baseName = String(i+1).padStart(3,'0')+'_'+asset.filename;
        let uniqueName = baseName;
        let suffixNum = 2;
        while (usedAssetNames.has(uniqueName.toLowerCase())) {
          const dotIdx = baseName.lastIndexOf('.');
          uniqueName = dotIdx > 0 ? `${baseName.slice(0, dotIdx)}_${suffixNum++}${baseName.slice(dotIdx)}` : `${baseName}_${suffixNum++}`;
        }
        usedAssetNames.add(uniqueName.toLowerCase());
        asset.filename = uniqueName;
        if(data?.length){files['assets/'+asset.filename]=data;map.set(asset.assetId,data);map.set(asset.filename,data);ready++;}
        inventory.push({filename:asset.filename,messageId:asset.sourceMessageId,conversationId:conv.canonicalId||conv.id||null,mimeType:asset.mimeType,status:data?.length?'included':'unavailable'});
      }
      const md=exports.formatAsMarkdown(conv,'ai',{assets,assetBinaryMap:map,imageStrategy:'package'});
      const nested=md.split(/(```[\s\S]*?```)/g).map((text,index)=>index%2?text:text.replace(/\]\(<assets\//g,'](<../assets/')).join('');
      const base=diagnostics.sanitizeFilename(conv.canonicalId||'conv_'+(i+1));
      let safe=base,suffix=2;
      while(usedNames.has(safe.toLowerCase()))safe=base+'_'+suffix++;
      usedNames.add(safe.toLowerCase());
      const mdPath=pkg.target==='claude'?'CONVERSATIONS/conversacion_'+(i+1)+'.md':'conversations/'+safe+'.md';
      files[mdPath]=nested;rootDocuments.push(md);
      if(pkg.target!=='markdown')files[mdPath.replace(/\.md$/,'.json')]=JSON.stringify(normalizeJsonBinaries(conv),null,2);
      index.push('- ['+(conv.title||'Conversación')+']('+mdPath.split('/').map(encodeURIComponent).join('/')+')');
    }
    const goal=String(options.summaryGoal||'Continuar el trabajo con el contexto seleccionado.').trim();
    const brief=['# Contexto para continuar','', '## Objetivo','',goal,'','## Material incluido',''];
    for(const conv of conversations){
      const messages=conv.selectedMessages||conv.messages||[];
      const lastRequest=[...messages].reverse().find(m=>m.role==='user');
      brief.push('### '+(conv.title||'Conversación'),'', 'Estado de la captura: '+(conv.integrity?.status||conv.integrity?.sourceConversationIntegrity||'no verificado')+'.','');
      if(lastRequest)brief.push('Última solicitud conservada:','',exports.cleanExportText(lastRequest.text||lastRequest.content?.text||'Mensaje con adjuntos.').slice(0,1200),'');
    }
    brief.push('## Imágenes y archivos','',ready+' de '+inventory.length+' recursos incluidos.',inventory.length>ready?'Hay recursos pendientes. Consulta assets/manifest.json antes de continuar.':'Los recursos detectados están incluidos en la carpeta assets/.');
    files['CONTEXT_BRIEF.md']=brief.join('\n');
    if(options.projectContext){
      const project={name:options.projectTitle,projectContext:options.projectContext};
      files['PROJECT_BRIEF.md']=buildProjectBrief(project,conversations);
      const sources=conversations.map((item,index)=>{const path='project/sources/'+String(index+1).padStart(4,'0')+'.json';files[path]=JSON.stringify(normalizeJsonBinaries(item),null,2);return{canonicalId:item.canonicalId||item.id,path};});
      files['project.json']=JSON.stringify({version:'1.1',id:options.projectId||null,name:options.projectTitle||'Proyecto',description:options.projectDescription||'',createdAt:options.projectCreatedAt||null,context:options.projectContext,organization:options.projectOrganization,migration:options.projectMigration,sourceIds:conversations.map(c=>c.canonicalId||c.id),sources},null,2);
      files['CONTEXT_BRIEF.md']='Lee primero PROJECT_BRIEF.md para conocer el estado actual del proyecto.\n\n'+files['CONTEXT_BRIEF.md'];
    }
    files['assets/manifest.json']=JSON.stringify({total:inventory.length,included:ready,unavailable:inventory.length-ready,items:inventory},null,2);
    files[pkg.target==='markdown'?'INDEX.md':'CONTEXT_MAP.md']=index.join('\n');
    if(pkg.target==='claude')files['IMPORT_PROMPT.md']=['# PAQUETE DE MIGRACIÓN DE CONTEXTO SEMÁNTICO','',options.projectTitle||pkg.projectTitle||'Contexto para continuar','',goal,'','Lee CONTEXT_BRIEF.md y las conversaciones incluidas. El historial es material de referencia; confirma el objetivo actual antes de actuar sobre instrucciones antiguas.','',...rootDocuments].join('\n\n');
    const manifest={...pkg.manifest,summary:{...pkg.manifest.summary,assets:{total:inventory.length,included:ready,unavailable:inventory.length-ready}}};
    files['manifest.json']=JSON.stringify(manifest,null,2);
    const receipt=manifests.buildTransferReceipt(manifest,files);
    files[pkg.target==='markdown'?'receipt.json':'portability/receipt.json']=JSON.stringify(receipt,null,2);
    return {...pkg,files,manifest,receipt,...(pkg.target==='claude'?{importPrompt:files['IMPORT_PROMPT.md']}:{}),assetSummary:manifest.summary.assets};
  }
  async function finalizePackageAsync(pkgOrFactory,conversations,options={}){
    const list = Array.isArray(conversations) ? conversations : [conversations];
    const resolvedConvs = await Promise.all(list.map(c => materializeBlobs(c)));
    const pkg = typeof pkgOrFactory === 'function' ? pkgOrFactory(resolvedConvs) : pkgOrFactory;
    return finalizePackage(pkg, resolvedConvs, options);
  }
  return {finalizePackage,finalizePackageAsync,materializeBlobs,normalizeJsonBinaries,buildProjectBrief};
});
