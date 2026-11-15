importScripts('../core/storage/liner_db.js');
let clipWriteQueue=Promise.resolve();
/**
 * AI Conversation Portability (AICP / Liner) — Background Service Worker (Manifest V3)
 * Mantiene la extensión activa bajo demanda, sin persistencia en memoria ni conexiones externas.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Liner Service Worker] Extensión instalada con éxito. Modo 100% Local-First.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.action==='SAVE_CLIP'){
    if(!request.clip?.canonicalId?.startsWith('clip_')){sendResponse({success:false,error:'Clip inválido'});return false;}
    const write=()=>new LinerDB().saveClip(request.clip);
    const job=clipWriteQueue.then(write,write);clipWriteQueue=job;
    job.then(id=>sendResponse({success:true,id})).catch(error=>sendResponse({success:false,error:error.message}));
    return true;
  }
  if (request.action === 'OPEN_WORKSPACE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/workspace/workspace.html') });
    sendResponse({ success: true });
    return false;
  }
  return false;
});
