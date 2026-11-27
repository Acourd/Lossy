importScripts('../core/storage/liner_db.js');
const clipDb = new LinerDB();
clipDb.open().catch(() => {});
let clipWriteQueue=Promise.resolve();
/**
 * AI Conversation Portability (AICP / Liner) — Background Service Worker (Manifest V3)
 * Mantiene la extensión activa bajo demanda, sin persistencia en memoria ni conexiones externas.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Liner Service Worker] Extensión instalada con éxito. Modo 100% Local-First.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (chrome.runtime?.id && (!sender || sender.id !== chrome.runtime.id)) return false;
  if (!request || typeof request !== 'object') return false;
  if(request.action==='SAVE_CLIP'){
    if(typeof request.clip?.canonicalId !== 'string' || !request.clip.canonicalId.startsWith('clip_')){sendResponse({success:false,error:'Clip inválido'});return false;}
    const enqueuedAt = Date.now();
    const enqueuedWipeEpoch = clipDb.getWipeEpoch();
    const syncIdbEpoch = clipDb.db ? clipDb._resolveBaselineIdbEpoch() : null;
    const snapPromise = syncIdbEpoch !== null ? null : clipDb.captureWipeSnapshot().catch(() => null);
    const write = async () => {
      const snap = snapPromise ? await snapPromise : null;
      const expectedIdbWipeEpoch = syncIdbEpoch !== null ? syncIdbEpoch : (snap ? snap.idbWipeEpoch : clipDb._resolveBaselineIdbEpoch());
      return clipDb.saveClip(request.clip, { expectedWipeEpoch: enqueuedWipeEpoch, expectedIdbWipeEpoch, enqueuedAt });
    };
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
