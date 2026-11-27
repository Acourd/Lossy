/**
 * Liner Context Portability — Almacenamiento Local-First IndexedDB (LinerDB v1.3)
 * Proporciona persistencia de conversaciones, índice de metadatos, colecciones,
 * transferencias y trabajos. Incluye fallback en memoria para entornos Node / Test.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const dbModule = factory();
    module.exports = dbModule;
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || {};
    const dbModule = factory();
    root.Liner.LinerDB = dbModule.LinerDB;
    root.Liner.LossyDB = dbModule.LossyDB;
    root.Liner.defaultDB = dbModule.defaultDB;
    root.Lossy.LinerDB = dbModule.LinerDB;
    root.Lossy.LossyDB = dbModule.LossyDB;
    root.Lossy.defaultDB = dbModule.defaultDB;
    root.LinerDB = dbModule.LinerDB; // Atajo global para scripts del workspace
    root.LossyDB = dbModule.LossyDB;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_NAME = 'LinerContextWorkbenchDB';
  const DB_VERSION = 1;
  const WIPE_EPOCH_KEY = '__lossy_wipe_epoch__';
  const IDB_SHARED_WIPE_STATES = new WeakMap();
  function getSharedWipeState(idbRef) {
    if (!idbRef || typeof idbRef !== 'object') return null;
    let st = IDB_SHARED_WIPE_STATES.get(idbRef);
    if (!st) {
      st = { epoch: 0, clearing: 0, idbEpoch: 0, tokens: new Set() };
      IDB_SHARED_WIPE_STATES.set(idbRef, st);
    }
    return st;
  }

  function retainLocalCapture(incoming, existing) {
    if (!existing || existing.canonicalId !== incoming.canonicalId) return incoming;
    const existingPlat = String(existing.source?.platform || '').toLowerCase();
    const incomingPlat = String(incoming.source?.platform || '').toLowerCase();
    if (existingPlat && incomingPlat && existingPlat !== 'unknown' && incomingPlat !== 'unknown' && existingPlat !== incomingPlat) {
      return existing;
    }
    const isCompleteStatus = s => ['captured', 'harvested', 'complete'].includes(String(s || '').toLowerCase());
    const isPartialStatus = s => ['partial', 'uncaptured'].includes(String(s || '').toLowerCase());
    const existingMsgs = Array.isArray(existing.messages) ? existing.messages : [];
    const incomingMsgs = Array.isArray(incoming.messages) ? incoming.messages : [];
    const existingCount = existingMsgs.length;
    const incomingCount = incomingMsgs.length;
    if (!incoming.forceOverwrite && existingCount > 0) {
      if (incomingCount === 0) {
        return { ...existing, title: incoming.title || existing.title, updatedAt: incoming.updatedAt || existing.updatedAt };
      }
      if (isCompleteStatus(existing.integrity?.status) && isPartialStatus(incoming.integrity?.status)) {
        return { ...existing, title: incoming.title || existing.title, updatedAt: incoming.updatedAt || existing.updatedAt };
      }
    }
    const stableFileId = asset => {
      for (const value of [asset.fileId, asset.assetPointer, asset.id, asset.assetId]) {
        if (typeof value !== 'string') continue;
        const clean = value.replace(/^(?:sediment|file-service):\/\//, '');
        if (/^file[_-][\w-]+$/.test(clean)) return clean;
      }
      return '';
    };
    const getUrl = a => (typeof a?.sourceURL === 'string' && a.sourceURL) || (typeof a?.url === 'string' && a.url) || '';
    const fileIdentity = asset => {
      const fid = stableFileId(asset);
      if (fid) return 'fid:' + fid;
      const u = getUrl(asset);
      if (u && /^https?:\/\//i.test(u)) return 'url:' + u;
      for (const value of [asset.id, asset.assetId]) {
        if (typeof value === 'string' && /^att[_-][\w-]+$/.test(value)) return 'att:' + value;
      }
      return '';
    };
    const hasBinary = a => Boolean(a && (a.dataURI || a.data || a.blob));
    const hydrate = (assets, previous, preserveOmitted) => {
      const prevList = (previous || []).filter(Boolean);
      const known = new Map(prevList.filter(hasBinary).map(a => [fileIdentity(a), a]).filter(([key]) => key));
      const matchedPrevIds = new Set();
      const hydrated = (assets || []).map(asset => {
        const key = fileIdentity(asset);
        const old = known.get(key);
        if (old) matchedPrevIds.add(key);
        if (!old || hasBinary(asset)) return asset;
        const oldUrl = getUrl(old), newUrl = getUrl(asset);
        if (!key.startsWith('fid:') && oldUrl && newUrl && oldUrl !== newUrl) return asset;
        const restored = { ...asset };
        for (const k of ['dataURI', 'data', 'blob', 'mimeType', 'width', 'height']) if (old[k]) restored[k] = old[k];
        restored.availability = 'embedded';
        restored.downloadable = true;
        return restored;
      });
      if (preserveOmitted && prevList.length > 0) {
        const presentKeys = new Set(hydrated.map(a => fileIdentity(a) || a.id || a.assetId || a.filename).filter(Boolean));
        for (const prev of prevList) {
          if (!hasBinary(prev)) continue;
          const pk = fileIdentity(prev) || prev.id || prev.assetId || prev.filename;
          if (pk && (matchedPrevIds.has(pk) || presentKeys.has(pk))) continue;
          if (pk) presentKeys.add(pk);
          hydrated.push(prev);
        }
      }
      return hydrated;
    };
    const mergeMonotonicCodeBlocks = (oldBlocks, newBlocks) => {
      const a = Array.isArray(oldBlocks) ? oldBlocks : [];
      const b = Array.isArray(newBlocks) ? newBlocks : [];
      if (!a.length) return b.slice();
      if (!b.length) return a.slice();
      const result = a.slice();
      const matchedOld = new Set();
      const matchedNew = new Set();
      const enrichLang = (picked, prev, next) => {
        const bestLang = (typeof picked?.language === 'string' && picked.language)
          || (typeof next?.language === 'string' && next.language)
          || (typeof prev?.language === 'string' && prev.language)
          || '';
        return bestLang && picked?.language !== bestLang ? { ...picked, language: bestLang } : picked;
      };
      // Pass 1: exact matches across the entire array first (preferring matching language)
      for (let j = 0; j < b.length; j++) {
        const nextCode = typeof b[j]?.code === 'string' ? b[j].code : '';
        const nextLang = typeof b[j]?.language === 'string' ? b[j].language : '';
        let exactIdx = -1;
        for (let i = 0; i < a.length; i++) {
          if (matchedOld.has(i)) continue;
          const prevCode = typeof a[i]?.code === 'string' ? a[i].code : '';
          if (prevCode !== nextCode) continue;
          const prevLang = typeof a[i]?.language === 'string' ? a[i].language : '';
          if (prevLang === nextLang) { exactIdx = i; break; }
          if (exactIdx === -1) exactIdx = i;
        }
        if (exactIdx !== -1) {
          matchedOld.add(exactIdx);
          matchedNew.add(j);
          result[exactIdx] = enrichLang(a[exactIdx], a[exactIdx], b[j]);
        }
      }
      // Pass 2: strictly 1-to-1 unambiguous containment/prefix matches
      const edgesByNew = new Map();
      const degOld = new Map();
      for (let j = 0; j < b.length; j++) {
        if (matchedNew.has(j)) continue;
        const nextCode = typeof b[j]?.code === 'string' ? b[j].code : '';
        const nextLang = typeof b[j]?.language === 'string' ? b[j].language : '';
        if (!nextCode.length) continue;
        const cands = [];
        for (let i = 0; i < a.length; i++) {
          if (matchedOld.has(i)) continue;
          const prevCode = typeof a[i]?.code === 'string' ? a[i].code : '';
          const prevLang = typeof a[i]?.language === 'string' ? a[i].language : '';
          if (prevLang && nextLang && prevLang !== nextLang) continue;
          if (prevCode.length > 0 && (prevCode.includes(nextCode) || nextCode.includes(prevCode))) {
            cands.push(i);
            degOld.set(i, (degOld.get(i) || 0) + 1);
          }
        }
        edgesByNew.set(j, cands);
      }
      const unmatchedNew = [];
      for (let j = 0; j < b.length; j++) {
        if (matchedNew.has(j)) continue;
        const cands = edgesByNew.get(j) || [];
        const nextCode = typeof b[j]?.code === 'string' ? b[j].code : '';
        if (cands.length === 1 && degOld.get(cands[0]) === 1) {
          const idx = cands[0];
          matchedOld.add(idx);
          matchedNew.add(j);
          const prevCode = typeof a[idx]?.code === 'string' ? a[idx].code : '';
          result[idx] = enrichLang(prevCode.length >= nextCode.length ? a[idx] : b[j], a[idx], b[j]);
        } else if (cands.length > 0 && cands.every(i => (typeof a[i]?.code === 'string' ? a[i].code : '').length > nextCode.length)) {
          // Shorter ambiguous fragment already contained in multiple fuller persisted blocks: keep fuller blocks without duplicating stub
          continue;
        } else {
          // Distinct or genuinely longer block without unambiguous target: preserve existing and append
          unmatchedNew.push(b[j]);
        }
      }
      return result.concat(unmatchedNew);
    };
    const msgTextOf = m => (typeof m?.text === 'string' ? m.text : (typeof m?.content?.text === 'string' ? m.content.text : ''));
    const mergeSingleMsg = (old, message) => {
      if (!old || (old.role && message.role && old.role !== message.role)) return message;
      const previous = [...(old.attachments || []), ...(old.content?.attachments || [])];
      const preserveOmitted = !incoming.forceOverwrite;
      const mergedAtts = hydrate(message.attachments, previous, preserveOmitted);
      const mergedContentAtts = message.content?.attachments !== undefined
        ? hydrate(message.content.attachments, previous, preserveOmitted)
        : undefined;
      const mergedMsg = {
        ...message,
        attachments: mergedAtts,
        ...(message.content ? { content: { ...message.content, ...(mergedContentAtts !== undefined ? { attachments: mergedContentAtts } : {}) } } : {})
      };
      if (!incoming.forceOverwrite) {
        const oldText = msgTextOf(old);
        const newText = msgTextOf(message);
        if (oldText.length > newText.length) {
          if (typeof old.text === 'string' || typeof mergedMsg.text === 'string') mergedMsg.text = oldText;
          if (old.content?.text !== undefined || mergedMsg.content?.text !== undefined) {
            mergedMsg.content = { ...(mergedMsg.content || {}), text: oldText };
          }
        }
        if (Array.isArray(old.codeBlocks) && old.codeBlocks.length > 0) {
          mergedMsg.codeBlocks = mergeMonotonicCodeBlocks(old.codeBlocks, message.codeBlocks);
        }
        if (Array.isArray(old.content?.codeBlocks) && old.content.codeBlocks.length > 0) {
          mergedMsg.content = {
            ...(mergedMsg.content || {}),
            codeBlocks: mergeMonotonicCodeBlocks(old.content.codeBlocks, message.content?.codeBlocks)
          };
        }
      }
      return mergedMsg;
    };

    const oldById = new Map(existingMsgs.filter(m => m && m.id).map(m => [m.id, m]));
    let messages;
    if (!incoming.forceOverwrite && existingCount > 0) {
      const existingIndexById = new Map();
      existingMsgs.forEach((m, i) => {
        if (m && m.id && !existingIndexById.has(m.id)) existingIndexById.set(m.id, i);
      });
      const overlaps = [];
      incomingMsgs.forEach((inc, incIdx) => {
        if (!inc || !inc.id || !existingIndexById.has(inc.id)) return;
        const oldIdx = existingIndexById.get(inc.id);
        const old = existingMsgs[oldIdx];
        if (!old.role || !inc.role || old.role === inc.role) {
          overlaps.push({ incIdx, oldIdx });
        }
      });
      const incomingIds = new Set(incomingMsgs.filter(m => m && m.id).map(m => m.id));
      const missingOld = existingMsgs.filter(m => m && m.id && !incomingIds.has(m.id));
      const hasOverlap = overlaps.length > 0;
      const isAuthoritativeUpgrade = !hasOverlap && incomingCount > existingCount && !isCompleteStatus(existing.integrity?.status);
      if (missingOld.length > 0 && !isAuthoritativeUpgrade) {
        // Anchor-preserving chronological merge: preserves prior messages, merges overlaps, places leading/middle/trailing incoming messages in order
        const mergedExisting = existingMsgs.slice();
        const overlapByIncIdx = new Map(overlaps.map(o => [o.incIdx, o.oldIdx]));
        const insertedBefore = new Map();
        const trailing = [];
        for (let incIdx = 0; incIdx < incomingMsgs.length; incIdx++) {
          const inc = incomingMsgs[incIdx];
          if (overlapByIncIdx.has(incIdx)) {
            const oldIdx = overlapByIncIdx.get(incIdx);
            mergedExisting[oldIdx] = mergeSingleMsg(existingMsgs[oldIdx], inc);
          } else {
            const nextOv = overlaps.find(o => o.incIdx > incIdx);
            if (nextOv) {
              if (!insertedBefore.has(nextOv.oldIdx)) insertedBefore.set(nextOv.oldIdx, []);
              insertedBefore.get(nextOv.oldIdx).push(inc);
            } else {
              trailing.push(inc);
            }
          }
        }
        const out = [];
        for (let oldIdx = 0; oldIdx < mergedExisting.length; oldIdx++) {
          const before = insertedBefore.get(oldIdx);
          if (before) out.push(...before);
          out.push(mergedExisting[oldIdx]);
        }
        if (trailing.length) {
          if (overlaps.length === 0) {
            const parseTs = m => {
              const raw = m?.createdAt ?? m?.timestamp;
              if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
              if (typeof raw === 'string' && raw.trim()) {
                const t = Date.parse(raw);
                if (Number.isFinite(t)) return t;
              }
              return NaN;
            };
            const oldTimes = out.map(parseTs);
            const newTimes = trailing.map(parseTs);
            if (oldTimes.every(Number.isFinite) && newTimes.every(Number.isFinite)) {
              const tagged = [
                ...out.map((m, i) => ({ m, ts: oldTimes[i], src: 0, i })),
                ...trailing.map((m, i) => ({ m, ts: newTimes[i], src: 1, i }))
              ];
              tagged.sort((x, y) => (x.ts - y.ts) || (x.src - y.src) || (x.i - y.i));
              messages = tagged.map(t => t.m);
            } else {
              out.push(...trailing);
              messages = out;
            }
          } else {
            out.push(...trailing);
            messages = out;
          }
        } else {
          messages = out;
        }
      } else {
        messages = incomingMsgs.map(message => mergeSingleMsg(oldById.get(message?.id), message));
      }
    } else {
      messages = incomingMsgs.map(message => mergeSingleMsg(oldById.get(message?.id), message));
    }
    return { ...incoming, messages, attachments: hydrate(incoming.attachments, existing.attachments || [], !incoming.forceOverwrite) };
  }

  class LinerDB {
    constructor(indexedDBRef = null) {
      this.indexedDB = indexedDBRef || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      this.db = null;
      this.opening = null;
      this.useMemoryFallback = !this.indexedDB;
      this._wipeEpoch = 0;
      this._remoteWipeEpoch = 0;
      this._knownIdbWipeEpoch = 0;
      this._clearing = null;
      this._seenWipeTokens = new Set();
      this._wipeChannel = null;
      if (typeof BroadcastChannel !== 'undefined' && !this.useMemoryFallback) {
        try {
          this._wipeChannel = new BroadcastChannel('lossy_db_wipe_epoch_v1');
          if (typeof this._wipeChannel.unref === 'function') this._wipeChannel.unref();
          this._wipeChannel.onmessage = (ev) => {
            const msg = ev && ev.data;
            if (!msg || typeof msg !== 'object') return;
            const shared = getSharedWipeState(this.indexedDB);
            const knownSameRealm = Boolean(msg.wipeToken && shared?.tokens?.has(msg.wipeToken));
            if (msg.type === 'CLEAR_START') {
              if (!knownSameRealm && msg.wipeToken && !this._seenWipeTokens.has(msg.wipeToken)) {
                this._seenWipeTokens.add(msg.wipeToken);
                this._remoteWipeEpoch++;
              }
            } else if (msg.type === 'CLEAR_DONE') {
              if (!knownSameRealm && msg.wipeToken && !this._seenWipeTokens.has(msg.wipeToken)) {
                this._seenWipeTokens.add(msg.wipeToken);
                this._remoteWipeEpoch++;
              }
              if (Number.isInteger(msg.idbEpoch) && msg.idbEpoch > this._knownIdbWipeEpoch) {
                this._knownIdbWipeEpoch = msg.idbEpoch;
              }
            }
          };
        } catch (_) {}
      }

      // Almacenes en memoria para entornos de test en Node
      this.memoryStores = {
        conversations: new Map(),
        metadata_index: new Map(),
        collections: new Map(),
        transfers: new Map(),
        jobs: new Map(),
        diagnostics: []
      };
    }

    getWipeEpoch() {
      const shared = this.useMemoryFallback ? null : getSharedWipeState(this.indexedDB);
      return this._wipeEpoch + this._remoteWipeEpoch + (shared ? shared.epoch : 0);
    }

    _resolveBaselineIdbEpoch() {
      const shared = this.useMemoryFallback ? null : getSharedWipeState(this.indexedDB);
      return Math.max(this._knownIdbWipeEpoch, shared ? (shared.idbEpoch || 0) : 0);
    }

    _resolveWriteEpoch(options) {
      return (options && Number.isInteger(options.expectedWipeEpoch)) ? options.expectedWipeEpoch : this.getWipeEpoch();
    }

    _assertWriteEpoch(expectedEpoch) {
      const shared = this.useMemoryFallback ? null : getSharedWipeState(this.indexedDB);
      if (this._clearing || (shared && shared.clearing > 0) || this.getWipeEpoch() !== expectedEpoch) {
        const err = new Error('WRITE_ABORTED_BY_CLEAR_ALL');
        err.code = 'WRITE_ABORTED_BY_CLEAR_ALL';
        throw err;
      }
    }

    _hasDiagStore() {
      return Boolean(this.db && this.db.objectStoreNames && typeof this.db.objectStoreNames.contains === 'function' && this.db.objectStoreNames.contains('diagnostics'));
    }

    _runGuardedTx(storeNames, writeEpoch, baselineIdbEpoch, execInTx, resolveValue) {
      return new Promise((resolve, reject) => {
        try { this._assertWriteEpoch(writeEpoch); } catch (e) { reject(e); return; }
        const useDiag = this._hasDiagStore();
        const txStores = useDiag && !storeNames.includes('diagnostics') ? [...storeNames, 'diagnostics'] : storeNames;
        const tx = this.db.transaction(txStores, 'readwrite');
        let settled = false;
        let resultVal;
        const failAbort = (err) => {
          if (settled) return;
          settled = true;
          try { tx.abort(); } catch (_) {}
          reject(err);
        };
        tx.oncomplete = () => {
          if (settled) return;
          if (this.getWipeEpoch() !== writeEpoch) reject(new Error('WRITE_ABORTED_BY_CLEAR_ALL'));
          else resolve(typeof resolveValue === 'function' ? resolveValue(resultVal) : resolveValue);
        };
        tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || new Error('Error de almacenamiento')); } };
        tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || new Error('Transacción abortada')); } };

        const proceed = () => {
          try {
            this._assertWriteEpoch(writeEpoch);
            execInTx(tx, v => { resultVal = v; }, failAbort);
          } catch (err) {
            failAbort(err);
          }
        };

        if (useDiag) {
          try {
            const diagReq = tx.objectStore('diagnostics').get(WIPE_EPOCH_KEY);
            diagReq.onsuccess = () => {
              const persisted = Number(diagReq.result?.epoch || 0);
              if (persisted > baselineIdbEpoch) {
                failAbort(new Error('WRITE_ABORTED_BY_CLEAR_ALL'));
                return;
              }
              proceed();
            };
            diagReq.onerror = () => proceed();
          } catch (_) {
            proceed();
          }
        } else {
          proceed();
        }
      });
    }

    async open() {
      if (this.useMemoryFallback) {
        if(!(typeof process!=='undefined' && process.versions?.node))throw new Error('Almacenamiento persistente no disponible');
        return this;
      }

      if (this.db) {
        return this;
      }

      if(this.opening)return this.opening;
      this.opening=new Promise((resolve,reject)=>{
        const request=this.indexedDB.open(DB_NAME,DB_VERSION);
        let settled=false;
        request.onblocked=()=>{settled=true;reject(new Error('Almacenamiento bloqueado por otra conexión'));};

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 1. Almacén de conversaciones completas
          if (!db.objectStoreNames.contains('conversations')) {
            db.createObjectStore('conversations', { keyPath: 'canonicalId' });
          }

          // 2. Índice de metadatos ligeros y búsqueda
          if (!db.objectStoreNames.contains('metadata_index')) {
            const metaStore = db.createObjectStore('metadata_index', { keyPath: 'canonicalId' });
            metaStore.createIndex('title', 'title', { unique: false });
            metaStore.createIndex('platform', 'platform', { unique: false });
            metaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            metaStore.createIndex('integrityStatus', 'integrityStatus', { unique: false });
          }

          // 3. Colecciones de contexto
          if (!db.objectStoreNames.contains('collections')) {
            const collStore = db.createObjectStore('collections', { keyPath: 'collectionId' });
            collStore.createIndex('name', 'name', { unique: false });
          }

          // 4. Paquetes de transferencia y recibos
          if (!db.objectStoreNames.contains('transfers')) {
            db.createObjectStore('transfers', { keyPath: 'transferId' });
          }

          // 5. Trabajos en segundo plano
          if (!db.objectStoreNames.contains('jobs')) {
            db.createObjectStore('jobs', { keyPath: 'jobId' });
          }

          // 6. Diagnósticos locales
          if (!db.objectStoreNames.contains('diagnostics')) {
            db.createObjectStore('diagnostics', { keyPath: 'id', autoIncrement: true });
          }
        };

        request.onsuccess = (event) => {
          const connection=event.target.result;
          if(settled){connection.close();return;}
          settled=true;this.db=connection;
          connection.onversionchange=()=>{connection.close();if(this.db===connection)this.db=null;};
          if (connection.objectStoreNames && typeof connection.objectStoreNames.contains === 'function' && connection.objectStoreNames.contains('diagnostics')) {
            try {
              const tx = connection.transaction(['diagnostics'], 'readonly');
              const req = tx.objectStore('diagnostics').get(WIPE_EPOCH_KEY);
              req.onsuccess = () => {
                const persisted = Number(req.result?.epoch || 0);
                if (persisted > this._knownIdbWipeEpoch) this._knownIdbWipeEpoch = persisted;
                resolve(this);
              };
              req.onerror = () => resolve(this);
              return;
            } catch (_) {}
          }
          resolve(this);
        };

        request.onerror = () => {
          settled=true;
          reject(request.error||new Error('No se pudo abrir el almacenamiento persistente'));
        };
      });
      try{return await this.opening;}finally{this.opening=null;}
    }

    /**
     * Guarda o actualiza una conversación canónica completa y actualiza el índice.
     */
    async saveConversation(conv, options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      if (!conv || !conv.canonicalId) {
        throw new Error('Conversación inválida: canonicalId es requerido');
      }

      const prepare = existing => {
        this._assertWriteEpoch(writeEpoch);
        const merged = retainLocalCapture(conv, existing);
        return this.conversationRecords(merged);
      };
      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        const { record, meta } = prepare(this.memoryStores.conversations.get(conv.canonicalId));
        this._assertWriteEpoch(writeEpoch);
        this.memoryStores.conversations.set(record.canonicalId, structuredClone(record));
        this.memoryStores.metadata_index.set(record.canonicalId, meta);
        return record.canonicalId;
      }
      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['conversations', 'metadata_index'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult, failAbort) => {
          const store = tx.objectStore('conversations');
          const request = store.get(conv.canonicalId);
          request.onsuccess = () => {
            try {
              this._assertWriteEpoch(writeEpoch);
              const { record, meta } = prepare(request.result);
              store.put(record);
              tx.objectStore('metadata_index').put(meta);
              setResult(conv.canonicalId);
            } catch (error) {
              failAbort(error);
            }
          };
        }
      );
    }

    conversationRecords(conv) {
      const canonicalId = conv.canonicalId;
      const allText = (conv.messages || []).map(m => m.content?.text || '').join(' ');

      const rawMsgList = conv.messages || [];
      const conversationalFromMessages = rawMsgList.filter(m => {
        if (typeof m.isConversational === 'boolean') return m.isConversational;
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        const textVal = typeof m.text === 'string' ? m.text : (m.content?.text || '');
        const hasText = Boolean(textVal && textVal.trim().length > 0);
        const hasCode = Boolean((Array.isArray(m.content?.codeBlocks) && m.content.codeBlocks.length > 0) || (Array.isArray(m.codeBlocks) && m.codeBlocks.length > 0));
        return hasText || hasCode;
      }).length;

      let conversationMessageCount;
      if (Array.isArray(conv.messages) && conv.messages.length > 0) {
        if (typeof conv.conversationMessageCount === 'number' && conv.conversationMessageCount === conversationalFromMessages) {
          conversationMessageCount = conv.conversationMessageCount;
        } else {
          conversationMessageCount = conversationalFromMessages > 0 ? conversationalFromMessages : rawMsgList.length;
        }
      } else if (typeof conv.conversationMessageCount === 'number') {
        conversationMessageCount = conv.conversationMessageCount;
      } else if (typeof conv.visibleMessageCount === 'number') {
        conversationMessageCount = conv.visibleMessageCount;
      } else if (conv.integrity && typeof conv.integrity.messageCount === 'number') {
        conversationMessageCount = conv.integrity.messageCount;
      } else {
        conversationMessageCount = rawMsgList.length;
      }

      const visibleMessageCount = conversationMessageCount;
      const sourceNodeCount = typeof conv.sourceNodeCount === 'number' && conv.sourceNodeCount >= rawMsgList.length
        ? conv.sourceNodeCount
        : rawMsgList.length;

      const metaRecord = {
        canonicalId,
        id: canonicalId,
        entityType: conv.entityType || 'conversation',
        title: conv.title || 'Sin Título',
        platform: conv.source?.platform || 'unknown',
        model: conv.model || null,
        messageCount: conversationMessageCount,
        conversationMessageCount,
        visibleMessageCount,
        sourceNodeCount,
        nodeMetrics: conv.nodeMetrics || {
          sourceNodeCount,
          conversationMessageCount,
          visibleMessageCount,
          userMessageCount: (conv.messages || []).filter(m => m.role === 'user').length,
          assistantMessageCount: (conv.messages || []).filter(m => m.role === 'assistant').length,
          toolEventCount: (conv.messages || []).filter(m => m.role === 'tool').length,
          systemNodeCount: (conv.messages || []).filter(m => m.role === 'system').length,
          otherNodeCount: (conv.messages || []).filter(m => !['user', 'assistant', 'tool', 'system'].includes(m.role)).length
        },
        ...(conv.migration&&Object.hasOwn(conv.migration,'date')?{archiveDate:conv.migration.date}:{}),
        createdAt: conv.createdAt || new Date().toISOString(),
        updatedAt: conv.updatedAt || new Date().toISOString(),
        integrityStatus: conv.integrity?.status || 'captured',
        acquisitionMethod: conv.source?.acquisitionMethod || 'unknown',
        attachmentCount: conv.attachments?.length || 0,
        hasBranches: Boolean(conv.branches),
        searchText: `${conv.title || ''} ${allText}`.toLowerCase()
      };
      return { record: conv, meta: metaRecord };
    }

    /**
     * Guarda o actualiza un clip canónico y actualiza el índice de metadatos.
     */
    async saveClip(clip, options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      if (!clip || (!clip.canonicalId && !clip.id)) {
        throw new Error('Clip inválido: canonicalId o id es requerido');
      }

      const canonicalId = clip.canonicalId || clip.id;
      clip.canonicalId = canonicalId;
      clip.id = canonicalId;
      clip.entityType = 'clip';

      const allText = (clip.selectedMessages || []).map(m => m.content?.text || m.text || '').join(' ');
      const msgCount = clip.selectedMessages?.length || 0;
      const metaRecord = {
        canonicalId,
        id: canonicalId,
        entityType: 'clip',
        title: clip.title || 'Clip sin Título',
        platform: clip.sourcePlatform || clip.source?.platform || 'unknown',
        model: clip.model || clip.sourceModel || null,
        messageCount: msgCount,
        conversationMessageCount: msgCount,
        visibleMessageCount: clip.visibleMessageCount || msgCount,
        sourceNodeCount: clip.sourceNodeCount || msgCount,
        createdAt: clip.createdAt || new Date().toISOString(),
        updatedAt: clip.updatedAt || new Date().toISOString(),
        integrityStatus: clip.integrity?.clipSelectionIntegrity || 'complete',
        sourceStatus: clip.provenance?.sourceStatus || clip.sourceStatus || 'source_available_locally',
        sourceConversationCanonicalId: clip.sourceConversationCanonicalId || clip.provenance?.sourceConversationCanonicalId || null,
        sourceConversationTitle: clip.sourceConversationTitle || clip.provenance?.sourceConversation || 'Conversación Origen',
        selectionType: clip.selectionType || 'multi-message',
        searchText: `${clip.title || ''} ${allText}`.toLowerCase()
      };

      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        this.memoryStores.conversations.set(canonicalId, JSON.parse(JSON.stringify(clip)));
        this.memoryStores.metadata_index.set(canonicalId, metaRecord);
        return canonicalId;
      }

      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['conversations', 'metadata_index'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult) => {
          tx.objectStore('conversations').put(clip);
          tx.objectStore('metadata_index').put(metaRecord);
          setResult(canonicalId);
        }
      );
    }

    /**
     * Obtiene un clip canónico por su ID.
     */
    async getClip(clipId) {
      if (!clipId) return null;
      const item = await this.getConversation(clipId);
      if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')) || (typeof item.id === 'string' && item.id.startsWith('clip_')))) {
        return item;
      }
      return null;
    }

    /**
     * Lista todos los clips almacenados en el índice de metadatos.
     */
    async listClips() {
      const allMeta = await this.listMetadata();
      return allMeta.filter(m => m.entityType === 'clip' || (typeof m.canonicalId === 'string' && m.canonicalId.startsWith('clip_')));
    }

    /**
     * Elimina un clip canónico de la base de datos local y limpia sus referencias.
     */
    async deleteClip(clipId) {
      return this.deleteConversation(clipId);
    }

    /**
     * Obtiene una conversación o clip completo por su ID canónico o alternativo.
     */
    async getConversation(canonicalId) {
      await this.open();
      if (!canonicalId) return null;
      if (this.useMemoryFallback) {
        let item = this.memoryStores.conversations.get(canonicalId);
        if (!item) {
          for (const val of this.memoryStores.conversations.values()) {
            if (val && (val.canonicalId === canonicalId || val.id === canonicalId)) {
              item = val;
              break;
            }
          }
        }
        return item ? JSON.parse(JSON.stringify(item)) : null;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['conversations'], 'readonly');
        const req = tx.objectStore('conversations').get(canonicalId);
        req.onsuccess = () => {
          if (req.result) {
            resolve(req.result);
          } else {
            // Fallback por cursor en caso de discrepancia de clave
            const cursorReq = tx.objectStore('conversations').openCursor();
            cursorReq.onsuccess = (ev) => {
              const cursor = ev.target.result;
              if (cursor) {
                const val = cursor.value;
                if (val && (val.canonicalId === canonicalId || val.id === canonicalId)) {
                  resolve(val);
                  return;
                }
                cursor.continue();
              } else {
                resolve(null);
              }
            };
            cursorReq.onerror = () => resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    }

    /**
     * Lista todos los registros del índice de metadatos.
     */
    async listMetadata() {
      await this.open();
      if (this.useMemoryFallback) {
        return Array.from(this.memoryStores.metadata_index.values())
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['metadata_index'], 'readonly');
        const req = tx.objectStore('metadata_index').getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    }

    /**
     * Búsqueda local de texto completo y por filtros.
     */
    async search(query = '', filters = {}) {
      const list = await this.listMetadata();
      const q = query.trim().toLowerCase();
      const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

      return list.filter(item => {
        if (filters.platform && item.platform !== filters.platform) return false;
        if (filters.integrityStatus && item.integrityStatus !== filters.integrityStatus) return false;
        if (filters.model && item.model !== filters.model) return false;

        if (tokens.length > 0) {
          const text = item.searchText || `${item.title} ${item.platform}`.toLowerCase();
          for (const token of tokens) {
            if (!text.includes(token)) return false;
          }
        }

        return true;
      });
    }

    /**
     * Elimina una conversación de la biblioteca local y limpia sus referencias en colecciones.
     * Preserva los clips creados a partir de la conversación, actualizando su sourceStatus a 'source_unavailable_locally'.
     */
    async deleteConversation(canonicalId) {
      await this.open();
      if (this.useMemoryFallback) {
        const deleted = this.memoryStores.conversations.delete(canonicalId);
        this.memoryStores.metadata_index.delete(canonicalId);

        // Actualizar procedencia de clips asociados a esta conversación:
        // El clip NO se elimina, pero su sourceStatus pasa a 'source_unavailable_locally'
        for (const [, item] of this.memoryStores.conversations.entries()) {
          if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
            const matchesSource = item.sourceConversationCanonicalId === canonicalId ||
                                  (item.provenance && item.provenance.sourceConversationCanonicalId === canonicalId) ||
                                  (item.sourceConversationId && canonicalId.includes(item.sourceConversationId));
            if (matchesSource) {
              item.provenance = item.provenance || {};
              item.provenance.sourceStatus = 'source_unavailable_locally';
              item.sourceStatus = 'source_unavailable_locally';
              const meta = this.memoryStores.metadata_index.get(item.canonicalId);
              if (meta) {
                meta.sourceStatus = 'source_unavailable_locally';
              }
            }
          }
        }

        for (const [, col] of this.memoryStores.collections.entries()) {
          if (Array.isArray(col.conversationIds) && col.conversationIds.includes(canonicalId)) {
            col.conversationIds = col.conversationIds.filter(id => id !== canonicalId);
            if(col.organization?.folders){const members=new Set(col.conversationIds);for(const folder of col.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
            col.updatedAt = new Date().toISOString();
          }
        }
        return deleted;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['conversations', 'metadata_index', 'collections'], 'readwrite');
        const convStore = tx.objectStore('conversations');
        const metaStore = tx.objectStore('metadata_index');

        convStore.delete(canonicalId);
        metaStore.delete(canonicalId);

        // Actualizar procedencia de clips asociados en IndexedDB
        const reqConv = convStore.openCursor();
        reqConv.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            const item = cursor.value;
            if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
              const matchesSource = item.sourceConversationCanonicalId === canonicalId ||
                                    (item.provenance && item.provenance.sourceConversationCanonicalId === canonicalId) ||
                                    (item.sourceConversationId && canonicalId.includes(item.sourceConversationId));
              if (matchesSource) {
                item.provenance = item.provenance || {};
                item.provenance.sourceStatus = 'source_unavailable_locally';
                item.sourceStatus = 'source_unavailable_locally';
                cursor.update(item);
                const reqM = metaStore.get(item.canonicalId);
                reqM.onsuccess = () => {
                  if (reqM.result) {
                    const m = reqM.result;
                    m.sourceStatus = 'source_unavailable_locally';
                    metaStore.put(m);
                  }
                };
              }
            }
            cursor.continue();
          }
        };

        const colStore = tx.objectStore('collections');
        const req = colStore.openCursor();
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const col = cursor.value;
            if (Array.isArray(col.conversationIds) && col.conversationIds.includes(canonicalId)) {
              col.conversationIds = col.conversationIds.filter(id => id !== canonicalId);
            if(col.organization?.folders){const members=new Set(col.conversationIds);for(const folder of col.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
              col.updatedAt = new Date().toISOString();
              cursor.update(col);
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
    }

    /**
     * Elimina múltiples conversaciones de la biblioteca local y limpia sus referencias en colecciones.
     * Preserva clips asociados actualizando su procedencia a 'source_unavailable_locally'.
     */
    async deleteConversations(canonicalIds = []) {
      await this.open();
      const idSet = new Set(canonicalIds);
      if (idSet.size === 0) return true;

      if (this.useMemoryFallback) {
        for (const id of idSet) {
          this.memoryStores.conversations.delete(id);
          this.memoryStores.metadata_index.delete(id);
        }

        for (const [, item] of this.memoryStores.conversations.entries()) {
          if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
            const matchesSource = idSet.has(item.sourceConversationCanonicalId) ||
                                  (item.provenance && idSet.has(item.provenance.sourceConversationCanonicalId)) ||
                                  (item.sourceConversationId && Array.from(idSet).some(id => id.includes(item.sourceConversationId)));
            if (matchesSource) {
              item.provenance = item.provenance || {};
              item.provenance.sourceStatus = 'source_unavailable_locally';
              item.sourceStatus = 'source_unavailable_locally';
              const meta = this.memoryStores.metadata_index.get(item.canonicalId);
              if (meta) {
                meta.sourceStatus = 'source_unavailable_locally';
              }
            }
          }
        }

        for (const [, col] of this.memoryStores.collections.entries()) {
          if (Array.isArray(col.conversationIds)) {
            const beforeLen = col.conversationIds.length;
            col.conversationIds = col.conversationIds.filter(id => !idSet.has(id));
            if(col.organization?.folders){const members=new Set(col.conversationIds);for(const folder of col.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
            if (col.conversationIds.length !== beforeLen) {
              col.updatedAt = new Date().toISOString();
            }
          }
        }
        return true;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['conversations', 'metadata_index', 'collections'], 'readwrite');
        const convStore = tx.objectStore('conversations');
        const metaStore = tx.objectStore('metadata_index');
        for (const id of idSet) {
          convStore.delete(id);
          metaStore.delete(id);
        }

        const reqConv = convStore.openCursor();
        reqConv.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            const item = cursor.value;
            if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
              const matchesSource = idSet.has(item.sourceConversationCanonicalId) ||
                                    (item.provenance && idSet.has(item.provenance.sourceConversationCanonicalId)) ||
                                    (item.sourceConversationId && Array.from(idSet).some(id => id.includes(item.sourceConversationId)));
              if (matchesSource) {
                item.provenance = item.provenance || {};
                item.provenance.sourceStatus = 'source_unavailable_locally';
                item.sourceStatus = 'source_unavailable_locally';
                cursor.update(item);
                const reqM = metaStore.get(item.canonicalId);
                reqM.onsuccess = () => {
                  if (reqM.result) {
                    const m = reqM.result;
                    m.sourceStatus = 'source_unavailable_locally';
                    metaStore.put(m);
                  }
                };
              }
            }
            cursor.continue();
          }
        };

        const colStore = tx.objectStore('collections');
        const req = colStore.openCursor();
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const col = cursor.value;
            if (Array.isArray(col.conversationIds)) {
              const beforeLen = col.conversationIds.length;
              col.conversationIds = col.conversationIds.filter(id => !idSet.has(id));
            if(col.organization?.folders){const members=new Set(col.conversationIds);for(const folder of col.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
              if (col.conversationIds.length !== beforeLen) {
                col.updatedAt = new Date().toISOString();
                cursor.update(col);
              }
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
    }

    /**
     * Restaura una conversación previamente eliminada (deshacer / undo) y sus membresías en colecciones.
     */
    async restoreConversation(conv, collectionIds = [], folderMemberships = null, options = {}) {
      if (!conv || !conv.canonicalId) return null;
      const writeEpoch = this._resolveWriteEpoch(options);
      this._assertWriteEpoch(writeEpoch);
      const isClip = conv.entityType === 'clip' || (typeof conv.canonicalId === 'string' && conv.canonicalId.startsWith('clip_'));
      if (isClip) {
        await this.saveClip(conv, { expectedWipeEpoch: writeEpoch });
      } else {
        await this.saveConversation(conv, { expectedWipeEpoch: writeEpoch });
      }
      this._assertWriteEpoch(writeEpoch);

      const folderMap = (folderMemberships && typeof folderMemberships === 'object') ? folderMemberships : {};
      if (Array.isArray(collectionIds) && collectionIds.length > 0) {
        for (const entry of collectionIds) {
          const colId = typeof entry === 'string' ? entry : entry?.collectionId;
          if (!colId) continue;
          const folderIds = Array.isArray(entry?.folderIds)
            ? entry.folderIds
            : (Array.isArray(folderMap[colId]) ? folderMap[colId] : []);
          try {
            await this.mutateCollection(colId, col => {
              col.conversationIds = Array.from(new Set([...(col.conversationIds || []), conv.canonicalId]));
              if (col.organization?.folders && folderIds.length > 0) {
                const folderById = new Map(col.organization.folders.map(f => [f.id, f]));
                const toRestore = new Set();
                for (const fid of folderIds) {
                  let cur = folderById.get(fid);
                  const guard = new Set();
                  while (cur && !guard.has(cur.id)) {
                    guard.add(cur.id);
                    toRestore.add(cur.id);
                    cur = cur.parentId ? folderById.get(cur.parentId) : null;
                  }
                }
                for (const folder of col.organization.folders) {
                  if (toRestore.has(folder.id) && !folder.conversationIds.includes(conv.canonicalId)) {
                    folder.conversationIds = [...folder.conversationIds, conv.canonicalId];
                  }
                }
              }
            });
          } catch (_) {}
        }
      }

      // Restaura el sourceStatus de clips asociados a 'source_available_locally'
      if (this.useMemoryFallback) {
        for (const [id, item] of this.memoryStores.conversations.entries()) {
          if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
            const matchesSource = item.sourceConversationCanonicalId === conv.canonicalId ||
                                  (item.provenance && item.provenance.sourceConversationCanonicalId === conv.canonicalId) ||
                                  (item.sourceConversationId && conv.canonicalId.replace(/^(conv_chatgpt_|conv_gemini_|conv_claude_|conv_lossy_)/,'')===item.sourceConversationId);
            if (matchesSource) {
              item.provenance = item.provenance || {};
              item.provenance.sourceStatus = 'source_available_locally';
              item.sourceStatus = 'source_available_locally';
              const meta = this.memoryStores.metadata_index.get(id);
              if (meta) {
                meta.sourceStatus = 'source_available_locally';
              }
            }
          }
        }
      } else {
        await new Promise((resolve,reject) => {
          const tx = this.db.transaction(['conversations', 'metadata_index'], 'readwrite');
          const convStore = tx.objectStore('conversations');
          const metaStore = tx.objectStore('metadata_index');
          const req = convStore.openCursor();
          req.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
              const item = cursor.value;
              if (item && (item.entityType === 'clip' || (typeof item.canonicalId === 'string' && item.canonicalId.startsWith('clip_')))) {
                const matchesSource = item.sourceConversationCanonicalId === conv.canonicalId ||
                                      (item.provenance && item.provenance.sourceConversationCanonicalId === conv.canonicalId) ||
                                      (item.sourceConversationId && conv.canonicalId.replace(/^(conv_chatgpt_|conv_gemini_|conv_claude_|conv_lossy_)/,'')===item.sourceConversationId);
                if (matchesSource) {
                  item.provenance = item.provenance || {};
                  item.provenance.sourceStatus = 'source_available_locally';
                  item.sourceStatus = 'source_available_locally';
                  cursor.update(item);
                  const reqM = metaStore.get(item.canonicalId);
                  reqM.onsuccess = () => {
                    if (reqM.result) {
                      const m = reqM.result;
                      m.sourceStatus = 'source_available_locally';
                      metaStore.put(m);
                    }
                  };
                }
              }
              cursor.continue();
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error||new Error('Error al restaurar los clips'));
          tx.onabort = () => reject(tx.error||new Error('Restauración abortada'));
        });
      }

      return conv.canonicalId;
    }

    // --- GESTIÓN DE COLECCIONES ---

    async createCollection(name, description = '', conversationIds = [], options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      const collectionId = `coll_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const collection = {
        collectionId,
        id: collectionId,
        name: name.trim(),
        description: description.trim(),
        conversationIds: Array.isArray(conversationIds) ? conversationIds : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        this.memoryStores.collections.set(collectionId, collection);
        return collection;
      }

      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['collections'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult) => {
          tx.objectStore('collections').put(collection);
          setResult(collection);
        }
      );
    }

    async mutateCollection(collectionId, transform, options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      const apply = existing => {
        this._assertWriteEpoch(writeEpoch);
        if (!existing) throw new Error('Proyecto no encontrado');
        const record = structuredClone(existing);
        transform(record);
        if(record.organization?.folders){const members=new Set(record.conversationIds);for(const folder of record.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
        record.updatedAt = new Date().toISOString();
        return record;
      };
      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        const record = apply(this.memoryStores.collections.get(collectionId));
        this.memoryStores.collections.set(collectionId, record);
        return structuredClone(record);
      }
      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['collections'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult, failAbort) => {
          const store = tx.objectStore('collections');
          const request = store.get(collectionId);
          request.onsuccess = () => {
            try {
              this._assertWriteEpoch(writeEpoch);
              const record = apply(request.result);
              store.put(record);
              setResult(record);
            } catch (error) {
              failAbort(error);
            }
          };
        }
      );
    }

    async saveProjectContext(collectionId, context, expectedRevision) {
      if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('Contexto de proyecto no válido');
      const clean = {};
      for (const [key, limit] of Object.entries({ goal:6000, decisions:12000, openQuestions:12000, nextStep:6000 })) {
        const value = context[key] ?? '';
        if (typeof value !== 'string' || value.length > limit) throw new Error('Campo de proyecto no válido: ' + key);
        clean[key] = value.trim();
      }
      clean.status = context.status || 'active';
      if (!['active','paused','completed'].includes(clean.status)) throw new Error('Estado de proyecto no válido');
      return this.mutateCollection(collectionId, record => {
        const revision = record.projectContext?.revision || 0;
        if (expectedRevision !== undefined && revision !== expectedRevision) { const error = new Error('El proyecto cambió en otra ventana. Recarga antes de reemplazar su contexto.'); error.code = 'PROJECT_CONFLICT'; throw error; }
        record.projectContext = { ...clean, revision:revision + 1, updatedAt:new Date().toISOString() };
      });
    }

    async restoreProject(plan, options = {}) {
      if (!plan?.project?.collectionId || !Array.isArray(plan.sources) || !plan.expectedSources || !Object.hasOwn(plan, 'expectedProject')) throw new Error('Plan de restauración inválido');
      await this.open();
      if(options.signal?.aborted)throw new Error('Importación cancelada');
      const projectId = plan.project.collectionId;
      const mismatch = () => { const error = new Error('Los datos locales cambiaron desde la vista previa. Vuelve a revisar la restauración.'); error.code = 'PROJECT_CONFLICT'; return error; };
      const check = (project, sources) => {
        if ((project ? JSON.stringify(project) : null) !== plan.expectedProject) throw mismatch();
        for (const [id, expected] of Object.entries(plan.expectedSources)) if ((sources.get(id) ? JSON.stringify(sources.get(id)) : null) !== expected) throw mismatch();
        for (const source of plan.sources) if (!source.canonicalId || !Object.hasOwn(plan.expectedSources, source.canonicalId) || sources.get(source.canonicalId)) throw new Error('La restauración no puede sobrescribir una fuente existente');
      };
      const records = plan.sources.map(source => {
        const clip = source.entityType === 'clip';
        const prepared = this.conversationRecords(clip ? { ...source, messages:source.selectedMessages, source:{...source.source, platform:source.sourcePlatform || source.source?.platform} } : source);
        return { record:source, meta:clip ? {...prepared.meta, entityType:'clip', sourceConversationCanonicalId:source.sourceConversationCanonicalId, sourceConversationTitle:source.sourceConversationTitle, selectionType:source.selectionType || 'multi-message'} : prepared.meta };
      });
      if (this.useMemoryFallback) {
        check(this.memoryStores.collections.get(projectId), this.memoryStores.conversations);
        const sources = new Map(this.memoryStores.conversations), metadata = new Map(this.memoryStores.metadata_index), projects = new Map(this.memoryStores.collections);
        for (const {record,meta} of records) { sources.set(record.canonicalId,structuredClone(record)); metadata.set(meta.canonicalId,structuredClone(meta)); }
        projects.set(projectId,structuredClone(plan.project));
        this.memoryStores.conversations=sources;this.memoryStores.metadata_index=metadata;this.memoryStores.collections=projects;
        return projectId;
      }
      return new Promise((resolve,reject) => {
        const tx=this.db.transaction(['collections','conversations','metadata_index'],'readwrite'),sources=new Map();let project,remaining=Object.keys(plan.expectedSources).length+1;
        let ended=false,completed=0;const cancel=()=>{if(!ended)tx.abort();};const finish=()=>{ended=true;options.signal?.removeEventListener('abort',cancel);};options.signal?.addEventListener('abort',cancel,{once:true});
        tx.oncomplete=()=>{finish();resolve(projectId);};tx.onerror=()=>{finish();reject(tx.error||new Error('No se pudo restaurar el proyecto'));};tx.onabort=()=>{finish();reject(tx.error||new Error('La restauración fue cancelada; no se guardaron cambios'));};
        const ready=()=>{ if (--remaining) return; try { check(project,sources); for(const {record,meta} of records){tx.objectStore('conversations').put(record);const write=tx.objectStore('metadata_index').put(meta);write.onsuccess=()=>options.onProgress?.(++completed,records.length);}tx.objectStore('collections').put(plan.project); } catch(error){tx.abort();reject(error);} };
        const request=tx.objectStore('collections').get(projectId);request.onsuccess=()=>{project=request.result;ready();};
        for(const id of Object.keys(plan.expectedSources)){const read=tx.objectStore('conversations').get(id);read.onsuccess=()=>{sources.set(id,read.result);ready();};}
      });
    }

    async listCollections() {
      await this.open();
      if (this.useMemoryFallback) {
        return Array.from(this.memoryStores.collections.values());
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['collections'], 'readonly');
        const req = tx.objectStore('collections').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    async getCollection(collectionId) {
      await this.open();
      if (this.useMemoryFallback) {
        return this.memoryStores.collections.get(collectionId) || null;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['collections'], 'readonly');
        const req = tx.objectStore('collections').get(collectionId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    /**
     * Agrega referencias de conversaciones a una colección existente (sin duplicar datos).
     */
    async addConversationsToCollection(collectionId, conversationIds = []) {
      return this.mutateCollection(collectionId, col => {
        col.conversationIds = Array.from(new Set([...(col.conversationIds || []), ...conversationIds.filter(Boolean)]));
      });
    }

    /**
     * Quita una referencia de conversación de una colección (NO elimina de la biblioteca).
     */
    async removeConversationFromCollection(collectionId, canonicalId) {
      return this.mutateCollection(collectionId, col => { col.conversationIds = (col.conversationIds || []).filter(id => id !== canonicalId); });
    }

    /**
     * Elimina una colección (estrictamente seguro: NO altera las conversaciones en la biblioteca).
     */
    async deleteCollection(collectionId) {
      await this.open();
      if (this.useMemoryFallback) {
        this.memoryStores.collections.delete(collectionId);
        return true;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['collections'], 'readwrite');
        tx.objectStore('collections').delete(collectionId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
    }

    /**
     * Renombra una colección y actualiza su descripción opcionalmente.
     */
    async renameCollection(collectionId, newName, newDescription = null) {
      return this.mutateCollection(collectionId, col => {
        if (typeof newName === 'string' && newName.trim()) col.name = newName.trim();
        if (typeof newDescription === 'string') col.description = newDescription.trim();
      });
    }

    /**
     * Retorna todas las colecciones que referencian a una conversación o clip específico.
     */
    async getCollectionsForConversation(canonicalId) {
      const all = await this.listCollections();
      return all.filter(c => Array.isArray(c.conversationIds) && c.conversationIds.includes(canonicalId));
    }

    async getCollectionsForItem(itemId) {
      return this.getCollectionsForConversation(itemId);
    }

    async addItemsToCollection(collectionId, itemIds = []) {
      return this.addConversationsToCollection(collectionId, itemIds);
    }

    async removeItemFromCollection(collectionId, itemId) {
      return this.removeConversationFromCollection(collectionId, itemId);
    }

    // --- GESTIÓN DE TRABAJOS (JOBS) ---

    async saveJob(job, options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      if (!job || !job.jobId) throw new Error('Trabajo inválido');

      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        this.memoryStores.jobs.set(job.jobId, JSON.parse(JSON.stringify(job)));
        return job.jobId;
      }

      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['jobs'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult) => {
          tx.objectStore('jobs').put(job);
          setResult(job.jobId);
        }
      );
    }

    async getJob(jobId) {
      await this.open();
      if (this.useMemoryFallback) {
        return this.memoryStores.jobs.get(jobId) || null;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['jobs'], 'readonly');
        const req = tx.objectStore('jobs').get(jobId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async listJobs() {
      await this.open();
      if (this.useMemoryFallback) {
        return Array.from(this.memoryStores.jobs.values())
          .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['jobs'], 'readonly');
        const req = tx.objectStore('jobs').getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    }

    // --- GESTIÓN DE TRANSFERENCIAS (TRANSFERS) ---

    async saveTransfer(transfer, options = {}) {
      const writeEpoch = this._resolveWriteEpoch(options);
      await this.open();
      this._assertWriteEpoch(writeEpoch);
      if (!transfer || !transfer.transferId) throw new Error('Transferencia inválida');

      if (this.useMemoryFallback) {
        this._assertWriteEpoch(writeEpoch);
        this.memoryStores.transfers.set(transfer.transferId, JSON.parse(JSON.stringify(transfer)));
        return transfer.transferId;
      }

      const baselineIdbEpoch = this._resolveBaselineIdbEpoch();
      return this._runGuardedTx(
        ['transfers'],
        writeEpoch,
        baselineIdbEpoch,
        (tx, setResult) => {
          tx.objectStore('transfers').put(transfer);
          setResult(transfer.transferId);
        }
      );
    }

    async listTransfers() {
      await this.open();
      if (this.useMemoryFallback) {
        return Array.from(this.memoryStores.transfers.values());
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['transfers'], 'readonly');
        const req = tx.objectStore('transfers').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    /**
     * Limpia completamente todos los almacenes de la base de datos local.
     */
    async clearAll() {
      this._wipeEpoch++;
      const wipeToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const shared = this.useMemoryFallback ? null : getSharedWipeState(this.indexedDB);
      if (shared) {
        shared.tokens.add(wipeToken);
        shared.epoch++;
        shared.clearing++;
      }
      if (this._wipeChannel) {
        try { this._wipeChannel.postMessage({ type: 'CLEAR_START', wipeToken, epoch: this.getWipeEpoch() }); } catch (_) {}
      }
      this.memoryStores.conversations.clear();
      this.memoryStores.metadata_index.clear();
      this.memoryStores.collections.clear();
      this.memoryStores.transfers.clear();
      this.memoryStores.jobs.clear();
      this.memoryStores.diagnostics = [];

      const runClear = async () => {
        await this.open();
        if (this.useMemoryFallback) {
          this.memoryStores.conversations.clear();
          this.memoryStores.metadata_index.clear();
          this.memoryStores.collections.clear();
          this.memoryStores.transfers.clear();
          this.memoryStores.jobs.clear();
          this.memoryStores.diagnostics = [];
          return true;
        }

        return new Promise((resolve, reject) => {
          const tx = this.db.transaction(['conversations', 'metadata_index', 'collections', 'transfers', 'jobs', 'diagnostics'], 'readwrite');
          const diagStore = tx.objectStore('diagnostics');
          let writtenEpoch = 0;
          const finishClear = (prevIdbEpoch) => {
            writtenEpoch = Math.max(prevIdbEpoch + 1, this.getWipeEpoch(), this._resolveBaselineIdbEpoch() + 1);
            tx.objectStore('conversations').clear();
            tx.objectStore('metadata_index').clear();
            tx.objectStore('collections').clear();
            tx.objectStore('transfers').clear();
            tx.objectStore('jobs').clear();
            diagStore.clear();
            diagStore.put({ id: WIPE_EPOCH_KEY, epoch: writtenEpoch });
          };
          const curReq = diagStore.get(WIPE_EPOCH_KEY);
          curReq.onsuccess = () => finishClear(Number(curReq.result?.epoch || 0));
          curReq.onerror = () => finishClear(this._resolveBaselineIdbEpoch());
          tx.oncomplete = () => {
            if (writtenEpoch > this._knownIdbWipeEpoch) this._knownIdbWipeEpoch = writtenEpoch;
            if (shared && writtenEpoch > (shared.idbEpoch || 0)) shared.idbEpoch = writtenEpoch;
            if (this._wipeChannel) {
              try { this._wipeChannel.postMessage({ type: 'CLEAR_DONE', wipeToken, idbEpoch: writtenEpoch }); } catch (_) {}
            }
            resolve(true);
          };
          tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
          tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
        });
      };

      const p = (this._clearing || Promise.resolve()).catch(() => {}).then(runClear);
      this._clearing = p;
      try {
        return await p;
      } finally {
        if (shared && shared.clearing > 0) shared.clearing--;
        if (this._clearing === p) this._clearing = null;
      }
    }
  }

  const defaultDB = new LinerDB();

  return {
    LinerDB,
    LossyDB: LinerDB,
    defaultDB
  };
});
