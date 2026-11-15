/** Resolve ChatGPT attachments while the existing web session is available. */
(function(root,factory){
  if(typeof module !== 'undefined' && module.exports) module.exports=factory();
  else { root.Lossy=root.Lossy||{};root.Liner=root.Liner||{};root.Lossy.ChatGPTAssets=root.Liner.ChatGPTAssets=factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this,function(){
  'use strict';

  function fileId(asset) {
    const candidates=[asset.fileId,asset.assetPointer,asset.id,asset.assetId,asset.sourceURL,asset.url].filter(v=>typeof v==='string');
    for(const value of candidates){
      const clean=value.replace(/^(?:sediment|file-service):\/\//,'');
      if(/^file[_-][\w-]+$/.test(clean)) return clean;
      const match=value.match(/(?:[?&]id=|\/)(file[_-][\w-]+)(?:[?&#/]|$)/);
      if(match) return match[1];
    }
    return '';
  }

  function mergeAttachments(attachments) {
    const result=[];const identities=new Map();
    for(const att of attachments.filter(Boolean)){
      const key=fileId(att)||att.sourceURL||att.url||att.dataURI||att.assetId||att.id;
      const existing=key && identities.get(key);
      if(existing){
        for(const prop of ['assetPointer','dataURI','data','blob','sourceURL','url','width','height','fileId']) if(!existing[prop] && att[prop]) existing[prop]=att[prop];
        if(att.filename && (!existing.filename || existing.sourceType==='image_asset_pointer' && att.sourceType!=='image_asset_pointer')){
          existing.filename=att.filename;existing.name=att.filename;
          if(att.mimeType)existing.mimeType=att.mimeType;
        }
      } else {const copy={...att};result.push(copy);if(key)identities.set(key,copy);}
    }
    return result;
  }

  function imageMime(bytes) {
    if(bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71)return 'image/png';
    if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
    if(String.fromCharCode(...bytes.slice(0,3))==='GIF')return 'image/gif';
    if(String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    throw new Error('La respuesta no es una imagen PNG, JPEG, GIF o WebP');
  }

  function base64(bytes) {
    if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
    let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(text);
  }

  function summary(conv) {
    const messages=conv.selectedMessages||conv.messages||[];
    const images=messages.flatMap(m=>mergeAttachments([...(m.attachments||[]),...(m.content?.attachments||[])])).filter(a=>a.kind==='image'||a.mimeType?.startsWith('image/'));
    const ready=images.filter(a=>Boolean(a.dataURI||a.data?.length||a.blob)).length;
    return {total:images.length,ready,missing:images.length-ready};
  }

  async function resolveConversationAssets(conversation,options={}) {
    const conv=structuredClone(conversation);
    const fetchFn=options.fetch||globalThis.fetch;
    const origin=options.baseOrigin||(typeof location!=='undefined'?location.origin:'https://chatgpt.com');
    const conversationId=conv.source?.conversationId||conv.sourceConversationId;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),options.timeoutMs||45000);
    const externalAbort=()=>controller.abort();
    options.signal?.addEventListener('abort',externalAbort,{once:true});
    if(options.signal?.aborted)controller.abort();
    let tokenPromise;
    const token=()=>tokenPromise||(tokenPromise=options.getToken ? Promise.resolve().then(options.getToken) : Promise.reject(new Error('Sesión no disponible para descargar imágenes')));
    const cache=new Map();let cursor=0;
    const messages=conv.selectedMessages||conv.messages||[];
    const work=[];
    for(const msg of messages){
      const atts=mergeAttachments([...(msg.attachments||[]),...(msg.content?.attachments||[])]);
      msg.attachments=atts;msg.content={...msg.content,attachments:atts};
      for(const asset of atts) if(asset.kind==='image'||asset.mimeType?.startsWith('image/'))work.push(asset);
    }
    const trusted=url=>url.origin===origin||(/^https:$/.test(url.protocol)&&/(^|\.)oaiusercontent\.com$/.test(url.hostname));
    async function request(address){
      const url=new URL(address,origin);
      if(!trusted(url)||url.username||url.password)throw new Error('Origen de imagen no permitido');
      const sameOrigin=url.origin===origin;
      const headers={Accept:'*/*'};
      // Bearer belongs only to the ChatGPT backend, never to the signed CDN URL.
      if(sameOrigin && url.pathname.startsWith('/backend-api/'))headers.Authorization='Bearer '+await token();
      const perRequest=new AbortController();
      const abort=()=>perRequest.abort();controller.signal.addEventListener('abort',abort,{once:true});
      if(controller.signal.aborted)perRequest.abort();
      const timer=setTimeout(abort,options.requestTimeoutMs||10000);
      try {
        const response=await fetchFn(url.href,{method:'GET',headers,credentials:sameOrigin?'include':'omit',redirect:'error',signal:perRequest.signal});
        if(!response.ok){const error=new Error('HTTP '+response.status);error.status=response.status;throw error;}
        const type=response.headers?.get('content-type')||'';
        if(type.includes('application/json'))return {metadata:await response.json()};
        const size=Number(response.headers?.get('content-length')||0);
        if(size>30*1024*1024)throw new Error('La imagen supera el límite de 30 MB');
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(!bytes.length || bytes.length>30*1024*1024)throw new Error('Tamaño de imagen no admitido');
        return {bytes,mimeType:imageMime(bytes)};
      } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
    }
    async function download(asset){
      if(asset.dataURI||asset.data?.length||asset.blob)return {};
      const id=fileId(asset);const urls=[];
      if(asset.sourceURL||asset.url)urls.push(asset.sourceURL||asset.url);
      if(id){
        urls.push('/backend-api/files/download/'+encodeURIComponent(id)+(conversationId?'?conversation_id='+encodeURIComponent(conversationId)+'&inline=false':''));
        urls.push('/backend-api/files/'+encodeURIComponent(id)+'/download');
        if(conversationId)urls.push('/backend-api/conversation/'+encodeURIComponent(conversationId)+'/attachment/'+encodeURIComponent(id)+'/download');
      }
      let lastError=new Error('No hay un identificador ni una URL para esta imagen');
      for(const address of [...new Set(urls)]){
        if(controller.signal.aborted)throw new Error('Descarga de imágenes interrumpida o agotada');
        try {
          let result=await request(address);let name;
          if(result.metadata){
            name=result.metadata.file_name;
            const signed=result.metadata.download_url||result.metadata.url;
            if(!signed)throw new Error('El servicio no devolvió una URL de descarga');
            result=await request(signed);
          }
          if(!result.bytes)throw new Error('No se recibieron bytes de imagen');
          const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[result.mimeType];
          const preferred=asset.filename && !asset.filename.startsWith('chatgpt_asset_') ? asset.filename : name;
          let filename=(preferred||asset.name||id||'imagen').split(/[\\/]/).pop();
          if(!/\.(png|jpe?g|webp|gif)$/i.test(filename))filename+='.'+extension;
          if(result.mimeType==='image/jpeg')filename=filename.replace(/\.png$/i,'.jpg');
          return {dataURI:'data:'+result.mimeType+';base64,'+base64(result.bytes),mimeType:result.mimeType,filename,name:filename,availability:'embedded',resolutionMethod:'authenticated-download',downloadable:true,warnings:[]};
        }catch(error){lastError=error;if(error.status===429)break;}
      }
      throw lastError;
    }
    async function worker(){
      while(cursor<work.length){
        const asset=work[cursor++];const key=fileId(asset)||asset.sourceURL||asset.url||asset.assetId||asset.id||asset;
        try {
          if(!cache.has(key))cache.set(key,download(asset));
          Object.assign(asset,await cache.get(key));
        }catch(error){
          asset.availability='unavailable';
          asset.warnings=['No se pudo obtener la imagen: '+(error.status===429?'límite temporal del servicio':controller.signal.aborted?'tiempo de espera agotado':error.message.startsWith('HTTP ')?error.message:'recurso inaccesible o inválido')];
        }
      }
    }
    try {await Promise.all(Array.from({length:Math.min(3,work.length)},worker));}
    finally {clearTimeout(timeout);options.signal?.removeEventListener('abort',externalAbort);}
    conv.attachments=messages.flatMap(m=>m.attachments||[]);
    if(conv.selectedMessages)conv.messages=conv.selectedMessages;
    conv.assetSummary=summary(conv);
    return conv;
  }
  return {fileId,mergeAttachments,imageMime,summary,resolveConversationAssets};
});
