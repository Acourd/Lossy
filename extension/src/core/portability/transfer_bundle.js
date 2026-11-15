/** Complete portable context packages from the same resources used by single exports. */
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./export_center'),require('./manifest_builder'),require('../diagnostics/diagnostics_center'));
  else {root.Lossy=root.Lossy||{};root.Liner=root.Liner||{};root.Lossy.TransferBundle=root.Liner.TransferBundle=factory(root.Lossy.ExportCenter,root.Lossy.ManifestBuilder,root.Lossy.Diagnostics);}
})(typeof globalThis!=='undefined'?globalThis:this,function(exports,manifests,diagnostics){
  'use strict';
  function bytes(asset){
    if(asset.data instanceof Uint8Array)return asset.data;
    if(Array.isArray(asset.data)&&asset.data.every(value=>Number.isInteger(value)&&value>=0&&value<=255))return new Uint8Array(asset.data);
    if(asset.data instanceof ArrayBuffer)return new Uint8Array(asset.data);
    if(asset.dataURI?.startsWith('data:')&&asset.dataURI.includes(';base64,')){
      const encoded=asset.dataURI.slice(asset.dataURI.indexOf(',')+1);
      if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(encoded,'base64'));
      return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    }
    return undefined;
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
      for(const asset of assets){
        const data=bytes(asset);asset.filename=String(i+1).padStart(3,'0')+'_'+asset.filename;
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
      if(pkg.target!=='markdown')files[mdPath.replace(/\.md$/,'.json')]=JSON.stringify(conv,null,2);
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
      const sources=conversations.map((item,index)=>{const path='project/sources/'+String(index+1).padStart(4,'0')+'.json';files[path]=JSON.stringify(item,(_key,value)=>value instanceof Uint8Array?Array.from(value):value,2);return{canonicalId:item.canonicalId||item.id,path};});
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
  return {finalizePackage,buildProjectBrief};
});
