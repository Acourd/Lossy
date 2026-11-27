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

  function retainLocalCapture(incoming, existing) {
    if (!existing || existing.canonicalId !== incoming.canonicalId) return incoming;
    const isCompleteStatus = s => ['captured', 'harvested', 'complete'].includes(String(s || '').toLowerCase());
    const isPartialStatus = s => ['partial', 'uncaptured'].includes(String(s || '').toLowerCase());
    const existingCount = (existing.messages || []).length;
    const incomingCount = (incoming.messages || []).length;
    if (!incoming.forceOverwrite && existingCount > 0) {
      if (incomingCount === 0 || incomingCount < existingCount) {
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
    const oldMessages = new Map((existing.messages || []).filter(m => m.id).map(m => [m.id, m]));
    const hydrate = (assets, previous) => {
      const known = new Map(previous.filter(a => a.dataURI || a.data || a.blob).map(a => [fileIdentity(a), a]).filter(([key]) => key));
      return (assets || []).map(asset => {
        const old = known.get(fileIdentity(asset));
        if (!old || asset.dataURI || asset.data || asset.blob) return asset;
        if (!old.dataURI && !old.data && !old.blob) return asset;
        const oldUrl = getUrl(old), newUrl = getUrl(asset);
        if (oldUrl && newUrl && oldUrl !== newUrl) return asset;
        const restored = { ...asset };
        for (const key of ['dataURI', 'data', 'blob', 'mimeType', 'width', 'height']) if (old[key]) restored[key] = old[key];
        restored.availability = 'embedded';
        restored.downloadable = true;
        return restored;
      });
    };
    const msgTextOf = m => (typeof m?.text === 'string' ? m.text : (typeof m?.content?.text === 'string' ? m.content.text : ''));
    const messages = (incoming.messages || []).map(message => {
      const old = oldMessages.get(message.id);
      if (!old) return message;
      const previous = [...(old.attachments || []), ...(old.content?.attachments || [])];
      const mergedMsg = { ...message, attachments: hydrate(message.attachments, previous), content: { ...message.content, attachments: hydrate(message.content?.attachments, previous) } };
      if (!incoming.forceOverwrite) {
        const oldText = msgTextOf(old);
        const newText = msgTextOf(message);
        if (oldText.length > newText.length) {
          if (typeof old.text === 'string' || typeof mergedMsg.text === 'string') mergedMsg.text = oldText;
          if (old.content?.text !== undefined || mergedMsg.content?.text !== undefined) mergedMsg.content = { ...mergedMsg.content, text: oldText };
        }
      }
      return mergedMsg;
    });
    return { ...incoming, messages, attachments: hydrate(incoming.attachments, existing.attachments || []) };
  }

  class LinerDB {
    constructor(indexedDBRef = null) {
      this.indexedDB = indexedDBRef || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      this.db = null;
      this.opening = null;
      this.useMemoryFallback = !this.indexedDB;

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
    async saveConversation(conv) {
      await this.open();
      if (!conv || !conv.canonicalId) {
        throw new Error('Conversación inválida: canonicalId es requerido');
      }

      const prepare = existing => {
        const merged = retainLocalCapture(conv, existing);
        return this.conversationRecords(merged);
      };
      if (this.useMemoryFallback) {
        const { record, meta } = prepare(this.memoryStores.conversations.get(conv.canonicalId));
        this.memoryStores.conversations.set(record.canonicalId, JSON.parse(JSON.stringify(record)));
        this.memoryStores.metadata_index.set(record.canonicalId, meta);
        return record.canonicalId;
      }
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['conversations', 'metadata_index'], 'readwrite');
        tx.oncomplete = () => resolve(conv.canonicalId);
        tx.onerror = () => reject(tx.error || new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
        const store = tx.objectStore('conversations');
        const request = store.get(conv.canonicalId);
        request.onsuccess = () => {
          try {
            const { record, meta } = prepare(request.result);
            store.put(record);
            tx.objectStore('metadata_index').put(meta);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
      });
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
    async saveClip(clip) {
      await this.open();
      if (!clip || (!clip.canonicalId && !clip.id)) {
        throw new Error('Clip inválido: canonicalId o id es requerido');
      }

      const canonicalId = clip.canonicalId || clip.id;
      clip.canonicalId = canonicalId;
      clip.id = canonicalId;
      clip.entityType = 'clip';

      const allText = (clip.selectedMessages || []).map(m => m.content?.text || '').join(' ');
      const msgCount = clip.selectedMessages?.length || 0;
      const metaRecord = {
        canonicalId,
        id: canonicalId,
        entityType: 'clip',
        title: clip.title || 'Clip sin Título',
        platform: clip.sourcePlatform || 'unknown',
        model: clip.model || clip.sourceModel || null,
        messageCount: msgCount,
        conversationMessageCount: msgCount,
        visibleMessageCount: clip.visibleMessageCount || msgCount,
        sourceNodeCount: clip.sourceNodeCount || msgCount,
        createdAt: clip.createdAt || new Date().toISOString(),
        updatedAt: clip.updatedAt || new Date().toISOString(),
        integrityStatus: clip.integrity?.clipSelectionIntegrity || 'complete',
        sourceStatus: clip.provenance?.sourceStatus || 'source_available_locally',
        sourceConversationCanonicalId: clip.sourceConversationCanonicalId || clip.provenance?.sourceConversationCanonicalId || null,
        sourceConversationTitle: clip.sourceConversationTitle || clip.provenance?.sourceConversation || 'Conversación Origen',
        selectionType: clip.selectionType || 'multi-message',
        searchText: `${clip.title || ''} ${allText}`.toLowerCase()
      };

      if (this.useMemoryFallback) {
        this.memoryStores.conversations.set(canonicalId, JSON.parse(JSON.stringify(clip)));
        this.memoryStores.metadata_index.set(canonicalId, metaRecord);
        return canonicalId;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['conversations', 'metadata_index'], 'readwrite');
        tx.objectStore('conversations').put(clip);
        tx.objectStore('metadata_index').put(metaRecord);

        tx.oncomplete = () => resolve(canonicalId);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
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
    async restoreConversation(conv, collectionIds = []) {
      if (!conv || !conv.canonicalId) return null;
      await this.saveConversation(conv);
      if (Array.isArray(collectionIds) && collectionIds.length > 0) {
        for (const colId of collectionIds) {
          try {
            await this.addConversationsToCollection(colId, [conv.canonicalId]);
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

    async createCollection(name, description = '', conversationIds = []) {
      await this.open();
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
        this.memoryStores.collections.set(collectionId, collection);
        return collection;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['collections'], 'readwrite');
        tx.objectStore('collections').put(collection);
        tx.oncomplete = () => resolve(collection);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
    }

    async mutateCollection(collectionId, transform) {
      await this.open();
      const apply = existing => {
        if (!existing) throw new Error('Proyecto no encontrado');
        const record = structuredClone(existing);
        transform(record);
        if(record.organization?.folders){const members=new Set(record.conversationIds);for(const folder of record.organization.folders)folder.conversationIds=folder.conversationIds.filter(id=>members.has(id));}
        record.updatedAt = new Date().toISOString();
        return record;
      };
      if (this.useMemoryFallback) {
        const record = apply(this.memoryStores.collections.get(collectionId));
        this.memoryStores.collections.set(collectionId, record);
        return structuredClone(record);
      }
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['collections'], 'readwrite');
        const store = tx.objectStore('collections');
        let record;
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el proyecto'));
        tx.onabort = () => reject(tx.error || new Error('Guardado de proyecto cancelado'));
        const request = store.get(collectionId);
        request.onsuccess = () => {
          try { record = apply(request.result); store.put(record); }
          catch (error) { tx.abort(); reject(error); }
        };
      });
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

    async saveJob(job) {
      await this.open();
      if (!job || !job.jobId) throw new Error('Trabajo inválido');

      if (this.useMemoryFallback) {
        this.memoryStores.jobs.set(job.jobId, JSON.parse(JSON.stringify(job)));
        return job.jobId;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['jobs'], 'readwrite');
        tx.objectStore('jobs').put(job);
        tx.oncomplete = () => resolve(job.jobId);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
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

    async saveTransfer(transfer) {
      await this.open();
      if (!transfer || !transfer.transferId) throw new Error('Transferencia inválida');

      if (this.useMemoryFallback) {
        this.memoryStores.transfers.set(transfer.transferId, JSON.parse(JSON.stringify(transfer)));
        return transfer.transferId;
      }

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['transfers'], 'readwrite');
        tx.objectStore('transfers').put(transfer);
        tx.oncomplete = () => resolve(transfer.transferId);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
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
        tx.objectStore('conversations').clear();
        tx.objectStore('metadata_index').clear();
        tx.objectStore('collections').clear();
        tx.objectStore('transfers').clear();
        tx.objectStore('jobs').clear();
        tx.objectStore('diagnostics').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error||new Error('Error de almacenamiento'));
        tx.onabort = () => reject(tx.error||new Error('Transacción abortada'));
      });
    }
  }

  const defaultDB = new LinerDB();

  return {
    LinerDB,
    LossyDB: LinerDB,
    defaultDB
  };
});
