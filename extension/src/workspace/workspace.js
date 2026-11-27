/**
 * Liner Context Portability — Controlador del Espacio de Trabajo v1.3.1
 * Arquitectura: Library + Collections + Transfers + Diagnostics + Job Engine
 * 100% Local-first, sin llamadas a servidores de terceros, sin telemetría, Zero-Emoji.
 */

(function () {
  'use strict';

  // Blindaje global anti-excepciones no capturadas y descarte limpio de errores de runtime
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Liner Workspace] Unhandled rejection interceptada:', event.reason);
    showToast('No se pudo completar la acción. Inténtalo de nuevo.', { isError: true });
  });

  window.addEventListener('error', (event) => {
    console.warn('[Liner Workspace] Error de ejecución interceptado:', event.message);
  });

  // Referencias de estado global en memoria
  let linerDb = null;
  let activeJobEngine = null;
  let currentActiveJob = null;
  let currentActiveWorkerFn = null;
  let selectedConversationIds = new Set();
  let currentLoadedConversations = [];
  let currentActiveConversation = null;
  let currentOpenCollectionId = null;
  let projectFolderFilter = null;
  let currentProjectVisibleIds = [];
  let libraryPage = 1;
  let libraryFiltered = [];
  let lastSelectedRowIndex = -1;
  let currentLibraryTab = 'all'; // 'all' | 'conversations' | 'clips'
  let libraryFilterTimer = null;
  const libraryDateFormatter = new Intl.DateTimeFormat();
  const libraryDateTimeFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

  function scheduleLibraryFilters() {
    clearTimeout(libraryFilterTimer);
    libraryFilterTimer = setTimeout(() => {
      const searching = document.getElementById('global-search')?.value.trim();
      if (searching && !document.getElementById('nav-library')?.classList.contains('active')) navigateToView('library').catch(error => showToast(error.message));
      else applyLibraryFilters();
    }, 120);
  }

  function applyLibraryFilters() {
    clearTimeout(libraryFilterTimer);
    libraryFilterTimer = null;
    const searchInput = document.getElementById('global-search') || document.getElementById('search-input');
    const filterPlatform = document.getElementById('filter-platform');
    const filterIntegrity = document.getElementById('filter-integrity');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const platform = filterPlatform ? filterPlatform.value : '';
    const integrity = filterIntegrity ? filterIntegrity.value : '';

    const filtered = currentLoadedConversations.filter(c => {
      if (currentLibraryTab === 'conversations') {
        if (c.entityType === 'clip' || (c.canonicalId && c.canonicalId.startsWith('clip_'))) return false;
      } else if (currentLibraryTab === 'clips') {
        if (c.entityType !== 'clip' && (!c.canonicalId || !c.canonicalId.startsWith('clip_'))) return false;
      }
      if (platform && c.platform !== platform) return false;
      if (integrity && c.integrityStatus !== integrity) return false;
      if (query) {
        const matchTitle = (c.title || '').toLowerCase().includes(query);
        const matchModel = (c.model || '').toLowerCase().includes(query);
        const matchPlatform = (c.platform || '').toLowerCase().includes(query);
        const matchSearch = (c.searchText || '').includes(query);
        if (!matchTitle && !matchModel && !matchPlatform && !matchSearch) return false;
      }
      return true;
    });

    const label = document.getElementById('library-total-label');
    if (label) label.textContent = filtered.length + ' de ' + currentLoadedConversations.length + ' elementos';
    lastSelectedRowIndex = -1;
    const setSummary = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setSummary('summary-saved', currentLoadedConversations.filter(c => c.entityType !== 'clip' && !c.canonicalId?.startsWith('clip_') && c.integrityStatus !== 'indexed').length);
    setSummary('summary-clips', currentLoadedConversations.filter(c => c.entityType === 'clip' || c.canonicalId?.startsWith('clip_')).length);
    setSummary('summary-attention', currentLoadedConversations.filter(c => ['partial','degraded','failed'].includes(c.integrityStatus)).length);
    renderProjectHome();
    libraryPage = 1;
    renderLibraryPage(filtered);
  }

  // Buffer en memoria para reversión inmediata (Deshacer / Undo)
  let lastDeletedContext = null;
  let undoTimeoutHandle = null;

  function getLinerDb() {
    if (!linerDb) {
      if (typeof LossyDB !== 'undefined') {
        linerDb = new LossyDB();
      } else if (typeof LinerDB !== 'undefined') {
        linerDb = new LinerDB();
      } else if (window.Lossy && window.Lossy.LossyDB) {
        linerDb = new window.Lossy.LossyDB();
      } else if (window.Liner && window.Liner.LinerDB) {
        linerDb = new window.Liner.LinerDB();
      } else {
        linerDb = window.__LOSSY_DB__ || window.__LINER_DB__ || null;
      }
    }
    return linerDb;
  }

  function getJobEngine() {
    if (!activeJobEngine) {
      const db = getLinerDb();
      if (window.Lossy && window.Lossy.JobEngine) {
        activeJobEngine = new window.Lossy.JobEngine({ db, concurrency: 2, itemPacingMs: 150 });
      } else if (window.Liner && window.Liner.JobEngine) {
        activeJobEngine = new window.Liner.JobEngine({ db, concurrency: 2, itemPacingMs: 150 });
      } else if (typeof JobEngine !== 'undefined') {
        activeJobEngine = new JobEngine({ db, concurrency: 2, itemPacingMs: 150 });
      }
    }
    return activeJobEngine;
  }

  // Helper determinista de mensajería hacia pestañas con absorción síncrona de runtime.lastError y auto-inyección de rescate
  function safeSendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (res) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            resolve({ success: false, error: lastError.message, isConnectionError: true });
            return;
          }
          resolve(res || { success: false, error: 'Sin respuesta de pestaña' });
        });
      } catch (err) {
        resolve({ success: false, error: err.message, isConnectionError: true });
      }
    });
  }

  async function safeTabMessagingWithAutoInject(tabId, message) {
    let res = await safeSendTabMessage(tabId, message);
    if (res && !res.success && res.isConnectionError && typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'src/core/canonical/canonical_schema.js',
            'src/core/canonical_model.js',
            'src/core/portability/zip_builder.js',
            'src/core/portability/pdf_builder.js',
            'src/core/portability/docx_builder.js',
            'src/core/portability/export_center.js',
            'src/platforms/chatgpt/chatgpt_assets.js',
            'src/platforms/chatgpt/structured/chatgpt_structured_acquisition.js',
            'src/content/content_script.js'
          ]
        });
        res = await safeSendTabMessage(tabId, message);
      } catch (_) {}
    }
    return res;
  }

  function downloadBlob(content, filename, mimeType) {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Error al descargar archivo:', err);
    }
  }

  // --- HELPERS GRAMATICALES Y FORMATO ESPAÑOL ---

  function formatCount(count, singular, plural) {
    return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
  }

  function formatIntegrity(status) {
    if (status === 'captured') return 'Capturado';
    if (status === 'partial') return 'Parcial';
    if (status === 'degraded') return 'Degradada';
    if (status === 'failed') return 'Fallida';
    if (status === 'uncaptured' || status === 'known') return 'No capturada';
    return status || 'Capturado';
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '-';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return 'hace unos instantes';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `hace ${diffMin} min`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
      const diffDays = Math.floor(diffHours / 24);
      return `hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
    } catch (_) {
      return '-';
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getBadgeClass(status) {
    if (status === 'captured') return 'badge-captured';
    if (status === 'partial') return 'badge-partial';
    if (status === 'degraded') return 'badge-degraded';
    if (status === 'failed') return 'badge-failed';
    if (status === 'uncaptured' || status === 'known') return 'badge-uncaptured';
    return 'badge-captured';
  }

  // --- SISTEMA DE MODALES REUTILIZABLE (ACCESIBLE, SIN PROMPT/ALERT/CONFIRM) ---

  let modalActiveResolve = null;
  let modalActiveCleanup = null;

  function showModal({
    title,
    bodyHtml,
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    isDestructive = false,
    onRender = null
  }) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('app-modal-backdrop');
      const titleElem = document.getElementById('app-modal-title');
      const bodyElem = document.getElementById('app-modal-body');
      const confirmBtn = document.getElementById('app-modal-confirm');
      const cancelBtn = document.getElementById('app-modal-cancel');
      const closeBtn = document.getElementById('app-modal-close');

      if (!backdrop || !bodyElem) {
        resolve(false);
        return;
      }

      modalActiveResolve = resolve;

      if (titleElem) titleElem.textContent = title;
      bodyElem.innerHTML = bodyHtml;

      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmText;
        if (isDestructive) {
          confirmBtn.className = 'btn btn-danger btn-sm';
        } else {
          confirmBtn.className = 'btn btn-primary btn-sm';
        }
      }

      if (cancelBtn) {
        cancelBtn.textContent = cancelText;
      }

      backdrop.classList.remove('hidden');
      backdrop.setAttribute('aria-hidden', 'false');

      if (typeof onRender === 'function') {
        onRender(bodyElem);
      }

      // Focalizar acción principal o primer input disponible
      setTimeout(() => {
        const firstInput = bodyElem.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) {
          firstInput.focus();
        } else if (confirmBtn) {
          confirmBtn.focus();
        }
      }, 50);

      function cleanup() {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', handleKeydown);
        if (backdrop) backdrop.onclick = null;
        if (confirmBtn) confirmBtn.onclick = null;
        if (cancelBtn) cancelBtn.onclick = null;
        if (closeBtn) closeBtn.onclick = null;
        modalActiveCleanup = null;
        modalActiveResolve = null;
      }

      modalActiveCleanup = cleanup;

      function handleKeydown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve(false);
        } else if (e.key === 'Tab') {
          const focusables = Array.from(backdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.disabled && el.offsetParent !== null);
          if (focusables.length > 0) {
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          // Prevenir submit accidental si el target es botón secundario o campo de búsqueda
          if (confirmBtn?.disabled) { e.preventDefault(); return; }
          if ((e.target.tagName === 'BUTTON' && e.target !== confirmBtn) || e.target.id === 'picker-search-input') return;
          if (e.target.id === 'picker-new-coll-name') {
            e.preventDefault();
            const btnCreateInline = document.getElementById('btn-picker-create-inline');
            if (btnCreateInline) btnCreateInline.click();
            return;
          }
          e.preventDefault();
          cleanup();
          resolve(true);
        }
      }

      document.addEventListener('keydown', handleKeydown);

      if (confirmBtn) {
        confirmBtn.onclick = () => {
          cleanup();
          resolve(true);
        };
      }

      if (cancelBtn) {
        cancelBtn.onclick = () => {
          cleanup();
          resolve(false);
        };
      }

      if (closeBtn) {
        closeBtn.onclick = () => {
          cleanup();
          resolve(false);
        };
      }

      backdrop.onclick = (e) => {
        if (e.target === backdrop) {
          cleanup();
          resolve(false);
        }
      };
    });
  }

  function closeModal() {
    if (modalActiveCleanup) {
      modalActiveCleanup();
    } else {
      const backdrop = document.getElementById('app-modal-backdrop');
      if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
      }
    }
    if (modalActiveResolve) {
      modalActiveResolve(false);
      modalActiveResolve = null;
    }
  }

  // --- SISTEMA DE TOASTS NO BLOQUEANTES CON DESHACER ---

  function showToast(message, options = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const { actionText = null, onAction = null, durationMs = 5000 } = options;

    const toast = document.createElement('div');
    toast.className = 'toast-item';

    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (actionText && typeof onAction === 'function') {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action';
      actionBtn.textContent = actionText;
      actionBtn.addEventListener('click', () => {
        try {
          onAction();
        } catch (err) {
          console.error('Error en acción toast:', err);
        }
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      });
      toast.appendChild(actionBtn);
    }

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, durationMs);
  }

  // --- MENÚ CONTEXTUAL Y ACCIONES RÁPIDAS ---

  function hideContextMenu() {
    const menu = document.getElementById('app-context-menu');
    if (menu) {
      menu.classList.add('hidden');
      menu.setAttribute('aria-hidden', 'true');
      menu.innerHTML = '';
    }
  }

  function showContextMenu(x, y, items = []) {
    const menu = document.getElementById('app-context-menu');
    if (!menu) return;

    menu.innerHTML = '';
    items.forEach(item => {
      if (item.isDivider) {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        menu.appendChild(div);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `context-menu-item ${item.isDanger ? 'danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        if (typeof item.onClick === 'function') {
          item.onClick();
        }
      });
      menu.appendChild(btn);
    });

    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    menu._justOpened = true;
    setTimeout(() => {
      if (menu) menu._justOpened = false;
    }, 120);

    // Posicionamiento inteligente dentro del viewport
    const menuRect = menu.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - menuRect.width - 12);
    const maxY = Math.max(0, window.innerHeight - menuRect.height - 12);

    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('app-context-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu._justOpened) return;
    if (menu.contains(e.target)) return;
    hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  });

  // --- CONTADORES Y SIDEBAR COLLECTIONS TREE ---

  async function updateAllCounts(metadata = null) {
    try {
      const db = getLinerDb();
      if (!db) return;

      const [metaList, collections, transfers] = await Promise.all([
        metadata || db.listMetadata(),
        db.listCollections(),
        db.listTransfers()
      ]);

      const navLib = document.getElementById('nav-library-count');
      const navColl = document.getElementById('nav-collections-count');
      const navTrans = document.getElementById('nav-transfers-count');
      const totalLabel = document.getElementById('library-total-label');

      if (navLib) navLib.textContent = metaList.length;
      if (navColl) navColl.textContent = collections.length;
      if (navTrans) navTrans.textContent = transfers.length;
      if (totalLabel) totalLabel.textContent = formatCount(metaList.length, 'elemento', 'elementos');

      const allCount = metaList.length;
      const convsCount = metaList.filter(m => m.entityType !== 'clip' && !m.canonicalId.startsWith('clip_')).length;
      const clipsCount = metaList.filter(m => m.entityType === 'clip' || m.canonicalId.startsWith('clip_')).length;

      const cTabAll = document.getElementById('count-tab-all');
      const cTabConvs = document.getElementById('count-tab-convs');
      const cTabClips = document.getElementById('count-tab-clips');
      if (cTabAll) cTabAll.textContent = allCount;
      if (cTabConvs) cTabConvs.textContent = convsCount;
      if (cTabClips) cTabClips.textContent = clipsCount;

      await renderSidebarCollections(collections);
      renderProjectHome(collections);
    } catch (_) {}
  }

  async function renderSidebarCollections(collectionsList = null) {
    const listElem = document.getElementById('sidebar-collections-list');
    if (!listElem) return;

    try {
      const db = getLinerDb();
      if (!db) return;

      const collections = collectionsList || await db.listCollections();

      if (collections.length === 0) {
        listElem.innerHTML = `
          <div style="padding: 6px 8px; font-size: 11.5px; color: var(--text-tertiary); line-height: 1.4;">
            Sin proyectos aún. Arrastra una conversación aquí para crear el primero.
          </div>
        `;
        return;
      }

      const MAX_SIDEBAR_ITEMS = 8;
      const visibleCollections = collections.slice(0, MAX_SIDEBAR_ITEMS);
      const hasMore = collections.length > MAX_SIDEBAR_ITEMS;

      let html = visibleCollections.map(c => `
        <div class="sidebar-collection-item ${currentOpenCollectionId === c.collectionId ? 'active' : ''}" data-collection-id="${escapeHtml(c.collectionId)}" title="${escapeHtml(c.name)} (${c.conversationIds?.length || 0} chats)">
          <span class="coll-name">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12v-8.5z"/>
            </svg>
            ${escapeHtml(c.name)}
          </span>
          <span class="coll-count">${c.conversationIds?.length || 0}</span>
        </div>
      `).join('');

      if (hasMore) {
        html += `
          <button id="btn-sidebar-view-all-collections" class="sidebar-more-link" type="button">
            Ver todos (${collections.length}) &rarr;
          </button>
        `;
      }

      listElem.innerHTML = html;

      const btnViewAll = listElem.querySelector('#btn-sidebar-view-all-collections');
      if (btnViewAll) {
        btnViewAll.addEventListener('click', () => {
          const navColl = document.getElementById('nav-collections');
          if (navColl) navColl.click();
        });
      }

      // Enlazar navegación y drag-and-drop sobre cada ítem de proyecto
      listElem.querySelectorAll('.sidebar-collection-item').forEach(item => {
        const colId = item.dataset.collectionId;
        item.addEventListener('click', () => navigateToView('collections').then(() => openCollectionDetail(colId)).catch(error => showToast(error.message)));

        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const targetCol = collections.find(c => c.collectionId === colId);
          if (!targetCol) return;
          showContextMenu(e.clientX, e.clientY, [
            { label: `Abrir "${targetCol.name}"`, onClick: () => navigateToView('collections').then(() => openCollectionDetail(colId)).catch(error => showToast(error.message))},
            { label: 'Renombrar proyecto', onClick: () => promptRenameCollection(colId) },
            { label: 'Continuar en otra IA desde proyecto', onClick: () => startTransferFromCollection(colId) },
            { label: 'Exportar (.zip)', onClick: () => exportCollectionZip(colId) },
            { isDivider: true },
            { label: 'Eliminar proyecto', isDanger: true, onClick: () => promptDeleteCollection(colId) }
          ]);
        });
      });

      setupSidebarDropTargets();

    } catch (err) {
      console.warn('Error al renderizar proyectos de sidebar:', err);
    }
  }

  // --- MOTOR DRAG & DROP (FILE EXPLORER METAPHOR) ---

  function setupSidebarDropTargets() {
    const targets = document.querySelectorAll('.sidebar-collection-item, #sidebar-collections-header');

    targets.forEach(target => {
      target.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types ||
            (!e.dataTransfer.types.includes('application/lossy-context') &&
             !e.dataTransfer.types.includes('application/liner-conversations'))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        target.classList.add('drop-target-hover');
      });

      target.addEventListener('dragleave', () => {
        target.classList.remove('drop-target-hover');
      });

      target.addEventListener('drop', async (e) => {
        e.preventDefault();
        target.classList.remove('drop-target-hover');

        let ids = [];
        const rawLossy = e.dataTransfer.getData('application/lossy-context');
        if (rawLossy) {
          try {
            const parsed = JSON.parse(rawLossy);
            ids = Array.isArray(parsed.ids) ? parsed.ids : (Array.isArray(parsed.items) ? parsed.items.map(it => it.id) : []);
          } catch (_) {}
        }
        if (ids.length === 0) {
          const rawLiner = e.dataTransfer.getData('application/liner-conversations');
          if (rawLiner) {
            try {
              ids = JSON.parse(rawLiner);
            } catch (_) {}
          }
        }

        if (!Array.isArray(ids) || ids.length === 0) return;

        const db = getLinerDb();
        if (!db) return;

        const colId = target.dataset.collectionId;
        if (colId) {
          // Soltar sobre proyecto específica
          try {
            const col = await db.getCollection(colId);
            if (!col) return;

            const existingSet = new Set(col.conversationIds || []);
            const newIds = ids.filter(id => !existingSet.has(id));

            await db.addConversationsToCollection(colId, ids);

            if (newIds.length === 0) {
              showToast(`Ya ${ids.length === 1 ? 'pertenece' : 'pertenecen'} a "${col.name}".`);
            } else {
              showToast(`Añadidos ${formatCount(newIds.length, 'elemento', 'elementos')} a "${col.name}".`, {
                actionText: 'Ver proyecto',
                onAction: () => {
                  const navColl = document.getElementById('nav-collections');
                  if (navColl) navColl.click();
                  openCollectionDetail(colId);
                }
              });
            }
            await updateAllCounts();
            if (currentOpenCollectionId === colId) {
              await openCollectionDetail(colId);
            }
          } catch (err) {
            console.error('Error al añadir a proyecto por drop:', err);
            showToast('No se pudo añadir a el proyecto.');
          }
        } else {
          // Soltar sobre encabezado "Proyectos": abre selector / picker modal
          openCollectionPicker(ids);
        }
      });
    });
  }

  function bindDragAffordance(row, rec) {
    const handle = row.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('dragstart', (e) => {
      let idsToDrag = [];
      if (selectedConversationIds.has(rec.canonicalId)) {
        idsToDrag = Array.from(selectedConversationIds);
      } else {
        idsToDrag = [rec.canonicalId];
      }

      const dragItems = idsToDrag.map(id => ({
        id,
        type: (id && id.startsWith('clip_')) ? 'clip' : 'conversation'
      }));

      const payloadLossy = JSON.stringify({
        items: dragItems,
        ids: idsToDrag
      });

      e.dataTransfer.setData('application/lossy-context', payloadLossy);
      e.dataTransfer.setData('application/liner-conversations', JSON.stringify(idsToDrag));
      e.dataTransfer.setData('text/plain', idsToDrag.join(','));
      e.dataTransfer.effectAllowed = 'copy';

      const allClips = dragItems.every(it => it.type === 'clip');
      const allConvs = dragItems.every(it => it.type === 'conversation');
      const ghostLabel = allClips
        ? formatCount(idsToDrag.length, 'clip', 'clips')
        : (allConvs
            ? formatCount(idsToDrag.length, 'conversación', 'conversaciones')
            : formatCount(idsToDrag.length, 'elemento de contexto', 'elementos de contexto'));

      if (idsToDrag.length > 1 && typeof e.dataTransfer.setDragImage === 'function') {
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost-badge';
        ghost.textContent = ghostLabel;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => ghost.remove(), 0);
      }

      row.classList.add('is-dragging');

      // Feedback visual global: iluminar todos los drop targets posibles
      document.querySelectorAll('.sidebar-collection-item, #sidebar-collections-header, .collection-card').forEach(t => {
        t.classList.add('drop-target-active');
      });
    });

    handle.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      document.querySelectorAll('.drop-target-active, .drop-target-hover').forEach(t => {
        t.classList.remove('drop-target-active');
        t.classList.remove('drop-target-hover');
      });
    });
  }

  // --- NAVEGACIÓN ENTRE VISTAS ---
  function renderLibraryPage(records = null) {
    if(records)libraryFiltered=records;
    const pages=Math.max(1,Math.ceil(libraryFiltered.length/100));libraryPage=Math.min(libraryPage,pages);
    renderTableRows(libraryFiltered.slice((libraryPage-1)*100,libraryPage*100));
    const label=document.getElementById('library-page-state');if(label)label.textContent='Página '+libraryPage+' de '+pages+' · '+libraryFiltered.length+' resultados';
    const previous=document.getElementById('library-page-prev'),next=document.getElementById('library-page-next');if(previous)previous.disabled=libraryPage===1;if(next)next.disabled=libraryPage===pages;
  }

  function setTransferMode(mode) {
    const archive=mode==='archive';document.getElementById('chatgpt-migration')?.classList.toggle('hidden',!archive);document.getElementById('transfer-existing-builder')?.classList.toggle('hidden',archive);
    for(const key of ['archive','selection']){const button=document.getElementById('transfer-mode-'+key);if(button){button.classList.toggle('active',key===mode);button.setAttribute('aria-selected',String(key===mode));}}
  }

  async function navigateToView(targetView) {
    await flushProjectEditor();
    document.getElementById('inspector-drawer')?.classList.add('hidden');
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === targetView));
    document.querySelectorAll('.view-panel').forEach(panel => {
      const active = panel.id === 'view-' + targetView;
      panel.classList.toggle('active', active); panel.classList.toggle('hidden', !active);
    });
    if (targetView === 'diagnostics') await renderDiagnosticsView();
    else if (targetView === 'collections') await renderCollectionsView();
    else if (targetView === 'transfers') { setTransferMode(selectedConversationIds.size?'selection':'archive'); await updateTransferBuilder(); }
    else if (targetView === 'library') await loadLibraryData();
  }

  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => navigateToView(button.dataset.view).catch(error => showToast(error.message))));
  }

  // --- CARGA Y RENDERIZADO DE BIBLIOTECA (SINGLE SOURCE OF TRUTH) ---
  async function loadLibraryData() {
    const tbody = document.getElementById('library-table-body');
    if (!tbody) return;

    try {
      const db = getLinerDb();
      let records = [];
      if (db) {
        records = await db.listMetadata();
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(['liner_conversations_index']);
        records = stored.liner_conversations_index || [];
      }

      currentLoadedConversations = records;
      await updateAllCounts(records);
      applyLibraryFilters();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" style="color: var(--accent-red); padding: 20px;">Error al cargar la biblioteca: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderTableRows(records) {
    const tbody = document.getElementById('library-table-body');
    if (!tbody) return;

    if (!records || records.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="9" style="text-align: center; padding: 48px 20px; color: var(--text-secondary);">
            <p style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">${currentLoadedConversations.length ? 'No hay resultados con estos filtros' : 'Tu contexto empieza aquí'}</p>
            <p style="font-size: 12.5px; color: var(--text-tertiary); max-width: 480px; margin: 0 auto; line-height: 1.5;">
              ${currentLoadedConversations.length ? 'Prueba otra búsqueda o cambia los filtros de plataforma e integridad.' : 'Abre un chat en ChatGPT y guárdalo con la extensión. Después podrás organizarlo y exportarlo desde aquí.'}
            </p>
          </td>
        </tr>
      `;
      const check = document.getElementById('check-all');
      if (check) { check.checked = false; check.indeterminate = false; check.disabled = true; }
      return;
    }
    const check = document.getElementById('check-all');
    if (check) check.disabled = false;
    const fragment = document.createDocumentFragment();
    records.forEach((rec, idx) => {
      const tr = document.createElement('tr');
      const recId = rec.canonicalId || rec.id;
      tr.dataset.id = recId;
      tr.dataset.index = idx;

      const isClip = rec.entityType === 'clip' || (recId && recId.startsWith('clip_'));
      const isChecked = selectedConversationIds.has(recId);
      if (isChecked) tr.classList.add('is-selected');
      const date = new Date(rec.updatedAt || rec.createdAt);
      const validDate = Number.isFinite(date.getTime());
      const dateStr = validDate ? libraryDateFormatter.format(date) : '-';
      const fullDateStr = validDate ? libraryDateTimeFormatter.format(date) : '';
      const platformDisplay = (rec.platform || 'ChatGPT').toUpperCase();

      let titleDisplay = '';
      let modelDisplay = '';
      let integrityBadge = '';

      if (isClip) {
        titleDisplay = `<span class="chip clip-label">CLIP</span><strong style="cursor: pointer;" class="btn-inspect-title" data-id="${escapeHtml(recId)}" title="Ver detalles del clip">${escapeHtml(rec.title || 'Clip sin Título')}</strong>`;
        modelDisplay = rec.model ? escapeHtml(rec.model) : '<span style="color: var(--text-tertiary)">—</span>';
        if (rec.sourceStatus === 'source_unavailable_locally') {
          integrityBadge = `<span class="badge badge-partial" style="font-size: 10px;" title="Conversación origen eliminada localmente. El clip mantiene su contenido íntegro.">Fuente ausente</span>`;
        } else {
          integrityBadge = `<span class="badge badge-captured" style="font-size: 10px;" title="Clip completo">Completo</span>`;
        }
      } else {
        const badgeClass = getBadgeClass(rec.integrityStatus);
        titleDisplay = `<strong style="cursor: pointer;" class="btn-inspect-title" data-id="${escapeHtml(recId)}" title="Ver detalles">${escapeHtml(rec.title || 'Sin Título')}</strong>`;
        modelDisplay = rec.model ? escapeHtml(rec.model) : '<span style="color: var(--text-tertiary)">—</span>';
        integrityBadge = `<span class="badge ${badgeClass}" title="${rec.integrityStatus === 'partial' ? 'Parte del historial previo podría no haberse materializado en el DOM.' : 'Captura verificada'}">${escapeHtml(formatIntegrity(rec.integrityStatus))}</span>`;
      }

      const convMsgCount = rec.conversationMessageCount !== undefined
        ? rec.conversationMessageCount
        : (rec.visibleMessageCount !== undefined ? rec.visibleMessageCount : (rec.messageCount || 0));
      const nodeCount = rec.sourceNodeCount || rec.messageCount || 0;
      const nodeTooltip = nodeCount > convMsgCount
        ? ` title="${convMsgCount} mensajes de conversación (${nodeCount} nodos brutos de origen)"`
        : ` title="${convMsgCount} mensajes"`;

      tr.innerHTML = `
        <td class="col-drag">
          <div class="drag-handle" draggable="true" title="Arrastrar para añadir a un proyecto" data-id="${escapeHtml(recId)}">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
              <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
              <circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/>
            </svg>
          </div>
        </td>
        <td class="col-check">
          <input type="checkbox" class="row-select" data-id="${escapeHtml(recId)}" data-index="${idx}" ${isChecked ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(rec.title || '')}">
        </td>
        <td class="col-title">
          ${titleDisplay}
        </td>
        <td class="col-platform">
          <span>${escapeHtml(platformDisplay)}</span>
        </td>
        <td class="col-model">
          <span>${modelDisplay}</span>
        </td>
        <td class="col-messages">
          <span${nodeTooltip}>${convMsgCount}</span>
        </td>
        <td class="col-date">
          <span title="${escapeHtml(fullDateStr)}">${dateStr}</span>
        </td>
        <td class="col-integrity">
          ${integrityBadge}
        </td>
        <td class="col-actions">
          <div style="display: flex; gap: 4px; align-items: center;">
            <button class="btn btn-ghost btn-sm btn-row-menu" type="button" data-id="${escapeHtml(recId)}" title="Más opciones" aria-label="Más opciones">⋯</button>
            <button class="btn-inspect" type="button" data-id="${escapeHtml(recId)}" style="display: none;" aria-hidden="true"></button>
          </div>
        </td>
      `;

      bindDragAffordance(tr, rec);
      fragment.appendChild(tr);
    });
    tbody.replaceChildren(fragment);

    bindRowEvents();
  }

  // --- SELECCIÓN MASIVA, RANGO SHIFT Y BARRA DE ACCIONES ---
  function syncCheckAllState() {
    const checkAll = document.getElementById('check-all');
    if (!checkAll) return;
    const checkboxes = Array.from(document.querySelectorAll('.row-select'));
    if (checkboxes.length === 0) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
      return;
    }
    const allChecked = checkboxes.every(cb => cb.checked);
    const someChecked = checkboxes.some(cb => cb.checked);
    checkAll.checked = allChecked;
    checkAll.indeterminate = !allChecked && someChecked;
  }

  function bindRowEvents() {
    const checkboxes = Array.from(document.querySelectorAll('.row-select'));
    const checkAll = document.getElementById('check-all');

    checkboxes.forEach((cb) => {
      cb.addEventListener('click', (e) => {
        const currentIndex = parseInt(cb.dataset.index, 10);

        if (e.shiftKey && lastSelectedRowIndex >= 0 && lastSelectedRowIndex < checkboxes.length) {
          const start = Math.min(lastSelectedRowIndex, currentIndex);
          const end = Math.max(lastSelectedRowIndex, currentIndex);
          const targetChecked = cb.checked;

          for (let i = start; i <= end; i++) {
            checkboxes[i].checked = targetChecked;
            const rowId = checkboxes[i].dataset.id;
            if (targetChecked) {
              selectedConversationIds.add(rowId);
            } else {
              selectedConversationIds.delete(rowId);
            }
          }
        } else {
          const rowId = cb.dataset.id;
          if (cb.checked) {
            selectedConversationIds.add(rowId);
          } else {
            selectedConversationIds.delete(rowId);
          }
        }

        lastSelectedRowIndex = currentIndex;
        updateBulkActionBar();
      });
    });

    if (checkAll) {
      checkAll.onchange = (e) => {
        const checked = e.target.checked;
        checkboxes.forEach(cb => {
          cb.checked = checked;
          const id = cb.dataset.id;
          if (checked) selectedConversationIds.add(id);
          else selectedConversationIds.delete(id);
        });
        updateBulkActionBar();
      };
    }

    syncCheckAllState();

    document.querySelectorAll('.btn-inspect, .btn-inspect-title').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const convId = btn.dataset.id;
        document.querySelectorAll('#library-table-body tr').forEach(r => r.classList.toggle('is-inspecting', r.dataset.id === convId));
        openFullReader(convId);
      });
    });

    // Menú contextual y selección en click sobre fila
    document.querySelectorAll('#library-table-body tr').forEach(tr => {
      const convId = tr.dataset.id;
      if (!convId) return;

      // Doble click: abrir lector completo de mensajes
      tr.addEventListener('dblclick', (e) => {
        if (e.target.closest('input, button, a, .drag-handle, .btn-row-menu')) return;
        document.querySelectorAll('#library-table-body tr').forEach(r => r.classList.remove('is-inspecting'));
        tr.classList.add('is-inspecting');
        openFullReader(convId);
      });

      // Click desktop en fila (Shift+Click rango, Ctrl/Cmd+Click toggle, Single Click abrir vista completa)
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input, button, a, .drag-handle, .btn-row-menu, .btn-inspect, .btn-inspect-title')) {
          return;
        }
        const cb = tr.querySelector('.row-select');
        if (!cb) return;
        const currentIndex = parseInt(cb.dataset.index, 10);
        const rowId = cb.dataset.id;

        if (e.shiftKey && lastSelectedRowIndex >= 0 && lastSelectedRowIndex < checkboxes.length) {
          const start = Math.min(lastSelectedRowIndex, currentIndex);
          const end = Math.max(lastSelectedRowIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            checkboxes[i].checked = true;
            selectedConversationIds.add(checkboxes[i].dataset.id);
          }
          lastSelectedRowIndex = currentIndex;
          updateBulkActionBar();
        } else if (e.ctrlKey || e.metaKey) {
          cb.checked = !cb.checked;
          if (cb.checked) selectedConversationIds.add(rowId);
          else selectedConversationIds.delete(rowId);
          lastSelectedRowIndex = currentIndex;
          updateBulkActionBar();
        } else {
          // Single Click: abrir conversación directamente en pantalla completa
          document.querySelectorAll('#library-table-body tr').forEach(r => r.classList.remove('is-inspecting'));
          tr.classList.add('is-inspecting');
          lastSelectedRowIndex = currentIndex;
          openFullReader(convId);
        }
      });


      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menuItems = getRowMenuItems(convId);
        if (menuItems.length > 0) {
          showContextMenu(e.clientX, e.clientY, menuItems);
        }
      });
    });

    // Menú de fila ⋯
    document.querySelectorAll('.btn-row-menu').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const convId = btn.dataset.id;
        const rect = btn.getBoundingClientRect();
        const menuItems = getRowMenuItems(convId);
        if (menuItems.length > 0) {
          showContextMenu(rect.left, rect.bottom + 4, menuItems);
        }
      });
    });
  }

      function getRowMenuItems(targetConvId) {
        const conv = currentLoadedConversations.find(c => c.canonicalId === targetConvId || c.id === targetConvId);
        if (!conv) return [];
        const isClip = conv.entityType === 'clip' || targetConvId.startsWith('clip_');

        if (isClip) {
          return [
            { label: 'Ver clip', onClick: () => openFullReader(targetConvId) },
            { label: 'Ver mensajes', onClick: () => openFullReader(targetConvId) },
            { label: 'Exportar', onClick: () => openExportCenterModal([targetConvId]) },
            { label: 'Añadir a proyecto', onClick: () => openCollectionPicker([targetConvId]) },
            { label: 'Continuar en otra IA', onClick: () => {
              selectedConversationIds.clear();
              selectedConversationIds.add(targetConvId);
              updateBulkActionBar();
              const navTrans = document.getElementById('nav-transfers');
              if (navTrans) navTrans.click();
            }},
            { isDivider: true },
            { label: 'Eliminar Clip de Lossy', isDanger: true, onClick: () => promptDeleteConversation(targetConvId) }
          ];
        }

        return [
          { label: 'Ver detalles', onClick: () => openFullReader(targetConvId) },
          { label: 'Ver mensajes', onClick: () => openFullReader(targetConvId) },
          { label: 'Exportar', onClick: () => openExportCenterModal([targetConvId]) },
          { label: 'Abrir origen en ChatGPT', onClick: () => {
            const url = conv.source?.url || `https://chatgpt.com/c/${conv.source?.conversationId || ''}`;
            window.open(url, '_blank');
          }},
          { label: 'Actualizar captura', onClick: () => startSingleCapture(targetConvId) },
          { isDivider: true },
          { label: 'Añadir a proyecto', onClick: () => openCollectionPicker([targetConvId]) },
          { label: 'Continuar en otra IA', onClick: () => {
            selectedConversationIds.clear();
            selectedConversationIds.add(targetConvId);
            updateBulkActionBar();
            const navTrans = document.getElementById('nav-transfers');
            if (navTrans) navTrans.click();
          }},
          { isDivider: true },
          { label: 'Eliminar de Lossy', isDanger: true, onClick: () => promptDeleteConversation(targetConvId) }
        ];
      }

  function updateBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    const countLabel = document.getElementById('bulk-selected-count');
    const textLabel = document.getElementById('bulk-selected-label');
    const btnBulkCapture = document.getElementById('btn-bulk-capture');
    const count = selectedConversationIds.size;

    if (count > 0) {
      if (bar) bar.classList.remove('hidden');
      if (countLabel) countLabel.textContent = count;
      if (textLabel) textLabel.textContent = count === 1 ? 'seleccionado' : 'seleccionados';

      if (btnBulkCapture) {
        const partialCount = currentLoadedConversations.filter(c => selectedConversationIds.has(c.canonicalId) && (c.integrityStatus === 'partial' || c.integrity?.status === 'partial')).length;
        if (partialCount > 0) {
          btnBulkCapture.textContent = `Actualizar ${formatCount(partialCount, 'captura', 'capturas')}`;
        } else {
          btnBulkCapture.textContent = `Actualizar ${formatCount(count, 'captura', 'capturas')}`;
        }
      }
    } else {
      if (bar) bar.classList.add('hidden');
    }

    // Sincronizar clase visual is-selected en filas
    document.querySelectorAll('#library-table-body tr').forEach(r => {
      r.classList.toggle('is-selected', selectedConversationIds.has(r.dataset.id));
    });

    syncCheckAllState();
  }

  // --- FILTROS Y BÚSQUEDA ---
  function setupSearchAndFilters() {
    const searchInput = document.getElementById('global-search') || document.getElementById('search-input');
    const filterPlatform = document.getElementById('filter-platform');
    const filterIntegrity = document.getElementById('filter-integrity');

    if (searchInput) searchInput.addEventListener('input', scheduleLibraryFilters);
    if (filterPlatform) filterPlatform.addEventListener('change', applyLibraryFilters);
    if (filterIntegrity) filterIntegrity.addEventListener('change', applyLibraryFilters);

    const tabAll = document.getElementById('tab-lib-all');
    const tabConvs = document.getElementById('tab-lib-convs');
    const tabClips = document.getElementById('tab-lib-clips');

    [tabAll, tabConvs, tabClips].forEach(tabBtn => {
      if (!tabBtn) return;
      tabBtn.addEventListener('click', () => {
        [tabAll, tabConvs, tabClips].forEach(b => b && b.classList.remove('active'));
        tabBtn.classList.add('active');
        currentLibraryTab = tabBtn.dataset.tab || 'all';
        applyLibraryFilters();
      });
    });
  }

  function inferExpectedPlatform(entry) {
    const rawPlat = String(entry?.platform || entry?.source?.platform || '').toLowerCase().trim();
    if (rawPlat && rawPlat !== 'unknown') return rawPlat;
    const cid = String(entry?.canonicalId || entry?.id || '');
    const m = cid.match(/^conv_(chatgpt|claude|gemini)_/);
    if (m && m[1]) return m[1];
    const url = String(entry?.url || entry?.source?.url || '');
    if (/claude\.ai/i.test(url)) return 'claude';
    if (/gemini\.google\.com/i.test(url)) return 'gemini';
    if (/chatgpt\.com|chat\.openai\.com/i.test(url)) return 'chatgpt';
    return 'chatgpt';
  }

  function platformTabQueryConfig(platform) {
    if (platform === 'claude') {
      return { urls: ['https://claude.ai/*'], matchTab: (t, id) => Boolean(t.url && t.url.includes(`/chat/${id}`)), allowStructuredFallback: false };
    }
    if (platform === 'gemini') {
      return { urls: ['https://gemini.google.com/*'], matchTab: (t, id) => Boolean(t.url && t.url.includes(`/app/${id}`)), allowStructuredFallback: false };
    }
    return { urls: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], matchTab: (t, id) => Boolean(t.url && t.url.includes(`/c/${id}`)), allowStructuredFallback: true };
  }

  function verifyAcquiredIdentity(ext, { expectedConvId, expectedPlatform, expectedCanonicalId }) {
    const receivedConvId = ext?.source?.conversationId;
    if (!receivedConvId || receivedConvId !== expectedConvId) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: Se esperaba ${expectedConvId} pero se recibió ${receivedConvId || 'desconocido'}.`);
    }
    const receivedPlatform = ext?.source?.platform ? String(ext.source.platform).toLowerCase().trim() : null;
    if (expectedPlatform && (!receivedPlatform || receivedPlatform !== expectedPlatform)) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: Proveedor incompatible (esperado ${expectedPlatform}, recibido ${receivedPlatform || 'desconocido'}).`);
    }
    if (expectedCanonicalId && ext?.canonicalId && ext.canonicalId !== expectedCanonicalId) {
      throw new Error(`SOURCE_IDENTITY_MISMATCH: CanonicalId incompatible (${ext.canonicalId} != ${expectedCanonicalId}).`);
    }
  }

  // --- ACTUALIZACIÓN CONTEXTUAL DE CAPTURA INDIVIDUAL ---
  async function startSingleCapture(canonicalId) {
    const db = getLinerDb();
    if (!db) return;
    const captureWipeEpoch = typeof db.getWipeEpoch === 'function' ? db.getWipeEpoch() : null;
    const conv = await db.getConversation(canonicalId);
    if (!conv) return;

    const expectedPlatform = inferExpectedPlatform(conv);
    const item = {
      id: conv.canonicalId,
      canonicalId: conv.canonicalId,
      title: conv.title,
      conversationId: conv.source?.conversationId,
      platform: expectedPlatform,
      url: conv.source?.url
    };

    const engine = getJobEngine();
    if (engine) {
      let job;
      try {
        job = engine.createJob('SINGLE_ACQUISITION', [item]);
      } catch (err) {
        showToast(err.message || 'Ya hay una captura en curso.', { isError: true });
        return;
      }
      currentActiveJob = job;
      updateGlobalJobTray(job);
      engine.onProgress(updatedJob => {
        currentActiveJob = updatedJob;
        updateGlobalJobTray(updatedJob);
      });
      engine.run(async (it) => {
        const itemTitle = (it && it.title) ? it.title : item.title;
        job.currentItemTitle = itemTitle;
        updateGlobalJobTray(job);
        return { id: item.id, title: itemTitle };
      }).catch(console.warn);
    }

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && conv.source?.conversationId) {
      try {
        const cfg = platformTabQueryConfig(expectedPlatform);
        const tabs = await chrome.tabs.query({ url: cfg.urls });
        if (tabs && tabs.length > 0) {
          const exactTab = tabs.find(t => cfg.matchTab(t, conv.source.conversationId));
          if (!exactTab && !cfg.allowStructuredFallback) {
            showToast(`No se encontró una pestaña activa para esta conversación de ${expectedPlatform}.`);
            return;
          }
          const targetTab = exactTab || tabs[0];
          const isStructuredOnly = !exactTab;
          const action = isStructuredOnly ? 'ACQUIRE_STRUCTURED_ONLY' : 'ACQUIRE_CONVERSATION';

          const res = await safeTabMessagingWithAutoInject(targetTab.id, { action, conversationId: conv.source.conversationId, platform: expectedPlatform });
          if (captureWipeEpoch !== null && typeof db.getWipeEpoch === 'function' && db.getWipeEpoch() !== captureWipeEpoch) {
            return;
          }
          if (res && res.success && res.data) {
            // SOURCE IDENTITY INVARIANT (fail-closed across both UUID & provider):
            try {
              verifyAcquiredIdentity(res.data, {
                expectedConvId: conv.source.conversationId,
                expectedPlatform,
                expectedCanonicalId: conv.canonicalId
              });
            } catch (idErr) {
              console.error('[Liner Workspace] Violación de invariante:', idErr.message);
              showToast(idErr.message, { isError: true });
              return;
            }
            await db.saveConversation(res.data, captureWipeEpoch !== null ? { expectedWipeEpoch: captureWipeEpoch } : undefined);
            await loadLibraryData();
            showToast(`Captura de "${conv.title}" actualizada con éxito.`);
            if (currentActiveConversation && currentActiveConversation.canonicalId === canonicalId) {
              openInspector(canonicalId);
            }
          } else if (res && !res.success) {
            if (res.isConnectionError) {
              console.warn('[Liner Workspace] Error comunicando con pestaña:', res.error);
              showToast('No se pudo conectar con la pestaña de ChatGPT.');
            } else {
              showToast(res.error || 'No se pudo actualizar la captura.');
            }
          }
        } else {
          showToast('No se encontró ninguna pestaña abierta de ChatGPT.');
        }
      } catch (err) {
        console.warn('[Liner Workspace] Error en startSingleCapture:', err);
      }
    }

    showToast(`Actualizando captura de "${conv.title}"...`);
  }

  // --- SIDE INSPECTOR DRAWER ---
  async function openInspector(canonicalId, options = {}) {
    const drawer = document.getElementById('inspector-drawer');
    const body = document.getElementById('inspector-body');
    const titleElem = document.getElementById('inspector-title');
    if (!drawer || !body) return;

    drawer.classList.remove('hidden');
    body.innerHTML = '<p style="color: var(--text-secondary)">Cargando detalles...</p>';

    // Resaltar visualmente la fila en la tabla de la biblioteca
    document.querySelectorAll('#library-table-body tr').forEach(r => {
      r.classList.toggle('is-inspecting', r.dataset.id === canonicalId);
    });

    try {
      const db = getLinerDb();
      let conv = null;
      let associatedCollections = [];
      if (db) {
        conv = await db.getConversation(canonicalId);
        if (!conv && typeof db.getClip === 'function') {
          conv = await db.getClip(canonicalId);
        }
        if (!conv && Array.isArray(currentLoadedConversations)) {
          const metaMatch = currentLoadedConversations.find(c => c.canonicalId === canonicalId || c.id === canonicalId);
          if (metaMatch) {
            if (metaMatch.entityType === 'clip' && typeof db.getClip === 'function') {
              conv = await db.getClip(metaMatch.canonicalId || metaMatch.id) || metaMatch;
            } else {
              conv = await db.getConversation(metaMatch.canonicalId || metaMatch.id) || metaMatch;
            }
          }
        }
        if (conv && typeof db.getCollectionsForConversation === 'function') {
          associatedCollections = await db.getCollectionsForConversation(conv.canonicalId || canonicalId);
        }
      }

      // Fallback de rescate a chrome.storage.local si IndexedDB no responde o está en proceso de arranque
      if (!conv && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          const stored = await chrome.storage.local.get(['liner_conversations', 'liner_conversations_index']);
          const convList = stored.liner_conversations || [];
          const found = convList.find(c => c && (c.canonicalId === canonicalId || c.id === canonicalId));
          if (found) conv = found;
        } catch (_) {}
      }

      if (!conv) {
        body.innerHTML = '<p style="color: var(--accent-red)">Conversación o Clip no encontrado en la base de datos local.</p>';
        return;
      }

      currentActiveConversation = conv;
      const isClip = conv.entityType === 'clip' || (conv.canonicalId && conv.canonicalId.startsWith('clip_'));
      const activeId = conv.canonicalId || canonicalId;

      // Sección interactiva de proyectos (con desasignación rápida y adición)
      let collectionsSectionHtml = '';
      if (associatedCollections.length > 0) {
        const chips = associatedCollections.map(c => `
          <span class="chip" data-col-id="${c.id || c.collectionId}" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px;">
            <span>${escapeHtml(c.name)}</span>
            <button type="button" class="chip-remove" data-col-id="${c.id || c.collectionId}" data-col-name="${escapeHtml(c.name)}" title="Quitar de proyecto" aria-label="Quitar">&times;</button>
          </span>
        `).join(' ');
        collectionsSectionHtml = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">${chips}</div>
            <button id="btn-inspector-add-col" class="btn btn-ghost btn-sm" type="button" style="font-size: 11px; padding: 2px 6px;">+ Añadir</button>
          </div>
        `;
      } else {
        collectionsSectionHtml = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <span style="color: var(--text-tertiary); font-size: 12px;">Sin proyecto</span>
            <button id="btn-inspector-add-col" class="btn btn-ghost btn-sm" type="button" style="font-size: 11px; padding: 2px 6px;">+ Añadir</button>
          </div>
        `;
      }

      // Marcas temporales coherentes (nunca combinar fecha absoluta A con relativo B)
      const updateTimestamp = conv.updatedAt || conv.createdAt;
      const updatedDate = updateTimestamp ? new Date(updateTimestamp) : null;
      const updatedDateStr = updatedDate ? updatedDate.toLocaleDateString() : '';
      const updatedTimeStr = updatedDate ? updatedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const updatedRelative = formatRelativeTime(updateTimestamp);
      const updatedDisplay = updatedDate
        ? `${updatedDateStr}, ${updatedTimeStr} · ${updatedRelative}`
        : 'Desconocido';

      const createdTimestamp = conv.createdAt;
      const createdDate = createdTimestamp ? new Date(createdTimestamp) : null;
      const createdDateStr = createdDate ? createdDate.toLocaleDateString() : '';
      const createdTimeStr = createdDate ? createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const createdRelative = formatRelativeTime(createdTimestamp);
      const createdDisplay = createdDate
        ? `${createdDateStr}, ${createdTimeStr} · ${createdRelative}`
        : null;

      if (isClip) {
        if (titleElem) titleElem.textContent = conv.title || 'Detalles del Clip';
        const sourceStatus = conv.provenance?.sourceStatus || conv.sourceStatus || 'source_available_locally';
        const sourceStatusLabel = sourceStatus === 'source_unavailable_locally'
          ? '<span class="badge badge-partial" style="font-size: 11px;">Fuente eliminada localmente (Clip preservado)</span>'
          : '<span class="badge badge-captured" style="font-size: 11px;">Fuente disponible localmente</span>';

        const sourceTitle = conv.sourceConversationTitle || conv.provenance?.sourceConversation || 'Conversación Origen';
        const rawSelectionType = conv.selectionType || 'multi-message';
        const selectionTypeMap = {
          'contiguous-range': 'Rango continuo',
          'discontinuous-selection': 'Selección discontinua',
          'single-message': 'Mensaje único',
          'turn-pair': 'Par de turnos',
          'multi-message': 'Múltiples mensajes'
        };
        const friendlySelectionType = selectionTypeMap[rawSelectionType] || rawSelectionType;

        let clipModel = conv.model || conv.sourceModel || null;
        if (!clipModel && conv.sourceConversationCanonicalId && Array.isArray(currentLoadedConversations)) {
          const parentMatch = currentLoadedConversations.find(c => c.canonicalId === conv.sourceConversationCanonicalId || c.id === conv.sourceConversationCanonicalId);
          if (parentMatch && parentMatch.model) {
            clipModel = parentMatch.model;
          }
        }
        const clipModelDisplay = clipModel ? escapeHtml(clipModel) : '—';
        const sourcePlatform = escapeHtml(String(conv.sourcePlatform || conv.source?.platform || 'ChatGPT').toUpperCase());
        const messagesCount = (conv.selectedMessages || []).length;

        const clipMessagesList = (conv.selectedMessages || []).map((m, idx) => `
          <div style="border-bottom: 1px solid var(--border-subtle); padding: 8px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">${escapeHtml(m.author || m.role || 'Mensaje')}</span>
              <span style="font-size: 10px; color: var(--text-tertiary);">Turno #${idx + 1}</span>
            </div>
            <p style="font-size: 12px; margin-top: 4px; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(m.content?.text || m.text || '')}</p>
          </div>
        `).join('');

        body.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
            <div><span style="color: var(--text-tertiary)">Tipo:</span> <strong style="color: #58a6ff;">CLIP (Contexto Selectivo)</strong></div>
            <div><span style="color: var(--text-tertiary)">Plataforma · Modelo:</span> <strong>${sourcePlatform} · <code>${clipModelDisplay}</code></strong></div>
            <div><span style="color: var(--text-tertiary)">Conversación Origen:</span> <strong>${escapeHtml(sourceTitle)}</strong></div>
            <div><span style="color: var(--text-tertiary)">Procedencia:</span> ${sourceStatusLabel}</div>
            <div><span style="color: var(--text-tertiary)">Selección:</span> <span>${escapeHtml(friendlySelectionType)} (${messagesCount} turnos)</span></div>
            <div><span style="color: var(--text-tertiary)">Actualizado:</span> <span>${updatedDisplay}</span></div>
            <div class="inspector-collections-card">
              <div class="inspector-collections-header">Proyectos</div>
              ${collectionsSectionHtml}
            </div>
          </div>

          <details class="inspector-technical-details">
            <summary style="cursor: pointer; font-size: 11.5px; color: var(--text-secondary); font-weight: 500; user-select: none;">Información técnica y procedencia</summary>
            <div class="inspector-technical-content">
              <div><span style="color: var(--text-tertiary)">ID del Clip:</span> <code style="font-family: var(--font-mono); font-size: 10.5px;">${escapeHtml(activeId)}</code></div>
              <div><span style="color: var(--text-tertiary)">ID Conversación Origen:</span> <code style="font-family: var(--font-mono); font-size: 10.5px;">${escapeHtml(conv.sourceConversationCanonicalId || conv.provenance?.sourceConversationCanonicalId || '—')}</code></div>
              <div><span style="color: var(--text-tertiary)">Tipo de Selección Interno:</span> <code>${escapeHtml(rawSelectionType)}</code></div>
              <div><span style="color: var(--text-tertiary)">Orden de Mensajes:</span> <span>Cronológico estricto</span></div>
              <div><span style="color: var(--text-tertiary)">Integridad del Clip:</span> <span class="badge badge-captured" style="font-size: 10px;">${escapeHtml(conv.integrity?.clipSelectionIntegrity || 'complete')}</span></div>
              ${createdDisplay ? `<div><span style="color: var(--text-tertiary)">Capturado originalmente:</span> <span>${createdDisplay}</span></div>` : ''}
            </div>
          </details>

          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center;">
            <button id="btn-inspector-full-reader" class="btn btn-secondary btn-sm" type="button" style="display: inline-flex; align-items: center; gap: 4px;">⤢ Vista completa</button>
            <button id="btn-inspector-export-menu" class="btn btn-secondary btn-sm" type="button">Exportar</button>
            <button id="btn-inspector-delete" class="btn btn-danger-subtle btn-sm" type="button">Eliminar Clip</button>
            <!-- Compatibilidad con tests -->
            <div style="display: none;" aria-hidden="true">
              <button id="btn-inspector-coll" type="button">Gestionar Proyectos</button>
              <button id="btn-inspector-md" type="button">Exportar .md</button>
              <button id="btn-inspector-json" type="button">Exportar .json</button>
            </div>
          </div>

          <div style="margin-top: 14px;">
            <h4 style="font-size: 12px; margin-bottom: 8px; color: var(--text-secondary);">Mensajes del Clip (${messagesCount} turnos)</h4>
            <div id="inspector-messages-container" style="max-height: 340px; overflow-y: auto; border: 1px solid var(--border-subtle); padding: 8px 12px; border-radius: var(--radius-sm); background: var(--bg-base);">
              ${clipMessagesList || '<p style="color: var(--text-tertiary); font-size: 12px;">Sin mensajes en el clip.</p>'}
            </div>
          </div>
        `;

        const btnColl = document.getElementById('btn-inspector-coll');
        const btnAddCol = document.getElementById('btn-inspector-add-col');
        const btnExportMenu = document.getElementById('btn-inspector-export-menu');
        const btnFullReader = document.getElementById('btn-inspector-full-reader');
        const btnMd = document.getElementById('btn-inspector-md');
        const btnJson = document.getElementById('btn-inspector-json');
        const btnDelete = document.getElementById('btn-inspector-delete');

        if (btnFullReader) btnFullReader.addEventListener('click', (e) => { e.stopPropagation(); openFullReader(activeId); });
        const btnOpenHeaderFullReader = document.getElementById('btn-open-full-reader');
        if (btnOpenHeaderFullReader) btnOpenHeaderFullReader.onclick = (e) => { e.stopPropagation(); openFullReader(activeId); };
        if (btnColl) btnColl.addEventListener('click', (e) => { e.stopPropagation(); openCollectionPicker([activeId]); });
        if (btnAddCol) {
          btnAddCol.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openCollectionPicker([activeId]);
            await openInspector(activeId);
          });
        }
        if (btnMd) btnMd.addEventListener('click', (e) => { e.stopPropagation(); exportSingleMarkdown(activeId); });
        if (btnJson) btnJson.addEventListener('click', (e) => { e.stopPropagation(); exportSingleJson(activeId); });
        if (btnExportMenu) {
          btnExportMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            openExportCenterModal([activeId]);
          });
        }
        if (btnDelete) btnDelete.addEventListener('click', (e) => { e.stopPropagation(); promptDeleteConversation(activeId); });

        // Enlazar botones de desasignación rápida de proyecto (chip-remove)
        body.querySelectorAll('.chip-remove').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const colId = btn.dataset.colId;
            const colName = btn.dataset.colName || 'el proyecto';
            if (!colId) return;
            const res = await db.removeConversationFromCollection(colId, activeId);
            if (res && res.success) {
              await openInspector(activeId);
              await updateAllCounts();
              showToast(`Elemento quitado de "${colName}".`, {
                actionLabel: 'Deshacer',
                onAction: async () => {
                  await db.addConversationsToCollection(colId, [activeId]);
                  await openInspector(activeId);
                  await updateAllCounts();
                  showToast(`Elemento reincorporado a "${colName}".`);
                }
              });
            }
          });
        });

        if (options.openMessages) {
          const msgContainer = document.getElementById('inspector-messages-container');
          if (msgContainer) msgContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      // Vista para Conversación Estructurada
      if (titleElem) titleElem.textContent = conv.title || 'Detalles';

      const warningsHtml = (conv.integrity?.warnings && conv.integrity.warnings.length > 0)
        ? `<div style="background: rgba(253, 214, 99, 0.12); border: 1px solid var(--accent-amber); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 11.5px; line-height: 1.45;">
             <strong style="color: var(--accent-amber);">Avisos de Integridad:</strong><br>${escapeHtml(conv.integrity.warnings.join('; '))}
           </div>`
        : (conv.integrity?.status === 'partial'
            ? `<div style="background: rgba(253, 214, 99, 0.12); border: 1px solid var(--accent-amber); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 11.5px; line-height: 1.45;">
                 <strong style="color: var(--accent-amber);">Captura Parcial:</strong> Parte del historial previo no estuvo visible en el DOM. Puedes reanudar o actualizar la captura con la conversación abierta en ChatGPT.
               </div>`
            : '');

      const originUrl = conv.source?.url || (conv.source?.conversationId ? `https://chatgpt.com/c/${conv.source.conversationId}` : null);
      const originBtnHtml = originUrl
        ? `<button id="btn-inspector-open-origin" class="btn btn-secondary btn-sm" type="button" data-url="${escapeHtml(originUrl)}" style="display: inline-flex; align-items: center; gap: 4px;">Abrir origen &rarr;</button>`
        : `<button id="btn-inspector-open-origin" class="btn btn-secondary btn-sm" type="button" disabled title="Sin URL de origen">Abrir origen</button>`;

      const safeNum = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? Math.floor(v) : 0;
      const convMsgCount = conv.conversationMessageCount !== undefined
        ? safeNum(conv.conversationMessageCount)
        : (conv.visibleMessageCount !== undefined ? safeNum(conv.visibleMessageCount) : (conv.messages?.length || 0));
      const sourceNodes = safeNum(conv.sourceNodeCount) || (conv.messages?.length || 0);
      const nodesBreakdown = conv.nodeMetrics ? `
        <div><span style="color: var(--text-tertiary)">Nodos de Usuario:</span> <span>${safeNum(conv.nodeMetrics.userNodes ?? conv.nodeMetrics.userMessageCount)}</span></div>
        <div><span style="color: var(--text-tertiary)">Nodos de Asistente:</span> <span>${safeNum(conv.nodeMetrics.assistantNodes ?? conv.nodeMetrics.assistantMessageCount)}</span></div>
        <div><span style="color: var(--text-tertiary)">Nodos de Herramientas/Acciones:</span> <span>${safeNum(conv.nodeMetrics.toolNodes ?? conv.nodeMetrics.toolEventCount)}</span></div>
        <div><span style="color: var(--text-tertiary)">Nodos de Sistema:</span> <span>${safeNum(conv.nodeMetrics.systemNodes ?? conv.nodeMetrics.systemNodeCount)}</span></div>
      ` : '';

      const rawMessages = conv.messages || [];
      const technicalNodesCount = rawMessages.filter(m => m.isConversational === false || m.nodeCategory === 'tool' || m.nodeCategory === 'system' || m.role === 'tool' || m.role === 'system').length;

      const platformDisplay = escapeHtml(String(conv.source?.platform || 'ChatGPT').toUpperCase());
      const modelDisplay = conv.model ? escapeHtml(conv.model) : '—';

      body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
          <div><span style="color: var(--text-tertiary)">Plataforma · Modelo:</span> <strong>${platformDisplay} · <code>${modelDisplay}</code></strong></div>
          <div><span style="color: var(--text-tertiary)">Mensajes:</span> <strong>${convMsgCount} de conversación</strong> ${sourceNodes > convMsgCount ? `<span style="color: var(--text-tertiary); font-size: 11px;">(${sourceNodes} nodos en árbol)</span>` : ''}</div>
          <div><span style="color: var(--text-tertiary)">Integridad:</span> <span class="badge ${getBadgeClass(conv.integrity?.status)}">${escapeHtml(formatIntegrity(conv.integrity?.status))}</span></div>
          <div><span style="color: var(--text-tertiary)">Actualizado:</span> <span>${escapeHtml(updatedDisplay)}</span></div>
          <div class="inspector-collections-card">
            <div class="inspector-collections-header">Proyectos</div>
            ${collectionsSectionHtml}
          </div>
        </div>

        ${warningsHtml}

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center;">
          <button id="btn-inspector-full-reader" class="btn btn-secondary btn-sm" type="button" style="display: inline-flex; align-items: center; gap: 4px;">⤢ Vista completa</button>
          <button id="btn-inspector-view-messages" class="btn btn-primary btn-sm" type="button">Abrir mensajes</button>
          <button id="btn-inspector-export-menu" class="btn btn-secondary btn-sm" type="button">Exportar</button>
          ${originBtnHtml}
          <button id="btn-inspector-more" class="btn btn-ghost btn-sm" type="button" title="Más opciones">⋯</button>
          <!-- Controles preservados para compatibilidad con suites de prueba -->
          <div style="display: none;" aria-hidden="true">
            <button id="btn-inspector-create-clip" type="button">Crear Clip</button>
            <button id="btn-inspector-capture" type="button">Actualizar captura</button>
            <button id="btn-inspector-md" type="button">Exportar .md</button>
            <button id="btn-inspector-json" type="button">Exportar .json</button>
            <button id="btn-inspector-delete" type="button">Eliminar de Lossy</button>
            <button id="btn-inspector-coll" type="button">Gestionar Proyectos</button>
          </div>
        </div>

        <details class="inspector-technical-details">
          <summary style="cursor: pointer; font-size: 11.5px; color: var(--text-secondary); font-weight: 500; user-select: none;">Información técnica y procedencia</summary>
          <div class="inspector-technical-content">
            <div><span style="color: var(--text-tertiary)">ID Canónico:</span> <code style="font-family: var(--font-mono); font-size: 10.5px;">${escapeHtml(activeId)}</code></div>
            <div><span style="color: var(--text-tertiary)">Método de Adquisición:</span> <span>${escapeHtml(conv.source?.acquisitionMethod || 'dom-harvest')}</span></div>
            ${conv.source?.conversationId ? `<div><span style="color: var(--text-tertiary)">ID de Origen:</span> <code>${escapeHtml(conv.source.conversationId)}</code></div>` : ''}
            <div><span style="color: var(--text-tertiary)">Nodos de origen DAG:</span> <span>${sourceNodes}</span></div>
            <div><span style="color: var(--text-tertiary)">Mensajes conversacionales:</span> <span>${convMsgCount}</span></div>
            <div><span style="color: var(--text-tertiary)">Eventos técnicos / adicionales:</span> <span>${technicalNodesCount}</span></div>
            ${nodesBreakdown}
            ${createdDisplay ? `<div><span style="color: var(--text-tertiary)">Capturado originalmente:</span> <span>${createdDisplay}</span></div>` : ''}
          </div>
        </details>

        <div id="inspector-messages-section" style="margin-top: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h4 id="inspector-messages-heading" style="font-size: 12px; margin: 0; color: var(--text-secondary);">Mensajes (${convMsgCount} turnos conversacionales)</h4>
              ${technicalNodesCount > 0 ? `
                <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--text-secondary); user-select: none;">
                  <input type="checkbox" id="toggle-technical-events">
                  <span>Mostrar eventos técnicos (${technicalNodesCount})</span>
                </label>
              ` : ''}
              <button id="btn-select-all-turns" class="btn btn-ghost btn-sm" type="button" style="font-size: 10.5px; padding: 2px 6px;">Seleccionar todos</button>
              <button id="btn-clear-turn-selection" class="btn btn-ghost btn-sm" type="button" style="font-size: 10.5px; padding: 2px 6px;">Limpiar</button>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span id="clip-msg-counter" style="font-size: 11px; color: var(--text-tertiary);">Selecciona turnos para Guardar como Clip</span>
              <button id="btn-inspector-save-clip" class="btn btn-primary btn-sm" type="button" style="display: none; font-size: 11px; padding: 3px 8px;">Guardar como Clip</button>
            </div>
          </div>
          <div id="inspector-messages-container" style="max-height: 280px; overflow-y: auto; border: 1px solid var(--border-subtle); padding: 8px 12px; border-radius: var(--radius-sm); background: var(--bg-base);">
          </div>
        </div>
      `;

      const btnColl = document.getElementById('btn-inspector-coll');
      const btnAddCol = document.getElementById('btn-inspector-add-col');
      const btnCapture = document.getElementById('btn-inspector-capture');
      const btnMd = document.getElementById('btn-inspector-md');
      const btnJson = document.getElementById('btn-inspector-json');
      const btnDelete = document.getElementById('btn-inspector-delete');
      const btnCreateClip = document.getElementById('btn-inspector-create-clip');
      const btnSaveClip = document.getElementById('btn-inspector-save-clip');
      const btnViewMessages = document.getElementById('btn-inspector-view-messages');
      const btnFullReader = document.getElementById('btn-inspector-full-reader');
      const btnExportMenu = document.getElementById('btn-inspector-export-menu');

      if (btnFullReader) btnFullReader.addEventListener('click', (e) => { e.stopPropagation(); openFullReader(activeId); });
      const btnHeaderFullReader = document.getElementById('btn-open-full-reader');
      if (btnHeaderFullReader) btnHeaderFullReader.onclick = (e) => { e.stopPropagation(); openFullReader(activeId); };
      const btnMore = document.getElementById('btn-inspector-more');
      const btnOpenOrigin = document.getElementById('btn-inspector-open-origin');
      const counterLabel = document.getElementById('clip-msg-counter');
      const btnSelectAllTurns = document.getElementById('btn-select-all-turns');
      const btnClearTurnSelection = document.getElementById('btn-clear-turn-selection');
      const toggleTech = document.getElementById('toggle-technical-events');

      let lastCheckedTurnIndex = null;

      function updateTurnCounter() {
        const checked = body.querySelectorAll('.clip-turn-cb:checked').length;
        if (counterLabel) {
          counterLabel.textContent = checked > 0 ? `${formatCount(checked, 'turno seleccionado', 'turnos seleccionados')}` : 'Selecciona turnos para Guardar como Clip';
        }
        if (btnSaveClip) {
          if (checked > 0) {
            btnSaveClip.style.display = 'inline-flex';
            btnSaveClip.textContent = `Guardar como Clip (${checked})`;
          } else {
            btnSaveClip.style.display = 'none';
          }
        }
        if (btnCreateClip) {
          btnCreateClip.textContent = checked > 0 ? `Guardar como Clip (${checked})` : 'Crear Clip';
        }
      }

      function bindTurnCheckboxes() {
        const turnCbs = Array.from(body.querySelectorAll('.clip-turn-cb'));
        turnCbs.forEach((cb, idx) => {
          cb.addEventListener('click', (e) => {
            if (e.shiftKey && lastCheckedTurnIndex !== null && lastCheckedTurnIndex !== idx) {
              const start = Math.min(lastCheckedTurnIndex, idx);
              const end = Math.max(lastCheckedTurnIndex, idx);
              const targetState = cb.checked;
              for (let i = start; i <= end; i++) {
                if (turnCbs[i]) turnCbs[i].checked = targetState;
              }
            }
            lastCheckedTurnIndex = idx;
            updateTurnCounter();
          });
        });
        updateTurnCounter();
      }

      function renderInspectorMessages(includeTechnical = false) {
        const container = document.getElementById('inspector-messages-container');
        const headingElem = document.getElementById('inspector-messages-heading');
        if (headingElem) {
          if (includeTechnical) {
            headingElem.textContent = `Todos los nodos (${rawMessages.length} elementos: ${convMsgCount} mensajes + ${technicalNodesCount} eventos técnicos)`;
          } else {
            headingElem.textContent = `Mensajes (${convMsgCount} turnos conversacionales)`;
          }
        }
        if (!container) return;

        const filteredMessages = rawMessages.filter(m => {
          if (includeTechnical) return true;
          return m.isConversational !== false && m.nodeCategory !== 'tool' && m.nodeCategory !== 'system' && m.role !== 'tool' && m.role !== 'system';
        });

        if (filteredMessages.length === 0) {
          container.innerHTML = '<p style="color: var(--text-tertiary); font-size: 12px;">Sin mensajes para mostrar.</p>';
          return;
        }

        container.innerHTML = filteredMessages.map((m) => {
          const isTech = m.isConversational === false || m.nodeCategory === 'tool' || m.nodeCategory === 'system' || m.role === 'tool' || m.role === 'system';
          const originalIdx = rawMessages.indexOf(m);
          const authorDisplay = m.author || m.role || 'Mensaje';
          const textContent = m.content?.text || m.text || '';

          if (isTech) {
            return `
              <div class="tech-event-item" style="border-bottom: 1px solid var(--border-subtle); padding: 8px 0; background: rgba(0, 0, 0, 0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span class="tech-event-badge" style="font-size: 10px; font-family: var(--font-mono); font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">${escapeHtml(m.nodeCategory || m.role || 'Herramienta')}</span>
                  <span style="font-size: 10px; color: var(--text-tertiary);">Nodo #${originalIdx + 1}</span>
                </div>
                <pre class="reader-code-box" style="margin-top: 4px; font-family: var(--font-mono); font-size: 11px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; background: var(--bg-surface); padding: 6px; border-radius: 4px; border: 1px solid var(--border-subtle);"><code>${escapeHtml(textContent)}</code></pre>
              </div>
            `;
          }

          return `
            <div style="border-bottom: 1px solid var(--border-subtle); padding: 8px 0; display: flex; gap: 8px; align-items: flex-start;">
              <input type="checkbox" class="clip-turn-cb" data-idx="${originalIdx}" style="margin-top: 4px;" aria-label="Seleccionar mensaje ${originalIdx + 1}">
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">${escapeHtml(authorDisplay)}</span>
                  <span style="font-size: 10px; color: var(--text-tertiary);">Turno #${originalIdx + 1}</span>
                </div>
                <p style="font-size: 12px; margin-top: 2px; max-height: 100px; overflow-y: auto; line-height: 1.4; white-space: pre-wrap;">${escapeHtml(textContent)}</p>
              </div>
            </div>
          `;
        }).join('');

        bindTurnCheckboxes();
      }

      renderInspectorMessages(false);

      if (toggleTech) {
        toggleTech.addEventListener('change', (e) => {
          renderInspectorMessages(e.target.checked);
        });
      }

      if (btnSelectAllTurns) {
        btnSelectAllTurns.addEventListener('click', (e) => {
          e.stopPropagation();
          const turnCbs = Array.from(body.querySelectorAll('.clip-turn-cb'));
          turnCbs.forEach(cb => { cb.checked = true; });
          updateTurnCounter();
        });
      }

      if (btnClearTurnSelection) {
        btnClearTurnSelection.addEventListener('click', (e) => {
          e.stopPropagation();
          const turnCbs = Array.from(body.querySelectorAll('.clip-turn-cb'));
          turnCbs.forEach(cb => { cb.checked = false; });
          lastCheckedTurnIndex = null;
          updateTurnCounter();
        });
      }

      if (btnViewMessages) {
        btnViewMessages.addEventListener('click', (e) => {
          e.stopPropagation();
          const msgSection = document.getElementById('inspector-messages-section');
          if (msgSection) msgSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }

      if (btnOpenOrigin) {
        btnOpenOrigin.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = btnOpenOrigin.dataset.url;
          if (url) {
            window.open(url, '_blank');
          } else {
            showToast('No hay URL de origen registrada para esta conversación.');
          }
        });
      }

      if (btnExportMenu) {
        btnExportMenu.addEventListener('click', (e) => {
          e.stopPropagation();
          openExportCenterModal([activeId]);
        });
      }

      if (btnMore) {
        btnMore.addEventListener('click', (e) => {
          e.stopPropagation();
          const rect = btnMore.getBoundingClientRect();
          showContextMenu(rect.left, rect.bottom + 4, [
            { label: 'Actualizar captura', onClick: () => startSingleCapture(activeId) },
            { label: 'Añadir a Proyecto', onClick: async () => {
              await openCollectionPicker([activeId]);
              await openInspector(activeId);
            }},
            { isDivider: true },
            { label: 'Eliminar de Lossy', isDanger: true, onClick: () => promptDeleteConversation(activeId) }
          ]);
        });
      }

      const triggerCreateClip = () => {
        const checkedCbs = Array.from(body.querySelectorAll('.clip-turn-cb:checked'));
        const selectedIndices = checkedCbs.map(cb => parseInt(cb.dataset.idx, 10));
        promptCreateClip(conv, selectedIndices);
      };

      if (btnSaveClip) {
        btnSaveClip.addEventListener('click', triggerCreateClip);
      }
      if (btnCreateClip) {
        btnCreateClip.addEventListener('click', triggerCreateClip);
      }

      if (btnColl) {
        btnColl.addEventListener('click', (e) => { e.stopPropagation(); openCollectionPicker([activeId]); });
      }
      if (btnAddCol) {
        btnAddCol.addEventListener('click', async (e) => {
          e.stopPropagation();
          await openCollectionPicker([activeId]);
          await openInspector(activeId);
        });
      }
      if (btnCapture) {
        btnCapture.addEventListener('click', (e) => { e.stopPropagation(); startSingleCapture(activeId); });
      }
      if (btnMd) {
        btnMd.addEventListener('click', (e) => { e.stopPropagation(); exportSingleMarkdown(activeId); });
      }
      if (btnJson) {
        btnJson.addEventListener('click', (e) => { e.stopPropagation(); exportSingleJson(activeId); });
      }
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => { e.stopPropagation(); promptDeleteConversation(activeId); });
      }

      // Enlazar botones de desasignación rápida de proyecto (chip-remove)
      body.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const colId = btn.dataset.colId;
          const colName = btn.dataset.colName || 'el proyecto';
          if (!colId) return;
          const res = await db.removeConversationFromCollection(colId, activeId);
          if (res && res.success) {
            await openInspector(activeId);
            await updateAllCounts();
            showToast(`Elemento quitado de "${colName}".`, {
              actionLabel: 'Deshacer',
              onAction: async () => {
                await db.addConversationsToCollection(colId, [activeId]);
                await openInspector(activeId);
                await updateAllCounts();
                showToast(`Elemento reincorporado a "${colName}".`);
              }
            });
          }
        });
      });

      if (options.openMessages) {
        const msgContainer = document.getElementById('inspector-messages-container');
        if (msgContainer) {
          msgContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

    } catch (err) {
      body.innerHTML = `<p style="color: var(--accent-red)">Error al inspeccionar: ${escapeHtml(err.message)}</p>`;
    }
  }

  // --- CREACIÓN DETERMINISTA DE CLIPS (SELECTIVE CONTEXT) ---

  async function promptCreateClip(conv, selectedIndices = []) {
    if (!conv) return;
    const allMessages = conv.messages || [];
    if (allMessages.length === 0) {
      showToast('Esta conversación no contiene mensajes para extraer clips.');
      return;
    }

    let indices = selectedIndices;
    if (!indices || indices.length === 0) {
      indices = allMessages.map((_, i) => i);
    }

    const selectedMessages = indices.map(i => allMessages[i]).filter(Boolean);
    const count = selectedMessages.length;
    const defaultTitle = `Clip: ${conv.title || 'Conversación'} (${formatCount(count, 'mensaje', 'mensajes')})`;

    const db = getLinerDb();
    let collections = [];
    if (db) {
      try {
        collections = await db.listCollections();
      } catch (_) {}
    }

    const previewListHtml = selectedMessages.slice(0, 5).map((m, idx) => `
      <div style="border-bottom: 1px solid var(--border-subtle); padding: 4px 0; font-size: 11.5px;">
        <strong style="color: var(--text-secondary); text-transform: uppercase;">${escapeHtml(m.author || m.role || 'Mensaje')}:</strong>
        <span style="color: var(--text-tertiary);">${escapeHtml((m.content?.text || m.text || '').substring(0, 80))}...</span>
      </div>
    `).join('');

    const modalHtml = `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <p style="font-size: 12px; color: var(--text-secondary);">
          Crea una unidad atómica y selectiva de contexto preservando su orden cronológico y procedencia contra orfandad.
        </p>

        <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary);">Título del Clip:</label>
        <input type="text" id="modal-clip-title" class="search-input" value="${escapeHtml(defaultTitle)}" style="width: 100%;">

        <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary); margin-top: 4px;">Notas o Resumen del Clip (opcional):</label>
        <input type="text" id="modal-clip-notes" class="search-input" placeholder="Ej. Solución de arquitectura, snippet clave..." style="width: 100%;">

        <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary); margin-top: 4px;">Asignar a Proyecto (opcional):</label>
        <select id="modal-clip-col-select" class="select-input" style="width: 100%;">
          <option value="">Ningún proyecto</option>
          ${collections.map(c => `<option value="${escapeHtml(c.collectionId)}">${escapeHtml(c.name)}</option>`).join('')}
          <option value="__NEW__">+ Nuevo proyecto...</option>
        </select>
        <div id="modal-clip-new-col-wrapper" style="display: none; margin-top: 6px;">
          <input type="text" id="modal-clip-new-col-name" class="search-input" placeholder="Nombre del nuevo proyecto..." style="width: 100%;">
        </div>

        <div style="margin-top: 6px;">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Turnos seleccionados (${count}):</span>
          <div style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-subtle); padding: 6px 10px; border-radius: var(--radius-sm); background: var(--bg-base); margin-top: 4px;">
            ${previewListHtml}
            ${count > 5 ? `<p style="font-size: 10.5px; color: var(--text-tertiary); margin-top: 4px;">...y ${count - 5} turnos más</p>` : ''}
          </div>
        </div>
      </div>
    `;

    const confirmed = await showModal({
      title: 'Crear Clip de Contexto',
      bodyHtml: modalHtml,
      confirmText: 'Crear Clip',
      cancelText: 'Cancelar',
      onRender: (bodyElem) => {
        const select = bodyElem.querySelector('#modal-clip-col-select');
        const wrapper = bodyElem.querySelector('#modal-clip-new-col-wrapper');
        const input = bodyElem.querySelector('#modal-clip-new-col-name');
        if (select && wrapper) {
          select.addEventListener('change', () => {
            if (select.value === '__NEW__') {
              wrapper.style.display = 'block';
              if (input) input.focus();
            } else {
              wrapper.style.display = 'none';
            }
          });
        }
      }
    });

    if (!confirmed) return;

    const title = (document.getElementById('modal-clip-title')?.value || defaultTitle).trim();
    const notes = (document.getElementById('modal-clip-notes')?.value || '').trim();
    const targetColId = document.getElementById('modal-clip-col-select')?.value || null;

    let finalColId = targetColId;
    if (targetColId === '__NEW__') {
      const newColName = (document.getElementById('modal-clip-new-col-name')?.value || '').trim();
      if (newColName && db) {
        try {
          const createdCol = await db.createCollection(newColName);
          if (createdCol) {
            finalColId = createdCol.id || createdCol.collectionId;
            await renderSidebarCollections();
          }
        } catch (_) {
          finalColId = null;
        }
      } else {
        finalColId = null;
      }
    }

    let clipFactory = (window.Lossy && typeof window.Lossy.createCanonicalClip === 'function' ? window.Lossy.createCanonicalClip : null) ||
                      (window.Lossy && window.Lossy.CanonicalModel && typeof window.Lossy.CanonicalModel.createCanonicalClip === 'function' ? window.Lossy.CanonicalModel.createCanonicalClip : null) ||
                      (window.Liner && typeof window.Liner.createCanonicalClip === 'function' ? window.Liner.createCanonicalClip : null) ||
                      (window.Liner && window.Liner.CanonicalModel && typeof window.Liner.CanonicalModel.createCanonicalClip === 'function' ? window.Liner.CanonicalModel.createCanonicalClip : null) ||
                      (typeof createCanonicalClip === 'function' ? createCanonicalClip : null);

    if (!clipFactory) {
      showToast('Error: Motor de creación de Clips no disponible en memoria.');
      return;
    }

    try {
      const clip = clipFactory({
        sourceConversation: conv,
        selectedMessages,
        title,
        notes
      });

      if (db) {
        await db.saveClip(clip);
        if (finalColId) {
          await db.addConversationsToCollection(finalColId, [clip.canonicalId]);
        }
      }

      await loadLibraryData();
      await updateAllCounts();

      showToast(`Clip "${clip.title}" creado con éxito.`);
      await openInspector(clip.canonicalId);
    } catch (err) {
      console.error('Error al crear clip:', err);
      showToast(`Error al crear clip: ${err.message}`);
    }
  }

  // --- VISTA AMPLIADA / FULL READER WORKBENCH (P1) ---

  let currentFullReaderEntity = null;
  let readerPreviousFocus = null;
  let fullReaderSelectedIndices = new Set();
  let fullReaderLastCheckedIndex = null;

  async function openFullReader(canonicalId) {
    const overlay = document.getElementById('full-reader-overlay');
    if (!overlay) return;

    const db = getLinerDb();
    let entity = null;
    if (db) {
      entity = await db.getConversation(canonicalId);
      if (!entity && typeof db.getClip === 'function') {
        entity = await db.getClip(canonicalId);
      }
    }
    if (!entity && Array.isArray(currentLoadedConversations)) {
      entity = currentLoadedConversations.find(c => c.canonicalId === canonicalId || c.id === canonicalId);
    }
    if (!entity) {
      showToast('No se encontró la conversación o clip para el lector.');
      return;
    }

    if (overlay.classList.contains('hidden')) readerPreviousFocus = document.activeElement;
    currentFullReaderEntity = entity;
    fullReaderSelectedIndices.clear();
    fullReaderLastCheckedIndex = null;

    const titleElem = document.getElementById('full-reader-title');
    const platformElem = document.getElementById('full-reader-platform');
    const modelElem = document.getElementById('full-reader-model');
    const countElem = document.getElementById('full-reader-msg-count');
    const techToggle = document.getElementById('full-reader-toggle-tech');
    const searchInput = document.getElementById('full-reader-search');

    if (titleElem) titleElem.textContent = entity.title || 'Conversación';
    if (platformElem) platformElem.textContent = (entity.source?.platform || entity.sourcePlatform || 'ChatGPT').toUpperCase();
    if (modelElem) modelElem.textContent = entity.model || entity.sourceModel || 'Estándar';

    const rawMessages = Array.isArray(entity.selectedMessages) ? entity.selectedMessages : (Array.isArray(entity.messages) ? entity.messages : []);
    const convCount = entity.conversationMessageCount !== undefined
      ? entity.conversationMessageCount
      : (entity.visibleMessageCount !== undefined ? entity.visibleMessageCount : rawMessages.filter(m => m.isConversational !== false && m.role !== 'tool' && m.role !== 'system').length);
    if (countElem) countElem.textContent = `${convCount} ${convCount === 1 ? 'mensaje' : 'mensajes'}`;

    if (searchInput) searchInput.value = '';
    if (techToggle) techToggle.checked = false;

    // Mostrar overlay de forma inmediata
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    renderFullReaderSidebar(entity.canonicalId || canonicalId);
    renderFullReaderStream(entity);
    document.getElementById('btn-full-reader-close')?.focus();
  }

  function closeFullReader() {
    const overlay = document.getElementById('full-reader-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
      const searchInput = document.getElementById('full-reader-search');
      if (searchInput) searchInput.value = '';
      const searchCountElem = document.getElementById('full-reader-search-count');
      if (searchCountElem) searchCountElem.classList.add('hidden');
      if (readerPreviousFocus?.isConnected) readerPreviousFocus.focus();
    }
  }

  function renderFullReaderSidebar(activeId) {
    const listElem = document.getElementById('full-reader-conv-list');
    const countBadge = document.getElementById('full-reader-sidebar-count');
    if (!listElem) return;

    const list = Array.isArray(currentLoadedConversations) ? currentLoadedConversations : [];
    if (countBadge) countBadge.textContent = list.length;

    listElem.innerHTML = list.map(item => {
      const id = item.canonicalId || item.id;
      const isActive = id === activeId;
      const isClip = item.entityType === 'clip' || (id && id.startsWith('clip_'));
      const prefix = isClip ? '[CLIP] ' : '';
      return `
        <div class="full-reader-conv-item ${isActive ? 'active' : ''}" data-id="${escapeHtml(id)}" title="${escapeHtml(item.title || id)}">
          ${prefix}${escapeHtml(item.title || id)}
        </div>
      `;
    }).join('');

    listElem.querySelectorAll('.full-reader-conv-item').forEach(el => {
      el.addEventListener('click', () => {
        const targetId = el.dataset.id;
        if (targetId) openFullReader(targetId);
      });
    });
  }

  function renderFullReaderStream(entity, options = {}) {
    const stream = document.getElementById('full-reader-stream');
    const searchCountElem = document.getElementById('full-reader-search-count');
    if (!stream) return;

    try {
      if (!entity) {
        stream.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary);">
            <p style="font-size: 14px;">No hay conversación o clip seleccionado.</p>
          </div>
        `;
        updateFullReaderSelectionUi();
        return;
      }

      const includeTechnical = Boolean(options.includeTechnicalEvents);
      const searchQuery = (options.searchQuery || '').trim().toLowerCase();

      const rawMessages = Array.isArray(entity.selectedMessages) ? entity.selectedMessages : (Array.isArray(entity.messages) ? entity.messages : []);
      
      let filtered = rawMessages.filter(m => {
        if (!m) return false;
        if (includeTechnical) return true;
        const rawT = String(m.text ?? m.content?.text ?? '').trim();
        if (m.role !== 'user' && /^\{[\s\S]*"path"\s*:\s*"\/Automations\//i.test(rawT)) return false;
        return m.isConversational !== false && m.nodeCategory !== 'tool' && m.nodeCategory !== 'system' && m.role !== 'tool' && m.role !== 'system';
      });

      const readerAssets=window.Lossy.ExportCenter.AssetResolver.resolveAssetsForEntity(entity),readerAssetMap=new Map();
      for(const asset of readerAssets){const bytes=asset.data instanceof Uint8Array?asset.data:Array.isArray(asset.data)?new Uint8Array(asset.data):null;if(bytes){readerAssetMap.set(asset.assetId,bytes);readerAssetMap.set(asset.filename,bytes);}}
      let matchCount = 0;
      const matchingOriginalIndices = new Set();
      if (searchQuery) {
        filtered.forEach((m) => {
          const text = extractMessageText(m).toLowerCase();
          const role = (m.role || '').toLowerCase();
          const author = (m.author || '').toLowerCase();
          const matched = text.includes(searchQuery) || role.includes(searchQuery) || author.includes(searchQuery);
          if (matched) {
            matchCount++;
            matchingOriginalIndices.add(rawMessages.indexOf(m));
          }
        });
        if (searchCountElem) {
          searchCountElem.textContent = `${matchCount} ${matchCount === 1 ? 'coincidencia' : 'coincidencias'}`;
          searchCountElem.classList.remove('hidden');
        }
      } else {
        if (searchCountElem) searchCountElem.classList.add('hidden');
      }

      if (filtered.length === 0) {
        stream.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary);">
            <p style="font-size: 14px;">No hay mensajes que coincidan con los filtros seleccionados.</p>
          </div>
        `;
        updateFullReaderSelectionUi();
        return;
      }

      stream.innerHTML = filtered.map((msg) => {
        try {
          const originalIdx = rawMessages.indexOf(msg);
          const isUser = msg.role === 'user';
          const isAssistant = msg.role === 'assistant';
          const roleBadgeClass = isUser ? 'reader-role-user' : (isAssistant ? 'reader-role-assistant' : 'reader-role-tool');
          const srcPlat = (entity.source?.platform || entity.sourcePlatform || 'chatgpt').toLowerCase();
          const aiRoleLabel = srcPlat === 'gemini' ? 'GEMINI' : (srcPlat === 'claude' ? 'CLAUDE' : 'CHATGPT');
          const roleLabel = isUser ? 'USUARIO' : (isAssistant ? aiRoleLabel : (msg.role || 'SISTEMA').toUpperCase());
          const author = msg.author || roleLabel;
          const rawText = extractMessageText(msg);
          const isSearchMatch = matchingOriginalIndices.has(originalIdx);
          const searchMatchClass = isSearchMatch ? 'reader-search-match' : '';
          
          const formatter=window.Lossy.ExportCenter;
          const markdown=formatter.formatMessageMarkdown(msg,originalIdx,{assets:readerAssets,assetBinaryMap:readerAssetMap,imageStrategy:'embed',preserveRawWidgets:true});
          const displayText=window.Lossy.DocumentModel.renderMarkdown(markdown);

          const isChecked = fullReaderSelectedIndices.has(originalIdx);

          return `
            <article class="reader-turn-card ${isChecked ? 'is-selected' : ''} ${searchMatchClass}" data-idx="${originalIdx}">
              <header class="reader-turn-header">
                <div class="reader-turn-header-left">
                  <input type="checkbox" class="reader-turn-cb" data-idx="${originalIdx}" ${isChecked ? 'checked' : ''} aria-label="Seleccionar turno ${originalIdx + 1}">
                  <span class="reader-role-badge ${roleBadgeClass}">${escapeHtml(roleLabel)}</span>
                  <span style="font-weight: 600; color: var(--text-secondary);">${escapeHtml(author)}</span>
                  <span style="color: var(--text-tertiary); font-size: 10.5px;">Turno #${originalIdx + 1}</span>
                </div>
                <div class="reader-turn-actions">
                  <button type="button" class="btn btn-ghost btn-xs btn-reader-copy-turn" data-idx="${originalIdx}">Copiar</button>
                  <button type="button" class="btn btn-ghost btn-xs btn-reader-clip-turn" data-idx="${originalIdx}">Guardar como Clip</button>
                </div>
              </header>
              <div class="reader-turn-body">
                <div>${displayText}</div>
              </div>
            </article>
          `;
        } catch (turnErr) {
          console.warn('[Lossy Workspace] Error renderizando turno:', turnErr);
          return `
            <article class="reader-turn-card" style="padding: 12px; color: var(--text-tertiary); font-size: 12px;">
              [Error de formato en este mensaje]
            </article>
          `;
        }
      }).join('');

      if(searchQuery){
        for(const card of stream.querySelectorAll('.reader-search-match .reader-turn-body')){
          const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT),nodes=[];let node;
          while(node=walker.nextNode())if(node.nodeValue.toLowerCase().includes(searchQuery)&&!node.parentElement.closest('math,annotation,script,style'))nodes.push(node);
          for(const textNode of nodes){const value=textNode.nodeValue,lower=value.toLowerCase(),fragment=document.createDocumentFragment();let cursor=0,at;while((at=lower.indexOf(searchQuery,cursor))!==-1){fragment.append(document.createTextNode(value.slice(cursor,at)));const mark=document.createElement('mark');mark.className='reader-highlight';mark.textContent=value.slice(at,at+searchQuery.length);fragment.append(mark);cursor=at+searchQuery.length;}fragment.append(document.createTextNode(value.slice(cursor)));textNode.replaceWith(fragment);}
        }
      }
      bindFullReaderEvents(entity, rawMessages);
      updateFullReaderSelectionUi();

      stream.querySelectorAll('.reader-turn-body img').forEach(image=>image.addEventListener('error',()=>{const fallback=document.createElement('span');fallback.className='missing-image';fallback.textContent='Imagen no disponible: '+image.alt;image.replaceWith(fallback);},{once:true}));
      if (searchQuery && matchCount > 0) {
        const firstMatch = stream.querySelector('.reader-search-match');
        if (firstMatch && typeof firstMatch.scrollIntoView === 'function') {
          firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } catch (err) {
      console.error('[Lossy Workspace] Error en renderFullReaderStream:', err);
      stream.innerHTML = `
        <div style="text-align: center; padding: 48px 16px; color: var(--accent-red);">
          <p style="font-size: 14px;">Error al cargar la vista de lectura: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  function bindFullReaderEvents(entity, rawMessages) {
    const stream = document.getElementById('full-reader-stream');
    if (!stream) return;

    // Manejo de errores de carga de imágenes sin inline event handlers (cumplimiento CSP estricto)
    stream.querySelectorAll('img.reader-img-asset').forEach(img => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
        const fallback = img.nextElementSibling;
        if (fallback) fallback.style.display = 'block';
      });
    });

    const cbs = Array.from(stream.querySelectorAll('.reader-turn-cb'));
    cbs.forEach((cb) => {
      cb.addEventListener('click', (e) => {
        const currentIdx = parseInt(cb.dataset.idx, 10);
        if (e.shiftKey && fullReaderLastCheckedIndex !== null) {
          const start = Math.min(fullReaderLastCheckedIndex, currentIdx);
          const end = Math.max(fullReaderLastCheckedIndex, currentIdx);
          const state = cb.checked;
          for (let i = start; i <= end; i++) {
            if (state) fullReaderSelectedIndices.add(i);
            else fullReaderSelectedIndices.delete(i);
          }
          cbs.forEach(otherCb => {
            const idx = parseInt(otherCb.dataset.idx, 10);
            if (idx >= start && idx <= end) {
              otherCb.checked = state;
              otherCb.closest('.reader-turn-card')?.classList.toggle('is-selected', state);
            }
          });
        } else {
          if (cb.checked) fullReaderSelectedIndices.add(currentIdx);
          else fullReaderSelectedIndices.delete(currentIdx);
          cb.closest('.reader-turn-card')?.classList.toggle('is-selected', cb.checked);
        }
        fullReaderLastCheckedIndex = currentIdx;
        updateFullReaderSelectionUi();
      });
    });

    stream.querySelectorAll('.btn-reader-copy-turn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const msg = rawMessages[idx];
        const text = extractMessageText(msg);
        navigator.clipboard?.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = '¡Copiado!';
        setTimeout(() => { btn.textContent = originalText; }, 1500);
      });
    });

    stream.querySelectorAll('.btn-reader-clip-turn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        promptCreateClip(entity, [idx]);
      });
    });

    stream.querySelectorAll('.btn-copy-code').forEach(btn => {
      btn.addEventListener('click', () => {
        const codeText = btn.closest('.reader-code-box')?.querySelector('code')?.textContent || '';
        navigator.clipboard?.writeText(codeText);
        btn.textContent = 'Copiado';
        setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
      });
    });
  }

  function updateFullReaderSelectionUi() {
    const selectedCount = fullReaderSelectedIndices.size;
    const countLabel = document.getElementById('full-reader-selected-count');
    const clipBtnText = document.getElementById('full-reader-clip-btn-text');
    if (countLabel) {
      countLabel.textContent = `${selectedCount} ${selectedCount === 1 ? 'turno seleccionado' : 'turnos seleccionados'}`;
    }
    if (clipBtnText) {
      clipBtnText.textContent = selectedCount > 0 ? `Guardar como Clip (${selectedCount})` : 'Guardar como Clip';
    }
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractMessageText(msg) {
    if (!msg) return '';
    if (typeof msg.content?.text === 'string') return msg.content.text;
    if (typeof msg.text === 'string') return msg.text;
    if (Array.isArray(msg.content?.parts)) {
      return msg.content.parts.map(p => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        if (p && typeof p === 'object') return p.text || '';
        return '';
      }).filter(Boolean).join('\n');
    }
    if (typeof msg.content === 'string') return msg.content;
    return '';
  }

  async function exportSingleMarkdown(canonicalId) {
    const db = getLinerDb();
    if (!db) return;
    let item = await db.getConversation(canonicalId);
    if (!item && typeof db.getClip === 'function') {
      item = await db.getClip(canonicalId);
    }
    if (!item) return;

    const exportCenterModule = (window.Lossy && window.Lossy.ExportCenter) || null;
    let assets = [];
    if (exportCenterModule && exportCenterModule.AssetResolver) {
      try {
        assets = exportCenterModule.AssetResolver.resolveAssetsForEntity(item) || [];
      } catch (_) {}
    }

    if (assets.length > 0) {
      await openExportCenterModal([canonicalId]);
      return;
    }

    const exportCenterClass = (exportCenterModule && exportCenterModule.ExportCenter) || null;
    if (exportCenterClass) {
      const center = new exportCenterClass();
      const res = await center.exportSingle(item, 'md', 'ai', { imageStrategy: 'reference' });
      downloadBlob(res.data, res.filename, res.mimeType);
      showToast(`Exportación Markdown generada: ${res.filename}`);
    } else {
      const serializer = (window.Lossy && window.Lossy.MarkdownSerializer) || (window.Liner && window.Liner.MarkdownSerializer) || null;
      const mdText = serializer ? serializer.serializeToMarkdown(item) : JSON.stringify(item, null, 2);
      downloadBlob(mdText, `${item.canonicalId || canonicalId}.md`, 'text/markdown;charset=utf-8');
    }
  }

  async function exportSingleJson(canonicalId) {
    const db = getLinerDb();
    if (!db) return;
    let item = await db.getConversation(canonicalId);
    if (!item && typeof db.getClip === 'function') {
      item = await db.getClip(canonicalId);
    }
    if (!item) return;

    const exportCenterModule = (window.Lossy && window.Lossy.ExportCenter) || null;
    const exportCenterClass = (exportCenterModule && exportCenterModule.ExportCenter) || null;
    if (exportCenterClass) {
      const center = new exportCenterClass();
      const res = await center.exportSingle(item, 'json', 'ai');
      downloadBlob(res.data, res.filename, res.mimeType);
      showToast(`Exportación JSON canónica generada: ${res.filename}`);
    } else {
      downloadBlob(JSON.stringify(item, null, 2), `${item.canonicalId || canonicalId}.json`, 'application/json;charset=utf-8');
    }
  }

  // --- ELIMINACIÓN SEGURA DE LOSSY (FAIL-CLOSED, CERO MUTACIÓN DE CHATGPT) ---

  async function promptDeleteConversation(canonicalId) {
    const db = getLinerDb();
    if (!db) return;

    const conv = await db.getConversation(canonicalId);
    if (!conv) return;

    const isClip = conv.entityType === 'clip' || canonicalId.startsWith('clip_');
    const collections = await db.getCollectionsForConversation(canonicalId);
    const collectionIds = collections.map(c => c.collectionId);
    const folderMemberships = {};
    for (const col of collections) {
      if (col.organization?.folders) {
        const fids = col.organization.folders
          .filter(f => Array.isArray(f.conversationIds) && f.conversationIds.includes(canonicalId))
          .map(f => f.id);
        if (fids.length > 0) folderMemberships[col.collectionId] = fids;
      }
    }

    const titleText = isClip ? 'Eliminar Clip de Lossy' : 'Eliminar de Lossy';
    const bodyNote = isClip
      ? `Se eliminará la copia local del clip <strong>"${escapeHtml(conv.title || canonicalId)}"</strong>. La conversación original permanecerá intacta en ChatGPT y en la biblioteca local.`
      : `Se eliminará la copia local de <strong>"${escapeHtml(conv.title || canonicalId)}"</strong>. Los clips derivados de esta conversación se preservarán de forma autónoma.`;

    const confirmed = await showModal({
      title: titleText,
      bodyHtml: `
        <p style="margin-bottom: 12px; font-size: 13.5px;">
          ${bodyNote}
        </p>
        <div style="background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
          <strong>Seguridad y Soberanía Local:</strong><br>
          La fuente web original <strong>no se modificará</strong>. Lossy opera estrictamente en local-first.
        </div>
      `,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      isDestructive: true
    });

    if (!confirmed) return;

    // Guardar snapshot en buffer de deshacer
    lastDeletedContext = {
      type: 'SINGLE',
      conversation: conv,
      collectionIds,
      folderMemberships
    };

    if (isClip) {
      await db.deleteClip(canonicalId);
    } else {
      await db.deleteConversation(canonicalId);
    }
    selectedConversationIds.delete(canonicalId);

    // Cerrar inspector si corresponde
    const drawer = document.getElementById('inspector-drawer');
    if (drawer && currentActiveConversation && currentActiveConversation.canonicalId === canonicalId) {
      drawer.classList.add('hidden');
    }

    await loadLibraryData();
    updateBulkActionBar();

    const toastMsg = isClip ? 'Clip eliminado de Lossy' : 'Conversación eliminada de Lossy';
    showToast(toastMsg, {
      actionText: 'Deshacer',
      onAction: async () => {
        if (!lastDeletedContext || lastDeletedContext.type !== 'SINGLE') return;
        const restoredId = await db.restoreConversation(lastDeletedContext.conversation, lastDeletedContext.collectionIds, lastDeletedContext.folderMemberships);
        lastDeletedContext = null;
        if (restoredId) {
          await loadLibraryData();
          showToast(isClip ? 'Clip restaurado con éxito.' : 'Conversación restaurada con éxito.');
        }
      }
    });
  }

  async function promptDeleteSelectedConversations() {
    if (selectedConversationIds.size === 0) return;
    const db = getLinerDb();
    if (!db) return;

    const count = selectedConversationIds.size;
    const ids = Array.from(selectedConversationIds);

    const confirmed = await showModal({
      title: `Eliminar ${formatCount(count, 'elemento', 'elementos')} de Lossy`,
      bodyHtml: `
        <p style="margin-bottom: 12px; font-size: 13.5px;">
          Se eliminarán únicamente las copias locales de los <strong>${count}</strong> elementos seleccionados.
        </p>
        <div style="background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
          <strong>Seguridad Garantizada:</strong><br>
          La fuente original permanecerá intacta en ChatGPT. Esta acción opera 100% en local.
        </div>
      `,
      confirmText: `Eliminar ${count}`,
      cancelText: 'Cancelar',
      isDestructive: true
    });

    if (!confirmed) return;

    // Guardar snapshots para deshacer en bloque
    const snapshots = [];
    for (const id of ids) {
      const c = await db.getConversation(id);
      if (c) {
        const cols = await db.getCollectionsForConversation(id);
        const folderMemberships = {};
        for (const col of cols) {
          if (col.organization?.folders) {
            const fids = col.organization.folders
              .filter(f => Array.isArray(f.conversationIds) && f.conversationIds.includes(id))
              .map(f => f.id);
            if (fids.length > 0) folderMemberships[col.collectionId] = fids;
          }
        }
        snapshots.push({ conv: c, colIds: cols.map(x => x.collectionId), folderMemberships });
      }
    }

    lastDeletedContext = {
      type: 'BULK',
      snapshots
    };

    await db.deleteConversations(ids);
    selectedConversationIds.clear();
    updateBulkActionBar();
    await loadLibraryData();

    showToast(`${formatCount(count, 'elemento eliminado', 'elementos eliminados')} de Lossy`, {
      actionText: 'Deshacer',
      onAction: async () => {
        if (!lastDeletedContext || lastDeletedContext.type !== 'BULK') return;
        for (const item of lastDeletedContext.snapshots) {
          await db.restoreConversation(item.conv, item.colIds, item.folderMemberships);
        }
        lastDeletedContext = null;
        await loadLibraryData();
        showToast('Conversaciones restauradas con éxito.');
      }
    });
  }

  // --- COLLECTION PICKER MODAL (SUSTITUTO DEFINITIVO DE PROMPTS TEXTUALES) ---

  async function openCollectionPicker(targetConversationIds = []) {
    const ids = targetConversationIds.length > 0 ? targetConversationIds : Array.from(selectedConversationIds);
    if (ids.length === 0) return;

    const db = getLinerDb();
    if (!db) return;

    const collections = await db.listCollections();

    // Si es un solo ítem, determinar a qué proyectos ya pertenece
    let currentMemberships = new Set();
    if (ids.length === 1) {
      const matching = await db.getCollectionsForConversation(ids[0]);
      matching.forEach(c => currentMemberships.add(c.collectionId));
    }

    const pickerHtml = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <p style="font-size: 12px; color: var(--text-secondary);">
          Asigna ${formatCount(ids.length, 'conversación', 'conversaciones')} a uno o más proyectos.
        </p>

        <input type="search" id="picker-search-input" class="search-input collection-picker-search" placeholder="Buscar proyectos...">

        <div id="picker-collections-list" class="collection-picker-list">
          ${collections.length === 0 ? '<p style="padding: 12px; text-align: center; color: var(--text-tertiary); font-size: 12px;">No existen proyectos aún. Crea la primera abajo.</p>' : ''}
          ${collections.map(c => {
            const isChecked = currentMemberships.has(c.collectionId);
            return `
              <div class="collection-picker-row" data-name="${escapeHtml(c.name.toLowerCase())}">
                <label>
                  <input type="checkbox" class="picker-cb" data-id="${escapeHtml(c.collectionId)}" ${isChecked ? 'checked' : ''}>
                  <span>${escapeHtml(c.name)}</span>
                </label>
                <span style="font-size: 11px; color: var(--text-tertiary);">${c.conversationIds?.length || 0} chats</span>
              </div>
            `;
          }).join('')}
        </div>

        <div class="collection-picker-create">
          <span style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">+ Nuevo proyecto</span>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="picker-new-coll-name" class="search-input" style="flex: 1;" placeholder="Nombre del nuevo proyecto">
            <button id="btn-picker-create-inline" class="btn btn-secondary btn-sm" type="button">Crear</button>
          </div>
        </div>
      </div>
    `;

    const confirmed = await showModal({
      title: 'Añadir a Proyecto',
      bodyHtml: pickerHtml,
      confirmText: 'Aplicar',
      cancelText: 'Cancelar',
      onRender: (body) => {
        const searchInput = body.querySelector('#picker-search-input');
        const listContainer = body.querySelector('#picker-collections-list');
        const newNameInput = body.querySelector('#picker-new-coll-name');
        const createBtn = body.querySelector('#btn-picker-create-inline');

        if (searchInput && listContainer) {
          searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            listContainer.querySelectorAll('.collection-picker-row').forEach(row => {
              const name = row.dataset.name || '';
              if (!q || name.includes(q)) {
                row.style.display = 'flex';
              } else {
                row.style.display = 'none';
              }
            });
          });
        }

        if (createBtn && newNameInput && listContainer) {
          createBtn.addEventListener('click', async () => {
            const name = newNameInput.value.trim();
            if (!name) return;

            const newCol = await db.createCollection(name, '');
            newNameInput.value = '';

            const row = document.createElement('div');
            row.className = 'collection-picker-row';
            row.dataset.name = newCol.name.toLowerCase();
            row.innerHTML = `
              <label>
                <input type="checkbox" class="picker-cb" data-id="${escapeHtml(newCol.collectionId)}" checked>
                <span>${escapeHtml(newCol.name)}</span>
              </label>
              <span style="font-size: 11px; color: var(--text-tertiary);">0 chats</span>
            `;
            listContainer.appendChild(row);
            await updateAllCounts();
          });
        }
      }
    });

    if (!confirmed) return;

    const checkedIds = Array.from(document.querySelectorAll('.picker-cb:checked')).map(cb => cb.dataset.id);
    const uncheckedIds = Array.from(document.querySelectorAll('.picker-cb:not(:checked)')).map(cb => cb.dataset.id);

    // Aplicar adición a proyectos seleccionados (idempotente)
    for (const colId of checkedIds) {
      await db.addConversationsToCollection(colId, ids);
    }

    // Si era un único ítem, respetar desmarcado como desasignación
    if (ids.length === 1) {
      for (const colId of uncheckedIds) {
        if (currentMemberships.has(colId)) {
          await db.removeConversationFromCollection(colId, ids[0]);
        }
      }
    }

    await updateAllCounts();
    showToast(`Proyectos actualizados con éxito.`);

    const navColl = document.getElementById('nav-collections');
    if (navColl && navColl.classList.contains('active')) {
      if (currentOpenCollectionId) {
        await openCollectionDetail(currentOpenCollectionId);
      } else {
        await renderCollectionsView();
      }
    }
  }

  async function promptCreateCollectionWithItems(ids = []) {
    const db = getLinerDb();
    if (!db) return;

    let inputNameElem = null;

    const confirmed = await showModal({
      title: 'Nuevo proyecto',
      bodyHtml: `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <p style="font-size: 12px; color: var(--text-secondary);">
            Se ${ids.length === 1 ? 'añadirá 1 conversación' : `añadirán ${ids.length} conversaciones`} a la nuevo proyecto.
          </p>
          <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary);">Nombre:</label>
          <input type="text" id="modal-new-coll-name" class="search-input" placeholder="Ej. Arquitectura, Universidad..." style="width: 100%;">
          <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary); margin-top: 4px;">Descripción (opcional):</label>
          <input type="text" id="modal-new-coll-desc" class="search-input" placeholder="Breve contexto..." style="width: 100%;">
        </div>
      `,
      confirmText: 'Crear proyecto',
      cancelText: 'Cancelar',
      onRender: (body) => {
        inputNameElem = body.querySelector('#modal-new-coll-name');
      }
    });

    if (!confirmed) return;

    const name = (document.getElementById('modal-new-coll-name')?.value || '').trim();
    const desc = (document.getElementById('modal-new-coll-desc')?.value || '').trim();

    if (!name) return;

    const newCol = await db.createCollection(name, desc, ids);
    await updateAllCounts();
    showToast(`Proyecto "${newCol.name}" creado con éxito.`);

    await navigateToView('collections');
    await openCollectionDetail(newCol.collectionId);
  }

  async function promptRenameCollection(collectionId) {
    const db = getLinerDb();
    if (!db) return;
    const col = await db.getCollection(collectionId);
    if (!col) return;

    const confirmed = await showModal({
      title: 'Renombrar Proyecto',
      bodyHtml: `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 11.5px; font-weight: 500; color: var(--text-secondary);">Nuevo Nombre:</label>
          <input type="text" id="modal-rename-coll-name" class="search-input" value="${escapeHtml(col.name)}" style="width: 100%;">
        </div>
      `,
      confirmText: 'Guardar',
      cancelText: 'Cancelar'
    });

    if (!confirmed) return;
    const newName = (document.getElementById('modal-rename-coll-name')?.value || '').trim();
    if (!newName) return;

    await db.renameCollection(collectionId, newName);
    await updateAllCounts();
    if (currentOpenCollectionId === collectionId) {
      await openCollectionDetail(collectionId);
    } else {
      await renderCollectionsView();
    }
    showToast(`Proyecto renombrado a "${newName}".`);
  }

  async function promptDeleteCollection(collectionId) {
    const db = getLinerDb();
    if (!db) return;
    const col = await db.getCollection(collectionId);
    if (!col) return;

    const count = col.conversationIds?.length || 0;

    const confirmed = await showModal({
      title: `Eliminar Proyecto "${escapeHtml(col.name)}"`,
      bodyHtml: `
        <p style="margin-bottom: 12px; font-size: 13.5px;">
          ¿Estás seguro de que deseas eliminar el proyecto "${escapeHtml(col.name)}"?
        </p>
        <div style="background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
          <strong>Seguridad Total:</strong><br>
          Las <strong>${formatCount(count, 'conversación seguirá disponible', 'conversaciones seguirán disponibles')}</strong> intactas en tu Biblioteca. Se eliminarán el estado del proyecto y sus asociaciones. Las conversaciones se conservan.
        </div>
      `,
      confirmText: 'Eliminar Proyecto',
      cancelText: 'Cancelar',
      isDestructive: true
    });

    if (!confirmed) return;

    if (projectEditor?.id === collectionId) { await projectEditor.pending.catch(() => undefined); clearTimeout(projectSaveTimer); projectEditor = null; }
    await db.deleteCollection(collectionId);
    if (currentOpenCollectionId === collectionId) {
      currentOpenCollectionId = null;
    }
    await updateAllCounts();
    await renderCollectionsView();
    showToast(`Proyecto "${col.name}" eliminado.`);
  }

  // --- MOTOR DE TRABAJOS Y BANDEJA GLOBAL (GLOBAL JOB TRAY) ---

  function updateGlobalJobTray(job) {
    const tray = document.getElementById('global-job-tray');
    if (!tray) return;

    if (!job) {
      tray.classList.add('hidden');
      return;
    }

    tray.classList.remove('hidden');
    const dot = document.getElementById('job-tray-dot');
    const title = document.getElementById('job-tray-title');
    const item = document.getElementById('job-tray-item');
    const count = document.getElementById('job-tray-count');
    const fill = document.getElementById('job-tray-fill');
    const btnPause = document.getElementById('btn-job-pause');
    const btnResume = document.getElementById('btn-job-resume');

    const total = job.totalItems || 0;
    const completed = job.completedItems || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (dot) dot.className = `status-dot ${job.status}`;
    if (title) title.textContent = job.type === 'BULK_ACQUISITION' ? 'Captura en lote' : 'Trabajo en curso';
    if (count) count.textContent = `${completed} / ${total}`;
    if (fill) fill.style.width = `${pct}%`;

    if (item) {
      if (job.status === 'paused') {
        item.textContent = 'Pausado por el usuario';
      } else if (job.status === 'completed' || job.status === 'completed_with_warnings') {
        item.textContent = `Completado con éxito (${completed} conservados)`;
      } else if (job.status === 'cancelled') {
        item.textContent = `Cancelado (${completed} guardados intactos en Biblioteca)`;
      } else if (job.status === 'failed') {
        item.textContent = 'Falló la ejecución del trabajo';
      } else {
        item.textContent = job.currentItemTitle ? `Actual: "${job.currentItemTitle}"` : 'Procesando...';
      }
    }

    if (btnPause && btnResume) {
      if (job.status === 'running') {
        btnPause.classList.remove('hidden');
        btnResume.classList.add('hidden');
      } else if (job.status === 'paused') {
        btnPause.classList.add('hidden');
        btnResume.classList.remove('hidden');
      } else {
        btnPause.classList.add('hidden');
        btnResume.classList.add('hidden');
      }
    }
  }

  async function startBulkCapture() {
    if (selectedConversationIds.size === 0) return;
    const db = getLinerDb();
    if (!db) return;

    const bulkWipeEpoch = typeof db.getWipeEpoch === 'function' ? db.getWipeEpoch() : null;
    const items = [];
    for (const id of selectedConversationIds) {
      const c = await db.getConversation(id);
      if (c) {
        items.push({
          id: c.canonicalId,
          canonicalId: c.canonicalId,
          title: c.title,
          conversationId: c.source?.conversationId,
          platform: inferExpectedPlatform(c),
          url: c.source?.url
        });
      } else {
        items.push({ id, canonicalId: id, title: id, platform: inferExpectedPlatform({ id, canonicalId: id }) });
      }
    }

    const engine = getJobEngine();
    if (!engine) {
      showToast('JobEngine no disponible en memoria.');
      return;
    }

    let job;
    try {
      job = engine.createJob('BULK_ACQUISITION', items);
    } catch (err) {
      showToast(err.message || 'Ya hay un trabajo en curso.', { isError: true });
      return;
    }
    currentActiveJob = job;
    updateGlobalJobTray(job);

    engine.onProgress(updatedJob => {
      currentActiveJob = updatedJob;
      updateGlobalJobTray(updatedJob);
    });

    const deriveExpectedConvId = (item) => {
      if (item.conversationId && typeof item.conversationId === 'string') return item.conversationId;
      if (typeof item.id === 'string') {
        const m = item.id.match(/^conv_(?:chatgpt|gemini|claude|lossy)_(.+)$/);
        if (m && m[1]) return m[1];
      }
      return null;
    };

    const workerFn = async (item) => {
      if (bulkWipeEpoch !== null && typeof db.getWipeEpoch === 'function' && db.getWipeEpoch() !== bulkWipeEpoch) {
        throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      }
      job.currentItemTitle = item.title;
      updateGlobalJobTray(job);

      const expectedConvId = deriveExpectedConvId(item);
      const expectedPlatform = inferExpectedPlatform(item);

      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const cfg = platformTabQueryConfig(expectedPlatform);
        const tabs = await chrome.tabs.query({ url: cfg.urls });
        if (tabs && tabs.length > 0) {
          if (!expectedConvId) {
            throw new Error('Identidad de conversación ausente en elemento de captura masiva.');
          }
          const exactTab = tabs.find(t => cfg.matchTab(t, expectedConvId));
          if (!exactTab && !cfg.allowStructuredFallback) {
            throw new Error(`No hay pestaña abierta para la conversación ${expectedConvId} en ${expectedPlatform}.`);
          }
          const tab = exactTab || tabs[0];
          const isStructuredOnly = !exactTab;
          const action = isStructuredOnly ? 'ACQUIRE_STRUCTURED_ONLY' : 'ACQUIRE_CONVERSATION';
          const response = await safeTabMessagingWithAutoInject(tab.id, { action, conversationId: expectedConvId, platform: expectedPlatform });

          if (bulkWipeEpoch !== null && typeof db.getWipeEpoch === 'function' && db.getWipeEpoch() !== bulkWipeEpoch) {
            throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
          }

          if (!response || !response.success || !response.data) {
            throw new Error(response?.error || `No se pudo adquirir ${expectedConvId} sin mezclar identidades.`);
          }

          const ext = response.data;
          // SOURCE IDENTITY INVARIANT (fail-closed on UUID, platform, and canonicalId):
          verifyAcquiredIdentity(ext, {
            expectedConvId,
            expectedPlatform,
            expectedCanonicalId: item.canonicalId || item.id
          });

          const updated = {
            canonicalId: item.id,
            title: ext.title || item.title,
            source: ext.source || { platform: expectedPlatform, conversationId: expectedConvId, url: item.url, acquisitionMethod: isStructuredOnly ? 'structured-session' : 'dom-harvest' },
            model: ext.model || null,
            createdAt: ext.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: ext.messages || [],
            integrity: typeof ext.integrity === 'object' ? ext.integrity : { status: ext.integrity || 'captured' },
            attachments: ext.attachments || [],
            references: ext.references || []
          };
          await db.saveConversation(updated, bulkWipeEpoch !== null ? { expectedWipeEpoch: bulkWipeEpoch } : undefined);
          return updated;
        }
      }

      // Si no hay pestaña abierta, actualizar marca local sin duplicar
      if (bulkWipeEpoch !== null && typeof db.getWipeEpoch === 'function' && db.getWipeEpoch() !== bulkWipeEpoch) {
        throw new Error('WRITE_ABORTED_BY_CLEAR_ALL');
      }
      const existing = await db.getConversation(item.id);
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        await db.saveConversation(existing, bulkWipeEpoch !== null ? { expectedWipeEpoch: bulkWipeEpoch } : undefined);
        return existing;
      }

      return { id: item.id };
    };

    currentActiveWorkerFn = workerFn;

    try {
      await engine.run(workerFn);
      await loadLibraryData();
      await updateAllCounts();
      showToast('Actualización de capturas completada.');
    } catch (err) {
      console.error('Error en ejecución del trabajo:', err);
    }
  }

  let homeProjects = [];
  let projectEditor = null;
  let projectSaveTimer = null;
  let transferProjectId = null;
  let transferAutoGoal = '';
  const projectFieldIds = { goal:'project-goal', decisions:'project-decisions', openQuestions:'project-questions', nextStep:'project-next-step', status:'project-status' };

  function projectValues() {
    return Object.fromEntries(Object.entries(projectFieldIds).map(([key,id]) => [key, document.getElementById(id)?.value || (key === 'status' ? 'active' : '')]));
  }

  function projectSaveStatus(text, error = false) {
    const status = document.getElementById('project-save-status');
    if (status) { status.textContent = text; status.classList.toggle('is-error', error); }
    document.getElementById('project-recovery')?.classList.toggle('hidden', !error);
  }

  function loadProjectEditor(project) {
    clearTimeout(projectSaveTimer);
    const context = project.projectContext || {};
    for (const [key,id] of Object.entries(projectFieldIds)) {
      const field = document.getElementById(id);
      if (field) field.value = context[key] || (key === 'status' ? 'active' : '');
    }
    projectEditor = { id:project.collectionId, revision:context.revision || 0, snapshot:JSON.stringify(projectValues()), queuedSignature:JSON.stringify(projectValues()), pending:Promise.resolve(), pendingWrites:0, blocked:false };
    projectSaveStatus(context.revision ? 'Contexto guardado en este navegador' : 'Define tu primer punto de continuidad');
  }

  async function flushProjectEditor() {
    clearTimeout(projectSaveTimer);
    const editor = projectEditor;
    if (!editor) return;
    const values = projectValues(), signature = JSON.stringify(values);
    if (signature === editor.queuedSignature) return editor.pending;
    if (editor.blocked) throw new Error('No se pudo guardar el contexto. Conserva tus cambios y recarga el proyecto para resolver el conflicto.');
    projectSaveStatus('Guardando contexto…');
    editor.queuedSignature = signature;
    editor.pendingWrites++;
    const task = editor.pending.catch(() => undefined).then(async () => {
      const saved = await getLinerDb().saveProjectContext(editor.id, values, editor.revision);
      editor.revision = saved.projectContext.revision;
      editor.snapshot = signature;
      if (projectEditor === editor) projectSaveStatus(JSON.stringify(projectValues()) === signature ? 'Contexto guardado en este navegador' : 'Cambios pendientes de guardar');
      return saved;
    });
    editor.pending = task;
    try { const saved = await task; await updateAllCounts(); return saved; }
    catch (error) { editor.blocked = error.code === 'PROJECT_CONFLICT'; editor.queuedSignature = null; if (projectEditor === editor) projectSaveStatus(error.message, true); throw error; }
    finally { editor.pendingWrites--; }
  }

  async function openDocumentStudio(ids, projectId = null) {
    await flushProjectEditor();
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 100) { showToast('Selecciona entre 1 y 100 conversaciones para preparar el documento.'); return; }
    const query = new URLSearchParams();unique.forEach(id => query.append('id',id));if (projectId) query.set('project',projectId);
    await chrome.tabs.create({url:chrome.runtime.getURL('src/documents/document.html')+'?'+query.toString()});
  }

  function setupProjectRestore() {
    const input = document.getElementById('file-restore-project'),button = document.getElementById('btn-restore-project'),status = document.getElementById('project-import-status');
    if (!input || !button || !status) return;
    button.addEventListener('click',()=>input.click());
    input.addEventListener('change',async()=>{
      const file=input.files[0];if(!file)return;let restoredId=null;button.disabled=true;input.disabled=true;status.textContent='Leyendo y comprobando el proyecto…';
      try{
        await flushProjectEditor();
        const db=getLinerDb(),bundle=await Lossy.ProjectBundle.readProjectPackage(await file.arrayBuffer()),projects=await db.listCollections();let plan,planning=0;
        const context=bundle.project.context;
        const confirmed=await showModal({
          title:'Restaurar proyecto',confirmText:'Restaurar proyecto',cancelText:'Cancelar',
          bodyHtml:'<div class="restore-preview"><span class="eyebrow">REVISAR ANTES DE GUARDAR</span><h4>'+escapeHtml(bundle.project.name)+'</h4><p>'+bundle.sources.length+' fuentes · '+bundle.fileCount+' archivos verificados</p><div class="restore-context"><strong>Objetivo</strong><p>'+escapeHtml(context.goal||'Sin definir')+'</p><strong>Decisiones</strong><p>'+escapeHtml(context.decisions||'Sin definir')+'</p><strong>Preguntas y pendientes</strong><p>'+escapeHtml(context.openQuestions||'Sin definir')+'</p><strong>Estado</strong><p>'+escapeHtml({active:'En curso',paused:'En pausa',completed:'Completado'}[context.status])+'</p><strong>Siguiente paso</strong><p>'+escapeHtml(context.nextStep||'Sin definir')+'</p></div><label class="restore-mode"><input type="radio" name="restore-mode" value="copy" checked><span><strong>Crear una copia del proyecto</strong><small>Conserva los proyectos actuales.</small></span></label><label class="restore-mode"><input type="radio" name="restore-mode" value="update" '+(!projects.length?'disabled':'')+'><span><strong>Actualizar un proyecto existente</strong><small>Reemplaza el nombre, la descripción y el estado de trabajo por los del archivo. Conserva sus fuentes actuales.</small></span></label><label class="restore-target-label" for="restore-target">Proyecto que se actualizará<select id="restore-target" class="select-input" disabled>'+projects.map(project=>'<option value="'+escapeHtml(project.collectionId)+'" '+(project.collectionId===bundle.project.id?'selected':'')+'>'+escapeHtml(project.name)+'</option>').join('')+'</select></label><p id="restore-impact" class="restore-impact" role="status">Preparando la vista previa…</p><details><summary>Ver fuentes incluidas</summary><ul>'+bundle.sources.map(source=>'<li>'+escapeHtml(source.title||source.canonicalId)+(source.entityType==='clip'?' · Clip':'')+'</li>').join('')+'</ul></details></div>',
          onRender:body=>{
            const refresh=async()=>{
              const current=++planning,mode=body.querySelector('input[name="restore-mode"]:checked').value,target=body.querySelector('#restore-target'),impact=body.querySelector('#restore-impact'),confirm=document.getElementById('app-modal-confirm');
              target.disabled=mode!=='update';confirm.disabled=true;plan=undefined;
              try{const proposed=await Lossy.ProjectBundle.planRestore(db,bundle,{mode,targetId:target.value});if(current!==planning)return;plan=proposed;const summary=plan.summary;impact.textContent=summary.inserted+' fuentes para guardar · '+summary.reused+' fuentes idénticas reutilizadas.'+(summary.conflictingCopies?' '+summary.conflictingCopies+' fuentes difieren de las locales y se conservarán como copias.':'')+(mode==='update'?' Se conservarán '+summary.preservedMembers+' fuentes adicionales del proyecto actual.':'');confirm.disabled=false;}
              catch(error){if(current===planning){impact.textContent=error.message;impact.classList.add('is-error');}}
            };
            body.querySelectorAll('input[name="restore-mode"],#restore-target').forEach(control=>control.addEventListener('change',refresh));refresh();
          }
        });
        planning++;
        if(!confirmed){status.textContent='Restauración cancelada. No se guardaron cambios.';return;}
        if(!plan)throw Error('No hay una vista previa válida para restaurar');
        const id=await db.restoreProject(plan);restoredId=id;await updateAllCounts();await loadLibraryData();await navigateToView('collections');await openCollectionDetail(id);
        status.textContent='Proyecto restaurado con '+bundle.sources.length+' fuentes. Las versiones locales se conservaron.';showToast('Proyecto restaurado. Puedes retomar tu trabajo.');
      }catch(error){status.textContent=(restoredId?'El proyecto se guardó, pero no se pudo actualizar la vista. Recarga Lossy: ':'No se restauró el proyecto: ')+error.message;showToast(status.textContent,{isError:true});}
      finally{input.disabled=false;input.value='';button.disabled=false;document.getElementById('app-modal-confirm').disabled=false;}
    });
  }

  function setupProjectEditor() {
    const form = document.getElementById('project-context-form');
    if (!form) return;
    window.addEventListener('beforeunload', event => {
      if (projectEditor && (projectEditor.pendingWrites > 0 || JSON.stringify(projectValues()) !== projectEditor.snapshot)) { event.preventDefault(); event.returnValue = ''; }
    });
    document.getElementById('btn-project-reload')?.addEventListener('click', async () => {
      try { const project = await getLinerDb().getCollection(currentOpenCollectionId); if (project) loadProjectEditor(project); }
      catch (error) { projectSaveStatus(error.message, true); }
    });
    document.getElementById('btn-project-draft')?.addEventListener('click', async () => {
      try {
        const db = getLinerDb(), project = await db.getCollection(currentOpenCollectionId), sources = [];
        for (const id of project.conversationIds || []) { const item = await db.getConversation(id); if (item) sources.push(item); }
        await navigator.clipboard.writeText(window.Lossy.TransferBundle.buildProjectBrief({ ...project, projectContext:projectValues() }, sources));
        showToast('Borrador copiado. Aún no se ha guardado en el proyecto.');
      } catch (error) { showToast('No se pudo copiar el borrador: ' + error.message); }
    });
    form.addEventListener('input', () => {
      projectSaveStatus('Cambios pendientes de guardar');
      clearTimeout(projectSaveTimer);
      projectSaveTimer = setTimeout(() => flushProjectEditor().catch(error => console.warn('[Lossy project]', error)), 600);
    });
    form.addEventListener('submit', event => { event.preventDefault(); flushProjectEditor().catch(error => showToast(error.message)); });
    document.getElementById('btn-project-copy')?.addEventListener('click', async () => {
      try {
        await flushProjectEditor();
        const db = getLinerDb(), project = await db.getCollection(currentOpenCollectionId), sources = [];
        for (const id of project.conversationIds || []) { const item = await db.getConversation(id); if (item) sources.push(item); }
        const text = window.Lossy.TransferBundle.buildProjectBrief(project, sources);
        await navigator.clipboard.writeText(text);
        showToast('Contexto copiado. Pégalo en el asistente donde quieras continuar.');
      } catch (error) { showToast('No se pudo copiar el contexto: ' + error.message); }
    });
  }

  function renderProjectHome(projects = homeProjects) {
    homeProjects = projects;
    const query = (document.getElementById('global-search')?.value || '').trim().toLowerCase();
    if (query) projects = projects.filter(project => [project.name, project.description, ...['goal','decisions','openQuestions','nextStep'].map(key => project.projectContext?.[key])].filter(Boolean).join(' ').toLowerCase().includes(query));
    const list = document.getElementById('project-home-list');
    if (!list) return;
    const ordered = [...projects].sort((a,b) => (a.projectContext?.status === 'completed') - (b.projectContext?.status === 'completed') || new Date(b.projectContext?.updatedAt || b.updatedAt) - new Date(a.projectContext?.updatedAt || a.updatedAt));
    if (!ordered.length && query) { list.innerHTML = '<p class="project-search-empty">No hay proyectos que coincidan con esta búsqueda.</p>'; return; }
    if (!ordered.length) {
      list.innerHTML = '<div class="project-home-empty"><strong>Tu trabajo merece algo más que una carpeta.</strong><p>Crea un proyecto, reúne sus conversaciones y guarda qué decidiste y cuál es el siguiente paso.</p><button id="btn-create-first-project" class="btn btn-primary" type="button">Crear mi primer proyecto</button></div>';
      document.getElementById('btn-create-first-project')?.addEventListener('click', () => promptCreateCollectionWithItems(Array.from(selectedConversationIds)));
      return;
    }
    const statuses = {active:'En curso',paused:'En pausa',completed:'Completado'};
    list.innerHTML = ordered.slice(0,3).map(project => `<article class="project-resume-card"><div class="project-resume-meta"><span>${escapeHtml(statuses[project.projectContext?.status] || statuses.active)}</span><span>${formatCount(project.conversationIds?.length || 0, 'fuente', 'fuentes')}</span></div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.projectContext?.goal || project.description || 'Define qué quieres conseguir con este proyecto.')}</p><div class="project-next"><span>Siguiente paso</span><strong>${escapeHtml(project.projectContext?.nextStep || 'Guarda una acción para retomarlo con claridad.')}</strong></div><button class="btn btn-secondary btn-sm btn-resume-project" type="button" data-project-id="${escapeHtml(project.collectionId)}">Retomar proyecto <span aria-hidden="true">→</span></button></article>`).join('');
    list.querySelectorAll('.btn-resume-project').forEach(button => button.addEventListener('click', async () => {
      try { await navigateToView('collections'); await openCollectionDetail(button.dataset.projectId); }
      catch (error) { showToast(error.message); }
    }));
  }

  function clearTransferProject() {
    const goal = document.getElementById('transfer-goal');
    if (goal && goal.value === transferAutoGoal) goal.value = '';
    transferProjectId = null; transferAutoGoal = '';
    const select = document.getElementById('transfer-collection-select');
    if (select) select.value = '';
  }

  function setTransferProject(project) {
    transferProjectId = project.collectionId;
    transferAutoGoal = project.projectContext?.goal || project.description || '';
    const goal = document.getElementById('transfer-goal');
    if (goal) goal.value = transferAutoGoal;
  }

  async function getTransferProject() {
    if (!transferProjectId) return null;
    const project = await getLinerDb().getCollection(transferProjectId);
    if (!project || !selectedConversationIds.size || [...selectedConversationIds].some(id => !(project.conversationIds || []).includes(id))) { clearTransferProject(); return null; }
    return project;
  }

  async function refreshTransferProject() {
    const project = await getTransferProject(), summary = document.getElementById('transfer-project-summary');
    if (!summary) return;
    summary.classList.toggle('hidden', !project);
    summary.textContent = project ? project.name + ' · El paquete incluirá el objetivo, las decisiones, los pendientes y el siguiente paso guardados.' : '';
  }

  // --- CONSTRUCTOR DE TRANSFERENCIAS (TRANSFER BUILDER) ---
  async function updateTransferBuilder() {
    const previewContainer = document.getElementById('transfer-selected-preview');
    const readinessBox = document.getElementById('transfer-readiness');
    const btnExecute = document.getElementById('btn-execute-transfer');
    const collSelect = document.getElementById('transfer-collection-select');

    if (!previewContainer || !readinessBox) return;

    const db = getLinerDb();

    if (collSelect && db) {
      const collections = await db.listCollections();
      const currentVal = transferProjectId || collSelect.value;
      collSelect.innerHTML = '<option value="">Selección manual actual</option>' +
        collections.map(c => `<option value="${escapeHtml(c.collectionId)}">${escapeHtml(c.name)} (${c.conversationIds?.length || 0} chats)</option>`).join('');
      if (currentVal) collSelect.value = currentVal;
    }

    await refreshTransferProject();
    const count = selectedConversationIds.size;
    if (count === 0) {
      previewContainer.innerHTML = '<span class="chip">Ninguna conversación seleccionada</span>';
      readinessBox.innerHTML = '<p style="color: var(--text-tertiary)">Selecciona un proyecto en el menú superior, o haz clic en "Seleccionar todas" para transferir tu biblioteca.</p>';
      if (btnExecute) btnExecute.disabled = true;
      return;
    }

    if (btnExecute) btnExecute.disabled = false;

    // Obtener objetos de conversaciones seleccionadas
    const selectedConvs = [];
    if (db) {
      for (const id of selectedConversationIds) {
        const c = await db.getConversation(id);
        if (c) selectedConvs.push(c);
      }
    }

    previewContainer.innerHTML = selectedConvs.map(c => `
      <span class="chip">
        ${escapeHtml(c.title || c.canonicalId)} (${(c.messages || c.selectedMessages || []).length} msgs)
      </span>
    `).join('');

    let totalMessages = 0;
    let totalAttachments = 0;
    let hasBranches = false;
    let verifiedModels = new Set();
    let warningsCount = 0;

    selectedConvs.forEach(c => {
      totalMessages += ((c.messages || c.selectedMessages || []).length);
      totalAttachments += (c.attachments?.length || 0);
      if (c.branches && c.branches.branchPoints?.length > 0) hasBranches = true;
      if (c.model) verifiedModels.add(c.model);
      if (c.integrity?.warnings?.length > 0) warningsCount += c.integrity.warnings.length;
      else if (['partial','degraded','failed'].includes(c.integrity?.status)) warningsCount++;
      warningsCount += window.Lossy?.ChatGPTAssets?.summary(c).missing || 0;
    });

    const modelDisplay = verifiedModels.size > 0 ? Array.from(verifiedModels).join(', ') : 'Desconocido (no expuesto por la fuente)';

    readinessBox.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
        <div><strong>Evaluación de Portabilidad de Contexto:</strong></div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
          <div style="background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary); font-size: 11px;">MENSAJES TOTALES</span>
            <div style="font-size: 16px; font-weight: 600;">${totalMessages}</div>
          </div>
          <div style="background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary); font-size: 11px;">MODELO FUENTE</span>
            <div style="font-size: 14px; font-weight: 500;">${escapeHtml(modelDisplay)}</div>
          </div>
          <div style="background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary); font-size: 11px;">ADJUNTOS / IMÁGENES</span>
            <div style="font-size: 14px;">${totalAttachments > 0 ? `${totalAttachments} detectados` : '0'}</div>
          </div>
          <div style="background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary); font-size: 11px;">BIFURCACIONES (BRANCHES)</span>
            <div style="font-size: 14px;">${hasBranches ? 'Preservadas en Canónico' : 'Línea de tiempo única'}</div>
          </div>
        </div>
        ${warningsCount > 0 ? `
          <div style="color: var(--accent-amber); font-size: 12px; margin-top: 4px;">
            Atención: Se detectaron ${warningsCount} avisos de integridad o degradación de viewport.
          </div>
        ` : `
          <div style="color: var(--accent-green); font-size: 12px; margin-top: 4px;">
            Contexto íntegro sin avisos de truncamiento detectados.
          </div>
        `}
      </div>
    `;
  }

  async function executeTransfer() {
    const btnExecute = document.getElementById('btn-execute-transfer');
    const outputBox = document.getElementById('transfer-output');
    if (!btnExecute || selectedConversationIds.size === 0) return;

    btnExecute.disabled = true;
    btnExecute.textContent = 'Generando Paquete...';

    try {
      const db = getLinerDb();
      const conversations = [];
      if (db) {
        for (const id of selectedConversationIds) {
          const c = await db.getConversation(id);
          if (c) conversations.push(c);
        }
      }

      if (conversations.length === 0) {
        throw new Error('No se pudieron recuperar las conversaciones seleccionadas de LinerDB');
      }

      const targetRadio = document.querySelector('input[name="transfer-target"]:checked');
      const targetType = targetRadio ? targetRadio.value : 'generic';

      let adapter;
      const claudeAdapterClass = (window.Lossy && window.Lossy.ClaudeTargetAdapter) || (window.Liner && window.Liner.ClaudeTargetAdapter);
      const mdAdapterClass = (window.Lossy && window.Lossy.MarkdownBundleAdapter) || (window.Liner && window.Liner.MarkdownBundleAdapter);
      const genericAdapterClass = (window.Lossy && window.Lossy.GenericTargetAdapter) || (window.Liner && window.Liner.GenericTargetAdapter);

      if (targetType === 'claude' && claudeAdapterClass) {
        adapter = new claudeAdapterClass();
      } else if (targetType === 'markdown' && mdAdapterClass) {
        adapter = new mdAdapterClass();
      } else if (genericAdapterClass) {
        adapter = new genericAdapterClass();
      } else {
        throw new Error('Adaptador de destino no disponible en el entorno');
      }

      const project = await getTransferProject();
      const pkgOpts = {
        projectDescription:project?.description, projectCreatedAt:project?.createdAt, projectOrganization:project?.organization, projectMigration:project?.migration,
        projectTitle: project?.name || `Lossy Transfer (${conversations.length} context items)`,
        summaryGoal: document.getElementById('transfer-goal')?.value.trim() || undefined,
        ...(project?.projectContext ? { projectId:project.collectionId, projectContext:project.projectContext } : {})
      };
      const pkg = typeof adapter.generatePackageAsync === 'function'
        ? await adapter.generatePackageAsync(conversations, pkgOpts)
        : adapter.generatePackage(conversations, pkgOpts);

      if (db) {
        await db.saveTransfer({
          transferId: pkg.packageId,
          target: pkg.target,
          createdAt: pkg.manifest ? pkg.manifest.createdAt : new Date().toISOString(),
          conversationCount: conversations.length,
          manifest: pkg.manifest,
          receipt: pkg.receipt
        });
        await updateAllCounts();
      }

      const zipBuilder=window.Lossy?.ZipBuilder||window.Liner?.ZipBuilder;
      if(!zipBuilder)throw new Error('No se pudo preparar el archivo ZIP');
      const zip=zipBuilder.createZip(pkg.files);
      downloadBlob(zip,pkg.packageId+'.zip','application/zip');

      if (outputBox) {
        outputBox.classList.remove('hidden');
        outputBox.innerHTML = `
          <div style="background: rgba(129, 201, 149, 0.12); border: 1px solid var(--accent-green); padding: 12px; border-radius: var(--radius-sm); margin-top: 12px; font-size: 13px;">
            <strong style="color: var(--accent-green);">Paquete descargado: ${escapeHtml(pkg.packageId)}</strong>
            <p style="margin-top: 4px; font-size: 12px;">El ZIP incluye ${Object.keys(pkg.files).length} archivos, el objetivo, las conversaciones y sus recursos. ${pkg.assetSummary?.included || 0} de ${pkg.assetSummary?.total || 0} recursos incluidos. El recibo permite comprobar la integridad de los archivos.</p>
          </div>
        `;
      }

      btnExecute.textContent = 'Paquete Emitido con Éxito';
      setTimeout(() => {
        btnExecute.disabled = false;
        btnExecute.textContent = 'Generar y Descargar Paquete';
      }, 3000);

    } catch (err) {
      if (outputBox) {
        outputBox.classList.remove('hidden');
        outputBox.innerHTML = `
          <div style="background: rgba(242, 139, 130, 0.12); border: 1px solid var(--accent-red); padding: 12px; border-radius: var(--radius-sm); margin-top: 12px; font-size: 13px; color: var(--accent-red);">
            Error al generar la transferencia: ${escapeHtml(err.message)}
          </div>
        `;
      }
      btnExecute.disabled = false;
      btnExecute.textContent = 'Reintentar Generar Paquete';
    }
  }

  async function startTransferFromCollection(collectionId) {
    try {
      await flushProjectEditor();
      const db = getLinerDb(); if (!db) return;
      const project = await db.getCollection(collectionId);
      if (!project || !Array.isArray(project.conversationIds)) return;
      if(project.migration?.kind==='chatgpt-export'){
        await navigateToView('transfers');setTransferMode('archive');await window.lossyMigrationPanel.openSaved(collectionId,projectFolderFilter);return;
      }
      setTransferProject(project);
      selectedConversationIds.clear();
      project.conversationIds.forEach(id => selectedConversationIds.add(id));
      updateBulkActionBar();
      await navigateToView('transfers');
    } catch (error) { showToast(error.message); }
  }

  async function exportCollectionZip(collectionId) {
    const db = getLinerDb();
    if (!db) return;
    const col = await db.getCollection(collectionId);
    if (!col || !Array.isArray(col.conversationIds)) {
      showToast('El proyecto no tiene conversaciones para exportar.');
      return;
    }

    await flushProjectEditor();
    const project = await db.getCollection(collectionId), items = [];
    for (const id of project.conversationIds) { const item = await db.getConversation(id); if (item) items.push(item); }
    if (items.length !== project.conversationIds.length) { showToast('Faltan fuentes de este proyecto en la biblioteca. Revisa sus elementos antes de exportarlo.'); return; }
    const adapter = new window.Lossy.GenericTargetAdapter();
    const pkgOpts = { projectTitle:project.name, projectDescription:project.description, projectCreatedAt:project.createdAt, projectOrganization:project.organization, projectMigration:project.migration, summaryGoal:project.projectContext?.goal || project.description, projectId:project.collectionId, projectContext:project.projectContext || {} };
    const pkg = typeof adapter.generatePackageAsync === 'function'
      ? await adapter.generatePackageAsync(items, pkgOpts)
      : adapter.generatePackage(items, pkgOpts);
    const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    downloadBlob(window.Lossy.ZipBuilder.createZip(pkg.files), 'proyecto_' + safeName + '.zip', 'application/zip');
  }

  // --- COLECCIONES VIEW (AGRUPACIÓN MUTABLE NO DESTRUCTIVA) ---

  async function renderCollectionsView() {
    const grid = document.getElementById('collections-grid');
    const detailPanel = document.getElementById('collection-detail-panel');
    if (!grid) return;

    if (detailPanel) detailPanel.classList.add('hidden');
    grid.classList.remove('hidden');

    try {
      const db = getLinerDb();
      let collections = [];
      if (db) collections = await db.listCollections();

      if (collections.length === 0) {
        grid.innerHTML = `
          <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 32px 24px; text-align: center; grid-column: 1 / -1;">
            <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">Aún no tienes proyectos creados</h4>
            <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px; max-width: 520px; margin-left: auto; margin-right: auto; line-height: 1.5;">
              Reúne fuentes, conserva tus decisiones y define una acción concreta para retomar el trabajo.
            </p>
            <button id="btn-empty-new-collection" class="btn btn-primary btn-sm" type="button">Crear mi primer proyecto</button>
          </div>
        `;
        const btnEmpty = document.getElementById('btn-empty-new-collection');
        if (btnEmpty) btnEmpty.addEventListener('click', () => promptCreateCollectionWithItems([]));
        return;
      }

      grid.innerHTML = collections.map(col => {
        const count = col.conversationIds ? col.conversationIds.length : 0;
        return `
          <div class="collection-card" data-collection-id="${escapeHtml(col.collectionId)}" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <h4 style="font-size: 14px; font-weight: 600;">${escapeHtml(col.name)}</h4>
                <span class="badge badge-captured">${formatCount(count, 'conversación', 'conversaciones')}</span>
              </div>
              <p style="color: var(--text-secondary); font-size: 12px; line-height: 1.4;">${escapeHtml(col.description || 'Sin descripción')}</p>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm btn-open-collection" data-id="${escapeHtml(col.collectionId)}">Abrir</button>
              <button class="btn btn-secondary btn-sm btn-rename-collection" data-id="${escapeHtml(col.collectionId)}">Renombrar</button>
              <button class="btn btn-secondary btn-sm btn-transfer-collection" data-id="${escapeHtml(col.collectionId)}">Continuar en otra IA</button>
              <button class="btn btn-ghost btn-sm btn-delete-collection" data-id="${escapeHtml(col.collectionId)}" title="Eliminar proyecto (las conversaciones se conservan en Biblioteca)">Eliminar</button>
            </div>
          </div>
        `;
      }).join('');

      document.querySelectorAll('.btn-open-collection').forEach(btn => {
        btn.addEventListener('click', () => openCollectionDetail(btn.dataset.id));
      });

      document.querySelectorAll('.btn-rename-collection').forEach(btn => {
        btn.addEventListener('click', () => promptRenameCollection(btn.dataset.id));
      });

      document.querySelectorAll('.btn-transfer-collection').forEach(btn => {
        btn.addEventListener('click', () => startTransferFromCollection(btn.dataset.id));
      });

      document.querySelectorAll('.btn-delete-collection').forEach(btn => {
        btn.addEventListener('click', () => promptDeleteCollection(btn.dataset.id));
      });

      // Hacer que las tarjetas de proyecto en la grilla sean drop targets y admitan contextmenu
      document.querySelectorAll('.collection-card').forEach(card => {
        const colId = card.dataset.collectionId;
        const targetCol = collections.find(c => c.collectionId === colId);

        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (!targetCol) return;
          showContextMenu(e.clientX, e.clientY, [
            { label: `Abrir "${targetCol.name}"`, onClick: () => openCollectionDetail(colId) },
            { label: 'Renombrar proyecto', onClick: () => promptRenameCollection(colId) },
            { label: 'Continuar en otra IA desde proyecto', onClick: () => startTransferFromCollection(colId) },
            { label: 'Exportar (.zip)', onClick: () => exportCollectionZip(colId) },
            { isDivider: true },
            { label: 'Eliminar proyecto', isDanger: true, onClick: () => promptDeleteCollection(colId) }
          ]);
        });

        card.addEventListener('dragover', (e) => {
          if (!e.dataTransfer || !e.dataTransfer.types || !e.dataTransfer.types.includes('application/liner-conversations')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          card.classList.add('drop-target-hover');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target-hover'));
        card.addEventListener('drop', async (e) => {
          e.preventDefault();
          card.classList.remove('drop-target-hover');
          const raw = e.dataTransfer.getData('application/liner-conversations');
          if (!raw) return;
          try {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length > 0) {
              const col = await db.getCollection(colId);
              if (!col) return;
              const existingSet = new Set(col.conversationIds || []);
              const newIds = ids.filter(id => !existingSet.has(id));

              await db.addConversationsToCollection(colId, ids);
              if (newIds.length === 0) {
                showToast(`Ya ${ids.length === 1 ? 'pertenece' : 'pertenecen'} a "${col.name}".`);
              } else {
                showToast(`Añadidas ${formatCount(newIds.length, 'conversación', 'conversaciones')} a "${col.name}".`);
              }
              await updateAllCounts();
              await renderCollectionsView();
            }
          } catch (_) {}
        });
      });

    } catch (err) {
      grid.innerHTML = `<p style="color: var(--accent-red)">Error al cargar proyectos: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function openCollectionDetail(collectionId) {
    const db = getLinerDb();
    if (!db) return;
    await flushProjectEditor();
    const col = await db.getCollection(collectionId);
    if (!col) return;

    if(currentOpenCollectionId!==collectionId)projectFolderFilter=null;
    currentOpenCollectionId = collectionId;
    loadProjectEditor(col);
    const grid = document.getElementById('collections-grid');
    const detailPanel = document.getElementById('collection-detail-panel');
    const titleElem = document.getElementById('collection-detail-title');
    const descElem = document.getElementById('collection-detail-desc');
    const tbody = document.getElementById('collection-table-body');

    if (grid) grid.classList.add('hidden');
    if (detailPanel) detailPanel.classList.remove('hidden');

    if (titleElem) titleElem.textContent = col.name;
    if (descElem) descElem.textContent = `${col.description || 'Sin descripción'} · ${formatCount(col.conversationIds?.length || 0, 'elemento', 'elementos')}`;

    const metadata=new Map((await db.listMetadata()).map(record=>[record.canonicalId,record]));
    const convs=(col.conversationIds||[]).map(id=>{const record=metadata.get(id);return record?{...record,sourcePlatform:record.platform,integrity:{status:record.integrityStatus}}:{canonicalId:id,title:id,messageCount:0,integrity:{status:'failed'}};});
    let projectPage=1;
    const folders=col.organization?.folders||[];
    if(!folders.some(folder=>folder.id===projectFolderFilter))projectFolderFilter=null;
    const folderPanel=document.getElementById('project-folder-nav');
    const renderFolders=()=>{folderPanel.classList.toggle('hidden',!folders.length);folderPanel.innerHTML='<span class="project-folder-label">Carpetas</span><div>'+[{id:'',name:'Todas',conversationIds:col.conversationIds},...folders].map(folder=>'<button type="button" class="project-folder-button '+((folder.id||null)===projectFolderFilter?'active':'')+'" data-folder="'+escapeHtml(folder.id)+'" style="margin-left:'+(folder.parentId?'14px':'0')+'">'+escapeHtml(folder.name)+' <span>'+folder.conversationIds.length+'</span></button>').join('')+'</div>';folderPanel.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{projectFolderFilter=button.dataset.folder||null;projectPage=1;renderFolders();renderProjectRows();}));};
    renderFolders();

    const searchInput = document.getElementById('collection-search-input');
    if (searchInput) {
      searchInput.value = '';
      searchInput.oninput=()=>{projectPage=1;renderProjectRows();};
    }
    function renderProjectRows(){
      const folder=folders.find(folder=>folder.id===projectFolderFilter),members=folder?new Set(folder.conversationIds):null,query=searchInput?.value.trim().toLowerCase()||'';
      const filtered=convs.filter(record=>(!members||members.has(record.canonicalId))&&(!query||(record.title+' '+(record.searchText||'')).toLowerCase().includes(query)));
      currentProjectVisibleIds=filtered.map(record=>record.canonicalId);const pages=Math.max(1,Math.ceil(filtered.length/100));projectPage=Math.min(projectPage,pages);const pageItems=filtered.slice((projectPage-1)*100,projectPage*100);
      document.getElementById('project-page-state').textContent='Página '+projectPage+' de '+pages+' · '+filtered.length+' fuentes';document.getElementById('project-page-prev').disabled=projectPage===1;document.getElementById('project-page-next').disabled=projectPage===pages;

    if (tbody) {
      if (pageItems.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 32px; color: var(--text-secondary);">
              No hay elementos en esta vista. Revisa la búsqueda y la carpeta, o añade una conversación al proyecto.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = pageItems.map(c => {
          const isClip = c.entityType === 'clip' || (c.canonicalId && c.canonicalId.startsWith('clip_'));
          const dateStr = c.updatedAt || c.createdAt ? new Date(c.updatedAt || c.createdAt).toLocaleDateString() : '-';
          const fullDateStr = c.updatedAt || c.createdAt ? new Date(c.updatedAt || c.createdAt).toLocaleString() : '';
          const platformDisplay = escapeHtml(String(c.sourcePlatform || c.source?.platform || 'ChatGPT').toUpperCase());

          let titleDisplay = '';
          let modelDisplay = '';
          let integrityBadge = '';

          if (isClip) {
            titleDisplay = `<span class="chip" style="font-size: 10px; padding: 2px 6px; margin-right: 6px; background: rgba(56, 139, 253, 0.15); color: #58a6ff; border: 1px solid rgba(56, 139, 253, 0.4);">CLIP</span><strong class="btn-inspect-title" style="cursor: pointer;" data-id="${escapeHtml(c.canonicalId)}" title="Ver detalles del clip">${escapeHtml(c.title || c.canonicalId)}</strong>`;
            modelDisplay = c.model ? escapeHtml(c.model) : '<span style="color: var(--text-tertiary)">—</span>';
            if (c.sourceStatus === 'source_unavailable_locally') {
              integrityBadge = `<span class="badge badge-partial" style="font-size: 10px;" title="Conversación origen eliminada localmente. El clip mantiene su contenido íntegro.">Fuente ausente</span>`;
            } else {
              integrityBadge = `<span class="badge badge-captured" style="font-size: 10px;" title="Clip completo">Completo</span>`;
            }
          } else {
            const badgeClass = getBadgeClass(c.integrity?.status);
            titleDisplay = `<strong class="btn-inspect-title" style="cursor: pointer;" data-id="${escapeHtml(c.canonicalId)}">${escapeHtml(c.title || c.canonicalId)}</strong>`;
            modelDisplay = c.model ? escapeHtml(c.model) : '<span style="color: var(--text-tertiary)">—</span>';
            integrityBadge = `<span class="badge ${badgeClass}">${escapeHtml(formatIntegrity(c.integrity?.status))}</span>`;
          }

          const msgCount = c.entityType === 'clip'
            ? (c.selectedMessages?.length || c.messages?.length || c.messageCount || 0)
            : (c.visibleMessageCount !== undefined ? c.visibleMessageCount : (c.messages?.length || c.messageCount || 0));

          return `
            <tr data-id="${escapeHtml(c.canonicalId)}">
              <td class="col-drag">
                <div class="drag-handle" draggable="true" title="Arrastrar para añadir a otra proyecto" data-id="${escapeHtml(c.canonicalId)}">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                    <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
                    <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                    <circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/>
                  </svg>
                </div>
              </td>
              <td class="col-title">${titleDisplay}</td>
              <td class="col-platform"><span>${escapeHtml(platformDisplay)}</span></td>
              <td class="col-model"><span>${modelDisplay}</span></td>
              <td class="col-messages"><span>${msgCount}</span></td>
              <td class="col-date"><span title="${escapeHtml(fullDateStr)}">${dateStr}</span></td>
              <td class="col-integrity">${integrityBadge}</td>
              <td class="col-actions">
                <div style="display: flex; gap: 4px; align-items: center;">
                  <button class="btn btn-ghost btn-sm btn-inspect" data-id="${escapeHtml(c.canonicalId)}">Detalles</button>
                  <button class="btn btn-ghost btn-sm btn-remove-from-coll" data-id="${escapeHtml(c.canonicalId)}" style="color: var(--accent-red);" title="Quitar de este proyecto (permanece en Biblioteca)">Quitar</button>
                  <button class="btn btn-ghost btn-sm btn-coll-row-menu" data-id="${escapeHtml(c.canonicalId)}" title="Más opciones">⋯</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        async function doRemove(targetId) {
          await db.removeConversationFromCollection(collectionId, targetId);
          await openCollectionDetail(collectionId);
          await updateAllCounts();
          showToast('Elemento quitado de el proyecto', {
            actionText: 'Deshacer',
            onAction: async () => {
              await db.addConversationsToCollection(collectionId, [targetId]);
              await openCollectionDetail(collectionId);
              await updateAllCounts();
            }
          });
        }

        tbody.querySelectorAll('.btn-remove-from-coll').forEach(b => {
          b.addEventListener('click', () => doRemove(b.dataset.id));
        });

        tbody.querySelectorAll('.btn-inspect, .btn-inspect-title').forEach(b => {
          b.addEventListener('click', () => openFullReader(b.dataset.id));
        });

        function getRowMenuItems(targetId) {
          const isClip = targetId && (targetId.startsWith('clip_') || (convs.find(c => c.canonicalId === targetId)?.entityType === 'clip'));
          return [
            { label: 'Ver detalles', onClick: () => openFullReader(targetId) },
            { label: 'Quitar de este proyecto', onClick: () => doRemove(targetId) },
            { label: 'Añadir a otra proyecto', onClick: () => openCollectionPicker([targetId]) },
            { label: 'Continuar en otra IA', onClick: () => {
              selectedConversationIds.clear();
              selectedConversationIds.add(targetId);
              updateBulkActionBar();
              const navTrans = document.getElementById('nav-transfers');
              if (navTrans) navTrans.click();
            }},
            { label: 'Exportar .md', onClick: () => exportSingleMarkdown(targetId) },
            { label: 'Exportar .json', onClick: () => exportSingleJson(targetId) },
            { isDivider: true },
            { label: isClip ? 'Eliminar Clip de Lossy' : 'Eliminar de Lossy', isDanger: true, onClick: () => promptDeleteConversation(targetId) }
          ];
        }

        tbody.querySelectorAll('.btn-coll-row-menu').forEach(b => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = b.getBoundingClientRect();
            showContextMenu(rect.left, rect.bottom + 4, getRowMenuItems(b.dataset.id));
          });
        });

        tbody.querySelectorAll('tr').forEach(tr => {
          const rec = convs.find(c => c.canonicalId === tr.dataset.id);
          if (rec) bindDragAffordance(tr, rec);

          tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, getRowMenuItems(tr.dataset.id));
          });
        });
      }
    }
    }
    document.getElementById('project-page-prev').onclick=()=>{projectPage--;renderProjectRows();};document.getElementById('project-page-next').onclick=()=>{projectPage++;renderProjectRows();};
    renderProjectRows();
  }

  // --- CENTRO DE EXPORTACIÓN UNIFICADO (EXPORT CENTER MODAL) ---

  async function openExportCenterModal(targetOrTargets) {
    const db = getLinerDb();
    if (!db) return;

    let targetIds = [];
    if (Array.isArray(targetOrTargets)) {
      targetIds = targetOrTargets.map(t => typeof t === 'string' ? t : (t.canonicalId || t.id)).filter(Boolean);
    } else if (typeof targetOrTargets === 'string') {
      targetIds = [targetOrTargets];
    } else if (targetOrTargets && (targetOrTargets.canonicalId || targetOrTargets.id)) {
      targetIds = [targetOrTargets.canonicalId || targetOrTargets.id];
    }

    if (targetIds.length === 0) {
      showToast('Selecciona al menos una conversación o clip para exportar.');
      return;
    }

    // Cargar entidades completas desde la base de datos local
    const entities = [];
    for (const id of targetIds) {
      let ent = await db.getConversation(id);
      if (!ent && typeof db.getClip === 'function') {
        ent = await db.getClip(id);
      }
      if (!ent && Array.isArray(currentLoadedConversations)) {
        const found = currentLoadedConversations.find(c => c.canonicalId === id || c.id === id);
        if (found) ent = found;
      }
      if (ent) entities.push(ent);
    }

    if (entities.length === 0) {
      showToast('No se encontraron los datos locales de las entidades seleccionadas.');
      return;
    }

    const isMulti = entities.length > 1;
    const exportCenterClass = (window.Lossy && window.Lossy.ExportCenter && window.Lossy.ExportCenter.ExportCenter) || null;
    const exportCenterModule = (window.Lossy && window.Lossy.ExportCenter) || null;
    const exportCenter = exportCenterClass ? new exportCenterClass() : null;

    let allAssets = [];
    if (exportCenterModule && exportCenterModule.AssetResolver) {
      entities.forEach(ent => {
        try {
          const assets = exportCenterModule.AssetResolver.resolveAssetsForEntity(ent);
          if (Array.isArray(assets)) allAssets.push(...assets);
        } catch (_) {}
      });
    }

    const assetNoticeHtml = allAssets.length > 0 ? `
        <div class="export-asset-notice-card" style="padding: 10px 12px; background: rgba(56, 139, 253, 0.1); border: 1px solid var(--accent-blue, #388bfd); border-radius: var(--radius-sm); font-size: 11.5px; line-height: 1.45;">
          <strong style="color: var(--accent-blue, #58a6ff);">Recursos e Imágenes Detectados:</strong>
          <p style="margin: 4px 0 0 0; color: var(--text-secondary);">Se han detectado ${allAssets.length} ${allAssets.length === 1 ? 'recurso o imagen' : 'recursos o imágenes'} en el contexto seleccionado. Puedes seleccionar abajo el tratamiento (referenciar URLs remotas o incrustar recursos en el paquete).</p>
        </div>
    ` : '';

    let pinnedQuick = ['md', 'pdf', 'docx'];
    if (exportCenterModule && typeof exportCenterModule.getPinnedQuickExports === 'function') {
      try {
        pinnedQuick = await exportCenterModule.getPinnedQuickExports();
      } catch (_) {}
    }

    const formatMeta = {
      md: { label: 'MD', cls: 'fmt-md', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 10V6l2 2 2-2v4M11 6v4"/></svg>' },
      pdf: { label: 'PDF', cls: 'fmt-pdf', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h7l3 3v9H3z"/><path d="M6 9h4M6 12h2"/></svg>' },
      docx: { label: 'DOCX', cls: 'fmt-docx', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h7l3 3v9H3z"/><path d="M5 8l1.5 4 1.5-4 1.5 4 1.5-4"/></svg>' },
      txt: { label: 'TXT', cls: 'fmt-txt', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h10v12H3z"/><path d="M6 6h4M8 6v6"/></svg>' },
      json: { label: 'JSON', cls: 'fmt-json', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M6 5c-1 0-1 1-1 3s0 3 1 3M10 5c1 0 1 1 1 3s0 3-1 3"/></svg>' },
      png: { label: 'PNG', cls: 'fmt-png', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="6" cy="6" r="1.5"/><path d="m14 11-3-3-5 5"/></svg>' }
    };

    const quickButtonsHtml = (pinnedQuick && pinnedQuick.length > 0 ? pinnedQuick : ['md', 'pdf', 'docx']).map(fmt => {
      const item = formatMeta[fmt] || { label: fmt.toUpperCase(), cls: `fmt-${fmt}`, icon: '' };
      return `
        <button type="button" class="quick-export-chip btn-quick-export-action ${item.cls}" data-format="${fmt}" title="Exportación rápida ${fmt.toUpperCase()}">
          ${item.icon}
          <span>${item.label}</span>
        </button>
      `;
    }).join(' ');

    const formatSpecs = [
      { fmt: 'md', name: 'Markdown (.md)', desc: 'Documento estructurado con Frontmatter YAML e isomorfismo.', badge: 'IA / Portabilidad' },
      { fmt: 'txt', name: 'Texto Plano (.txt)', desc: 'Estructura legible pura sin etiquetas ni dependencias.', badge: 'Compacto' },
      { fmt: 'json', name: 'JSON Canónico (.json)', desc: 'Esquema íntegro con procedencia, DAG y metadatos.', badge: 'Intercambio' },
      { fmt: 'pdf', name: 'PDF rápido (.pdf)', desc: 'Descarga directa con fuentes estándar. Para tablas, fórmulas y Unicode, abre el editor de documento.', badge: 'Básico' },
      { fmt: 'docx', name: 'Documento Word (.docx)', desc: 'OpenXML editable con bloques de código e imágenes incrustadas.', badge: 'Humano' },
      { fmt: 'png', name: 'Imagen PNG (.png)', desc: 'Captura visual renderizada con sintaxis y tipografía limpia.', badge: 'Visual' }
    ];

    const formatCardsHtml = formatSpecs.map(f => {
      const isPinned = pinnedQuick.includes(f.fmt);
      const isDefaultChecked = f.fmt === 'md';
      return `
        <div class="export-format-card" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--bg-base);">
          <label style="display: flex; gap: 8px; align-items: flex-start; flex: 1; cursor: pointer; margin: 0;">
            <input type="radio" name="export-format" value="${f.fmt}" ${isDefaultChecked ? 'checked' : ''} style="margin-top: 3px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <strong style="font-size: 12.5px; color: var(--text-primary);">${f.name}</strong>
                <span style="font-size: 9.5px; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-tertiary);">${f.badge}</span>
              </div>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 3px; line-height: 1.35;">${f.desc}</div>
            </div>
          </label>
          <button type="button" class="btn btn-ghost btn-xs btn-pin-quick-export" data-format="${f.fmt}" title="${isPinned ? 'Desfijar de accesos rápidos' : 'Fijar en accesos rápidos del Popup (máx 3)'}" style="flex-shrink: 0; padding: 3px 7px; font-size: 10.5px; border: 1px solid ${isPinned ? 'var(--accent-blue)' : 'var(--border-subtle)'}; background: ${isPinned ? 'rgba(56, 139, 253, 0.15)' : 'transparent'}; color: ${isPinned ? 'var(--accent-blue, #58a6ff)' : 'var(--text-tertiary)'}; cursor: pointer; border-radius: 4px;">
            ${isPinned ? 'Fijado' : 'Fijar'}
          </button>
        </div>
      `;
    }).join('');

    const title = isMulti
      ? `Centro de Exportación Masiva (${entities.length} elementos)`
      : `Centro de Exportación: ${escapeHtml(entities[0].title || 'Conversación')}`;

    const totalMsgs = entities.reduce((sum, e) => sum + (e.conversationMessageCount || e.visibleMessageCount || (e.messages || e.selectedMessages || []).length || 0), 0);

    const bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 14px; font-size: 12.5px;">
        <div class="export-studio-entry"><strong>Prepara el documento antes de descargar</strong><p>Selecciona mensajes y revisa imágenes, tablas y fórmulas. Ajusta el PDF en una vista amplia.</p><button type="button" id="btn-modal-document" class="btn btn-primary">Abrir editor de documento</button></div>
        <div style="padding: 10px 12px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600;">Alcance: ${isMulti ? `${entities.length} elementos de contexto` : '1 conversación/clip'}</span>
            <span style="color: var(--text-secondary); font-size: 11px;">~${totalMsgs} mensajes en total</span>
          </div>
          ${isMulti ? `<p style="font-size: 11.5px; color: var(--text-tertiary); margin-top: 4px; margin-bottom: 0;">Los archivos se empaquetarán en un archivo .zip neutral con Portability Manifest v1.</p>` : ''}
        </div>
        ${assetNoticeHtml}

        <div>
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px;">Exportaciones Rápidas Frecuentes</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${quickButtonsHtml}
          </div>
        </div>

        <div>
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 8px;">Seleccionar Formato</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px;">
            ${formatCardsHtml}
          </div>
        </div>

        <div style="display: flex; gap: 14px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 180px;">
            <label for="export-profile-select" style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">Perfil de Contenido:</label>
            <select id="export-profile-select" class="select-input" style="width: 100%; font-size: 12px;">
              <option value="human">Humano (Lectura y maquetación óptima)</option>
              <option value="ai">AI / LLM (Metadatos completos y procedencia)</option>
              <option value="compact">Compacto (Densidad de información)</option>
            </select>
          </div>
          <div style="flex: 1; min-width: 180px;">
            <label for="export-asset-select" style="display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">Tratamiento de Recursos / Imágenes:</label>
            <select id="export-asset-select" class="select-input" style="width: 100%; font-size: 12px;">
              <option value="package" selected>Empaquetar recursos (ZIP con /assets/) [RECOMENDADO]</option>
              <option value="reference">Referenciar URLs originales</option>
              <option value="embed">Incrustar recursos en línea (DataURI Base64)</option>
              <option value="omit">Omitir recursos gráficos</option>
            </select>
          </div>
        </div>

        <div>
          <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px;">
            <input type="checkbox" id="export-include-technical">
            <span>Incluir eventos técnicos del DAG (herramientas, bash, css, llamadas del sistema)</span>
          </label>
        </div>
      </div>
    `;

    const executeAndDownload = async (format, profile, options = {}) => {
      try {
        if (!exportCenter) {
          showToast('Módulo ExportCenter no disponible en runtime.', { isError: true });
          return;
        }

        // P1: Asset Fidelity & Resource Strategy Prompt
        if (allAssets.length > 0 && !options.imageStrategy) {
          if (format === 'md') {
            const confirmedStrategy = await showModal({
              title: 'Recursos e Imágenes en Markdown',
              bodyHtml: `
                <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
                  <p style="margin: 0; color: var(--text-secondary);">
                    Esta conversación contiene <strong>${allAssets.length}</strong> ${allAssets.length === 1 ? 'imagen o recurso gráfico' : 'imágenes o recursos gráficos'}. Selecciona cómo deseas gestionarlos en la exportación:
                  </p>
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--accent-blue); border-radius: var(--radius-sm); background: rgba(56, 139, 253, 0.08); cursor: pointer;">
                      <input type="radio" name="modal-md-asset-choice" value="package" checked style="margin-top: 2px;">
                      <div>
                        <strong style="color: var(--accent-blue); font-size: 13px;">1. Empaquetar recursos (ZIP con /assets/) [RECOMENDADO]</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Descarga un archivo .zip que incluye el documento .md y una carpeta /assets/ con los archivos de imagen locales.</div>
                      </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer;">
                      <input type="radio" name="modal-md-asset-choice" value="reference" style="margin-top: 2px;">
                      <div>
                        <strong style="font-size: 13px;">2. Conservar enlaces y URLs originales</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Genera un único archivo .md con enlaces web directos al origen de ChatGPT/OpenAI.</div>
                      </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer;">
                      <input type="radio" name="modal-md-asset-choice" value="embed" style="margin-top: 2px;">
                      <div>
                        <strong style="font-size: 13px;">3. Incrustar imágenes en Markdown (Data URI Base64)</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Codifica las imágenes en Base64 dentro del propio archivo .md para máxima autonomía.</div>
                      </div>
                    </label>
                  </div>
                </div>
              `,
              confirmText: 'Exportar Markdown',
              cancelText: 'Cancelar'
            });
            if (!confirmedStrategy) return;
            options.imageStrategy = document.querySelector('input[name="modal-md-asset-choice"]:checked')?.value || 'package';
          } else if (format === 'txt') {
            const confirmedStrategy = await showModal({
              title: 'Recursos e Imágenes en Texto Plano',
              bodyHtml: `
                <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
                  <p style="margin: 0; color: var(--text-secondary);">
                    Esta conversación contiene <strong>${allAssets.length}</strong> ${allAssets.length === 1 ? 'imagen' : 'imágenes'}. El formato .txt no admite incrustación binaria ni Base64.
                  </p>
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--accent-blue); border-radius: var(--radius-sm); background: rgba(56, 139, 253, 0.08); cursor: pointer;">
                      <input type="radio" name="modal-txt-asset-choice" value="package" checked style="margin-top: 2px;">
                      <div>
                        <strong style="color: var(--accent-blue); font-size: 13px;">1. TXT + recursos en ZIP (/assets/) [RECOMENDADO]</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Empaqueta el archivo de texto .txt junto con las imágenes descargadas en la carpeta /assets/.</div>
                      </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer;">
                      <input type="radio" name="modal-txt-asset-choice" value="reference" style="margin-top: 2px;">
                      <div>
                        <strong style="font-size: 13px;">2. Conservar referencias y URLs en el texto</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Incluye las URLs de los recursos visuales en líneas de texto legible.</div>
                      </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer;">
                      <input type="radio" name="modal-txt-asset-choice" value="omit" style="margin-top: 2px;">
                      <div>
                        <strong style="font-size: 13px;">3. Exportar sólo texto (omitir recursos)</strong>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Genera únicamente el texto plano omitiendo los recursos con nota de procedencia.</div>
                      </div>
                    </label>
                  </div>
                </div>
              `,
              confirmText: 'Exportar Texto',
              cancelText: 'Cancelar'
            });
            if (!confirmedStrategy) return;
            options.imageStrategy = document.querySelector('input[name="modal-txt-asset-choice"]:checked')?.value || 'package';
          } else if (format === 'pdf' || format === 'docx') {
            const unavailable = allAssets.filter(a => a.availability === 'unavailable');
            if (unavailable.length > 0) {
              showToast(`Aviso: ${unavailable.length} ${unavailable.length === 1 ? 'imagen no disponible localmente' : 'imágenes no disponibles localmente'}. Se incluirán notas explicativas con procedencia.`);
            }
          }
        }

        showToast('Generando exportación local...', { durationMs: 2000 });
        if (isMulti) {
          const bundleResult = await exportCenter.exportBulk(entities, format, profile, options);
          downloadBlob(bundleResult.data, bundleResult.filename, bundleResult.mimeType);
          showToast(`Paquete ZIP generado: ${bundleResult.filename}`);
        } else {
          const singleResult = await exportCenter.exportSingle(entities[0], format, profile, options);
          downloadBlob(singleResult.data, singleResult.filename, singleResult.mimeType);
          showToast(`Exportación generada: ${singleResult.filename}`);
        }
      } catch (err) {
        console.error('Error al exportar:', err);
        showToast(`Error al exportar: ${err.message}`, { isError: true });
      }
    };

    showModal({
      title,
      bodyHtml,
      confirmText: isMulti ? 'Descargar Paquete ZIP' : 'Descargar Archivo',
      cancelText: 'Cerrar',
      onRender: (modalBody) => {
        modalBody.querySelector('#btn-modal-document')?.addEventListener('click',()=>{document.getElementById('app-modal-close').click();openDocumentStudio(targetIds).catch(error=>showToast(error.message));});
        modalBody.querySelectorAll('.btn-quick-export-action').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const fmt = btn.dataset.format;
            const incTech = modalBody.querySelector('#export-include-technical')?.checked || false;
            const profile = fmt === 'md' || fmt === 'txt' ? 'ai' : 'human';
            const closeBtn = document.getElementById('app-modal-close');
            if (closeBtn) closeBtn.click();
            await executeAndDownload(fmt, profile, { includeTechnicalEvents: incTech });
          });
        });

        modalBody.querySelectorAll('.btn-pin-quick-export').forEach(pinBtn => {
          pinBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const fmt = pinBtn.dataset.format;
            if (!exportCenterModule || typeof exportCenterModule.getPinnedQuickExports !== 'function') return;
            let currentPinned = await exportCenterModule.getPinnedQuickExports();
            if (currentPinned.includes(fmt)) {
              if (currentPinned.length <= 1) {
                showToast('Debes mantener al menos 1 formato rápido fijado.', { isError: true });
                return;
              }
              currentPinned = currentPinned.filter(x => x !== fmt);
            } else {
              if (currentPinned.length >= 3) {
                showToast('Máximo 3 formatos rápidos fijados. Desfija uno primero.', { isError: true });
                return;
              }
              currentPinned.push(fmt);
            }
            await exportCenterModule.setPinnedQuickExports(currentPinned);
            const isNowPinned = currentPinned.includes(fmt);
            pinBtn.textContent = isNowPinned ? 'Fijado' : 'Fijar';
            pinBtn.style.borderColor = isNowPinned ? 'var(--accent-blue)' : 'var(--border-subtle)';
            pinBtn.style.background = isNowPinned ? 'rgba(56, 139, 253, 0.15)' : 'transparent';
            pinBtn.style.color = isNowPinned ? 'var(--accent-blue, #58a6ff)' : 'var(--text-tertiary)';
            showToast(`Accesos rápidos actualizados: ${currentPinned.map(x => x.toUpperCase()).join(', ')}`);
          });
        });
      }
    }).then(async (confirmed) => {
      if (!confirmed) return;
      const modalBody = document.getElementById('app-modal-body');
      if (!modalBody) return;
      const selectedFormatInput = modalBody.querySelector('input[name="export-format"]:checked');
      const format = selectedFormatInput ? selectedFormatInput.value : 'md';
      const profile = modalBody.querySelector('#export-profile-select')?.value || 'human';
      const assetStrategy = modalBody.querySelector('#export-asset-select')?.value || 'reference';
      const includeTechnicalEvents = modalBody.querySelector('#export-include-technical')?.checked || false;

      await executeAndDownload(format, profile, {
        imageStrategy: assetStrategy,
        includeTechnicalEvents
      });
    });
  }

  // --- BULK EXPORTS (MARKDOWN Y JSON BUNDLES EN FORMATO ZIP) ---

  async function bulkExportMarkdown(customBundleName = null, targetIds = null) {
    const db = getLinerDb();
    const ids = Array.isArray(targetIds) ? targetIds : Array.from(selectedConversationIds);
    if (!db || ids.length === 0) return;
    const convs = [];
    for (const id of ids) {
      const c = await db.getConversation(id);
      if (c) convs.push(c);
    }
    if (convs.length === 0) return;

    const mdAdapterClass = (window.Lossy && window.Lossy.MarkdownBundleAdapter) || (window.Liner && window.Liner.MarkdownBundleAdapter);
    if (mdAdapterClass) {
      const adapter = new mdAdapterClass();
      const pkg = typeof adapter.generatePackageAsync === 'function'
        ? await adapter.generatePackageAsync(convs)
        : adapter.generatePackage(convs);

      const zipBuilder = (window.Lossy && window.Lossy.ZipBuilder) || (window.Liner && window.Liner.ZipBuilder) || null;
      if (zipBuilder && typeof zipBuilder.createZip === 'function') {
        const zipBytes = zipBuilder.createZip(pkg.files);
        const name = customBundleName || `lossy_markdown_bundle_${convs.length}_items.zip`;
        downloadBlob(zipBytes, name, 'application/zip');
      } else {
        for (const [filename, content] of Object.entries(pkg.files)) {
          downloadBlob(content, filename.replace(/\//g, '_'), 'text/markdown;charset=utf-8');
        }
      }
      showToast(`Exportación Markdown de ${convs.length} elementos completada.`);
    }
  }

  async function bulkExportJson(customBundleName = null, targetIds = null) {
    const db = getLinerDb();
    const ids = Array.isArray(targetIds) ? targetIds : Array.from(selectedConversationIds);
    if (!db || ids.length === 0) return;
    const convs = [];
    for (const id of ids) {
      const c = await db.getConversation(id);
      if (c) convs.push(c);
    }
    if (convs.length === 0) return;

    const files = {};
    const manifest = {
      specVersion: '1.0.0',
      canonicalVersion: '1.3.1',
      exportedAt: new Date().toISOString(),
      generator: 'Lossy Workspace v1.3.1',
      totalConversations: convs.length,
      conversations: convs.map(c => ({
        canonicalId: c.canonicalId,
        title: c.title,
        messageCount: c.messages?.length || 0,
        model: c.model,
        integrity: c.integrity?.status || 'captured'
      }))
    };

    files['manifest.json'] = JSON.stringify(manifest, null, 2);
    for (const c of convs) {
      files[`conversations/${c.canonicalId}.json`] = JSON.stringify(c, null, 2);
    }

    const zipBuilder = (window.Lossy && window.Lossy.ZipBuilder) || (window.Liner && window.Liner.ZipBuilder) || null;
    if (zipBuilder && typeof zipBuilder.createZip === 'function') {
      const zipBytes = zipBuilder.createZip(files);
      const name = customBundleName || `lossy_canonical_json_bundle_${convs.length}_items.zip`;
      downloadBlob(zipBytes, name, 'application/zip');
    } else {
      downloadBlob(JSON.stringify(manifest, null, 2), 'conversations_manifest.json', 'application/json');
    }
    showToast(`Exportación JSON canónica de ${convs.length} elementos completada.`);
  }

  // --- DIAGNÓSTICOS VIEW ---
  async function renderDiagnosticsView() {
    const list = document.getElementById('diag-capabilities-list');
    const logBox = document.getElementById('diag-events-log');
    const jobsBox = document.getElementById('diag-jobs-log');
    if (!list) return;

    list.innerHTML = `
      <div class="cap-item"><span>Detección Pasiva sin Bloqueo</span><span style="color: var(--accent-green);">activo</span></div>
      <div class="cap-item"><span>Adquisición Estructurada (Session)</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Enumeración de Historial (List)</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Detección de Bifurcaciones (Branches)</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Captura de Adjuntos</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Reproyecto DOM Virtualizada (Fallback)</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Cancelación y Pausa de Adquisición</span><span style="color: var(--accent-green);">disponible</span></div>
      <div class="cap-item"><span>Cero Inferencia de Modelo (No Guessing)</span><span style="color: var(--accent-green);">cumplido</span></div>
    `;

    const db = getLinerDb();
    if (!db) return;

    if (logBox) {
      const meta = await db.listMetadata();
      const degraded = meta.filter(m => m.integrityStatus === 'partial' || m.integrityStatus === 'degraded' || m.integrityStatus === 'failed');
      if (degraded.length > 0) {
        logBox.innerHTML = degraded.map(d => `
          <div style="padding: 8px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="color: var(--accent-amber); font-weight: 600;">[${escapeHtml(formatIntegrity(d.integrityStatus))}]</span>
              <strong>${escapeHtml(d.title)}</strong>
              <div style="color: var(--text-tertiary); font-size: 11px;">${d.messageCount} mensajes · Método: ${escapeHtml(d.acquisitionMethod || 'dom-harvest')}</div>
            </div>
            <button class="btn btn-secondary btn-sm btn-inspect-diag" data-id="${escapeHtml(d.canonicalId)}">Inspeccionar</button>
          </div>
        `).join('');

        logBox.querySelectorAll('.btn-inspect-diag').forEach(btn => {
          btn.addEventListener('click', () => openFullReader(btn.dataset.id));
        });
      } else {
        logBox.innerHTML = '<p class="text-muted">Sin avisos de truncamiento ni fallos en la biblioteca local.</p>';
      }
    }

    if (jobsBox) {
      let jobs = [];
      if (typeof db.listJobs === 'function') {
        jobs = await db.listJobs();
      }
      if (jobs.length > 0) {
        jobsBox.innerHTML = jobs.slice(0, 8).map(j => `
          <div style="padding: 8px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${escapeHtml(j.type || 'Trabajo')}</strong> — <code style="font-family: var(--font-mono); font-size: 11px;">${escapeHtml(j.jobId)}</code>
              <div style="color: var(--text-tertiary); font-size: 11px;">Estado: <span style="font-weight: 600; color: ${j.status === 'completed' ? 'var(--accent-green)' : (j.status === 'cancelled' ? 'var(--accent-amber)' : 'var(--text-secondary)')};">${escapeHtml(j.status)}</span> · Completados: ${j.completedItems} / ${j.totalItems}</div>
            </div>
            <span style="color: var(--text-tertiary); font-size: 11px;">${formatRelativeTime(j.updatedAt || j.createdAt)}</span>
          </div>
        `).join('');
      } else {
        jobsBox.innerHTML = '<p class="text-muted">Sin historial de trabajos previos.</p>';
      }
    }
  }

  function exportDiagnosticsFile() {
    const diagModule = (window.Lossy && window.Lossy.Diagnostics) || (window.Liner && window.Liner.Diagnostics);
    const diagManager = diagModule ? diagModule.defaultDiagnostics : null;
    const cleanDiag = diagManager ? diagManager.exportDiagnostics({ totalCached: currentLoadedConversations.length }) : {
      exportedAt: new Date().toISOString(),
      product: 'Lossy Context Portability',
      version: chrome.runtime.getManifest().version,
      totalConversations: currentLoadedConversations.length
    };
    downloadBlob(JSON.stringify(cleanDiag, null, 2), 'lossy-diagnostics.json', 'application/json');
  }

  // --- INGESTA DE EXPORT OFICIAL DE CHATGPT ---
  function setupOfficialExportImport() {
    const fileInput = document.getElementById('file-import-export');
    const statusDiv = document.getElementById('import-status');
    if (!fileInput || !statusDiv) return;
    let importing = false;

    fileInput.addEventListener('change', async (e) => {
      if (importing) return;
      const file = e.target.files[0];
      if (!file) return;
      importing = true;
      fileInput.disabled = true;
      let savedCount = 0;
      let expectedCount = 0;

      statusDiv.innerHTML = '<p style="color: var(--text-secondary)">Leyendo archivo oficial de ChatGPT...</p>';

      try {
        let rawJson = null;
        if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
          statusDiv.innerHTML = '<p style="color: var(--text-secondary)">Desempaquetando archivo ZIP oficial...</p>';
          const zipModule = (window.Lossy && window.Lossy.ZipBuilder) || (window.Liner && window.Liner.ZipBuilder);
          if (!zipModule || typeof zipModule.unzip !== 'function') {
            throw new Error('Módulo ZipBuilder no disponible para descompresión');
          }
          const arrayBuffer = await file.arrayBuffer();
          const unzippedFiles = await zipModule.unzip(arrayBuffer);
          const candidates = Object.entries(unzippedFiles).filter(([name]) => name.split('/').pop() === 'conversations.json');
          if (candidates.length === 0) {
            throw new Error('El archivo ZIP no contiene "conversations.json"');
          }
          if (candidates.length > 1) throw new Error('El ZIP contiene varios archivos conversations.json; importa uno solo');
          const convEntry = candidates[0][1];
          const text = typeof convEntry === 'string' ? convEntry : new TextDecoder('utf-8').decode(convEntry);
          rawJson = JSON.parse(text);
        } else {
          const text = await file.text();
          rawJson = JSON.parse(text);
        }

        const conversationsArray = Array.isArray(rawJson) ? rawJson
          : (rawJson && typeof rawJson === 'object' && Object.hasOwn(rawJson, 'conversations') ? rawJson.conversations : [rawJson]);

        const acqManagerClass = (window.Lossy && window.Lossy.ChatGPTAcquisitionManager) || (window.Liner && window.Liner.ChatGPTAcquisitionManager) || null;
        if (!acqManagerClass) {
          throw new Error('ChatGPTAcquisitionManager no disponible en memoria');
        }

        const manager = new acqManagerClass();
        const canonicalList = manager.ingestOfficialExport(conversationsArray);
        expectedCount = canonicalList.length;

        const db = getLinerDb();
        if (!db) throw new Error('Almacenamiento persistente no disponible');
        if (db) {
          for (const conv of canonicalList) {
            await db.saveConversation(conv);
            savedCount++;
          }
        }

        statusDiv.innerHTML = `<p style="color: var(--accent-green)">Se importaron y normalizaron con éxito ${canonicalList.length} conversaciones oficiales.</p>`;
        await loadLibraryData();

      } catch (err) {
        const progress = savedCount > 0 ? ` Se guardaron ${savedCount} de ${expectedCount} conversaciones. Puedes volver a importar el archivo para completar las restantes.` : '';
        statusDiv.innerHTML = `<p style="color: var(--accent-red)">Error en importación: ${escapeHtml(err.message)}${progress}</p>`;
      } finally {
        importing = false;
        fileInput.disabled = false;
        fileInput.value = '';
      }
    });
  }

  // --- DISCOVERY / SINCRONIZAR DESDE CHATGPT (FAIL-CLOSED RUNTIME SHIELD) ---
  async function refreshFromChatGPT() {
    const btnRefresh = document.getElementById('btn-header-refresh');
    if (btnRefresh) btnRefresh.classList.add('is-busy');

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          const res = await safeTabMessagingWithAutoInject(tab.id, { action: 'LIST_CONVERSATIONS', offset: 0, limit: 30 });
          if (!res || !res.success) {
            console.warn('[Liner Workspace] Fallback pasivo: la pestaña de ChatGPT no tiene content script activo o falló:', res?.error);
            showToast('Pestaña de ChatGPT sin content script activo. Abre o recarga ChatGPT.');
            if (btnRefresh) btnRefresh.classList.remove('is-busy');
            return;
          }

          try {
            if (res.data && Array.isArray(res.data.items)) {
              const db = getLinerDb();
              if (db) {
                for (const it of res.data.items) {
                  const canonicalConv = {
                    canonicalId: `conv_chatgpt_${it.id}`,
                    title: it.title || 'Conversación ChatGPT',
                    source: { platform: 'chatgpt', conversationId: it.id, url: `https://chatgpt.com/c/${it.id}`, acquisitionMethod: 'structured-session' },
                    model: null,
                    createdAt: it.create_time ? new Date(it.create_time * 1000).toISOString() : new Date().toISOString(),
                    updatedAt: it.update_time ? new Date(it.update_time * 1000).toISOString() : new Date().toISOString(),
                    messages: [],
                    integrity: { status: 'uncaptured', messageCount: 0, warnings: [], acquisitionMethod: 'structured-session', browserVerified: true },
                    attachments: [],
                    references: []
                  };
                  await db.saveConversation(canonicalConv);
                }
              }
              showToast(`Sincronizadas ${res.data.items.length} conversaciones desde ChatGPT.`);
            }
          } catch (err) {
            console.warn('[Liner Workspace] Error guardando conversaciones:', err);
            showToast('No se pudo guardar la sincronización: ' + err.message);
          } finally {
            await loadLibraryData();
            if (btnRefresh) btnRefresh.classList.remove('is-busy');
          }
          return;
        } else {
          showToast('No se encontró ninguna pestaña abierta de ChatGPT.');
        }
      }
    } catch (err) {
      console.warn('[Liner Workspace] Fallback en sincronización:', err);
      showToast('No se pudo sincronizar: ' + err.message);
    }

    await loadLibraryData();
    if (btnRefresh) btnRefresh.classList.remove('is-busy');
  }

  async function syncPendingClipsFromStorage() {
    if (typeof chrome==='undefined' || !chrome.storage?.local) return;
    const stored=await chrome.storage.local.get(['pending_clips']);
    const pending=Array.isArray(stored.pending_clips)?stored.pending_clips:[];
    if(!pending.length)return;
    const db=getLinerDb();if(!db)return;
    const failed=[];let saved=0;
    for(const original of pending){
      const clip={...original,selectedMessages:original.selectedMessages||original.messages||[]};
      try{await db.saveClip(clip);saved++;}catch(error){failed.push(original);console.warn('No se pudo importar un clip pendiente:',error.message);}
    }
    if(failed.length)await chrome.storage.local.set({pending_clips:failed});
    else await chrome.storage.local.remove(['pending_clips']);
    if(saved){showToast(saved+' clips importados desde ChatGPT.');await loadLibraryData();}
  }

  // --- INICIALIZACIÓN GENERAL ---
  document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSearchAndFilters();
    (async()=>{
      await loadLibraryData();
      const params=new URLSearchParams(location.search);
      const id=params.get('context');
      if(id && await getLinerDb()?.getConversation(id)){
        selectedConversationIds.add(id);updateBulkActionBar();
        const target=params.get('target');
        if(['generic','claude','markdown'].includes(target))document.querySelector('input[name="transfer-target"][value="'+target+'"]').checked=true;
        document.getElementById('nav-transfers')?.click();
        await updateTransferBuilder();
      }
    })().catch(error=>showToast(error.message,{isError:true}));
    setupOfficialExportImport();
    syncPendingClipsFromStorage().catch(console.warn);

    const btnOpenFullReader = document.getElementById('btn-open-full-reader');
    if (btnOpenFullReader) {
      btnOpenFullReader.addEventListener('click', () => {
        if (currentActiveConversation) {
          openFullReader(currentActiveConversation.canonicalId);
        }
      });
    }

    const btnFullReaderClose = document.getElementById('btn-full-reader-close');
    if (btnFullReaderClose) {
      btnFullReaderClose.addEventListener('click', closeFullReader);
    }

    const fullReaderOverlayElem = document.getElementById('full-reader-overlay');
    if (fullReaderOverlayElem) {
      fullReaderOverlayElem.addEventListener('click', (e) => {
        if (e.target === fullReaderOverlayElem) {
          closeFullReader();
        }
      });
    }

    const btnFullReaderSelectAll = document.getElementById('btn-full-reader-select-all');
    if (btnFullReaderSelectAll) {
      btnFullReaderSelectAll.addEventListener('click', () => {
        if (!currentFullReaderEntity) return;
        const msgs = currentFullReaderEntity.selectedMessages || currentFullReaderEntity.messages || [];
        msgs.forEach((_, i) => fullReaderSelectedIndices.add(i));
        document.querySelectorAll('#full-reader-stream .reader-turn-cb').forEach(cb => { cb.checked = true; });
        document.querySelectorAll('#full-reader-stream .reader-turn-card').forEach(c => { c.classList.add('is-selected'); });
        updateFullReaderSelectionUi();
      });
    }

    const btnFullReaderClearSelect = document.getElementById('btn-full-reader-clear-select');
    if (btnFullReaderClearSelect) {
      btnFullReaderClearSelect.addEventListener('click', () => {
        fullReaderSelectedIndices.clear();
        fullReaderLastCheckedIndex = null;
        document.querySelectorAll('#full-reader-stream .reader-turn-cb').forEach(cb => { cb.checked = false; });
        document.querySelectorAll('#full-reader-stream .reader-turn-card').forEach(c => { c.classList.remove('is-selected'); });
        updateFullReaderSelectionUi();
      });
    }

    const btnFullReaderClip = document.getElementById('btn-full-reader-clip');
    if (btnFullReaderClip) {
      btnFullReaderClip.addEventListener('click', () => {
        if (!currentFullReaderEntity) return;
        const selected = Array.from(fullReaderSelectedIndices);
        promptCreateClip(currentFullReaderEntity, selected);
      });
    }

    const btnFullReaderExport = document.getElementById('btn-full-reader-export');
    if (btnFullReaderExport) {
      btnFullReaderExport.addEventListener('click', () => {
        if (!currentFullReaderEntity) return;
        openExportCenterModal([currentFullReaderEntity.canonicalId]);
      });
    }

    const btnFullReaderColl = document.getElementById('btn-full-reader-collection');
    if (btnFullReaderColl) {
      btnFullReaderColl.addEventListener('click', () => {
        if (!currentFullReaderEntity) return;
        openCollectionPicker([currentFullReaderEntity.canonicalId]);
      });
    }

    const fullReaderSearchInput = document.getElementById('full-reader-search');
    if (fullReaderSearchInput) {
      fullReaderSearchInput.addEventListener('input', () => {
        if (!currentFullReaderEntity) return;
        const techToggle = document.getElementById('full-reader-toggle-tech');
        renderFullReaderStream(currentFullReaderEntity, {
          includeTechnicalEvents: techToggle?.checked || false,
          searchQuery: fullReaderSearchInput.value
        });
      });
    }

    const fullReaderTechToggle = document.getElementById('full-reader-toggle-tech');
    if (fullReaderTechToggle) {
      fullReaderTechToggle.addEventListener('change', () => {
        if (!currentFullReaderEntity) return;
        const searchInput = document.getElementById('full-reader-search');
        renderFullReaderStream(currentFullReaderEntity, {
          includeTechnicalEvents: fullReaderTechToggle.checked,
          searchQuery: searchInput?.value || ''
        });
      });
    }

    document.addEventListener('keydown', (e) => {
      const reader=document.getElementById('full-reader-overlay');
      if(e.key==='Tab'&&reader&&!reader.classList.contains('hidden')&&document.getElementById('app-modal-backdrop')?.classList.contains('hidden')){
        const controls=[...reader.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
        if(controls.length){const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&(document.activeElement===first||!reader.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!reader.contains(document.activeElement))){e.preventDefault();first.focus();}}
      }
      if (e.key === 'Escape' && document.getElementById('app-modal-backdrop')?.classList.contains('hidden')) {
        const overlay = document.getElementById('full-reader-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          closeFullReader();
        }
      }
    });

    const closeBtn = document.getElementById('btn-close-inspector');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        const drawer = document.getElementById('inspector-drawer');
        if (drawer) drawer.classList.add('hidden');
      });
    }

    const refreshBtn = document.getElementById('btn-header-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refreshFromChatGPT);
    }

    const newTransferBtn = document.getElementById('btn-header-new-transfer');
    if (newTransferBtn) {
      newTransferBtn.addEventListener('click', () => {
        const navTransfers = document.getElementById('nav-transfers');
        if (navTransfers) navTransfers.click();
      });
    }

    const bulkTransferBtn = document.getElementById('btn-bulk-transfer');
    if (bulkTransferBtn) {
      bulkTransferBtn.addEventListener('click', () => {
        const navTransfers = document.getElementById('nav-transfers');
        if (navTransfers) navTransfers.click();
      });
    }

    const bulkCollectionBtn = document.getElementById('btn-bulk-collection');
    if (bulkCollectionBtn) {
      bulkCollectionBtn.addEventListener('click', () => openCollectionPicker(Array.from(selectedConversationIds)));
    }

    const bulkExportMdBtn = document.getElementById('btn-bulk-export-md');
    if (bulkExportMdBtn) {
      bulkExportMdBtn.addEventListener('click', bulkExportMarkdown);
    }

    const bulkExportJsonBtn = document.getElementById('btn-bulk-export-json');
    if (bulkExportJsonBtn) {
      bulkExportJsonBtn.addEventListener('click', bulkExportJson);
    }

    const bulkExportMenuBtn = document.getElementById('btn-bulk-export-menu');
    if (bulkExportMenuBtn) {
      bulkExportMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openExportCenterModal(Array.from(selectedConversationIds));
      });
    }

    const bulkMoreBtn = document.getElementById('btn-bulk-more');
    if (bulkMoreBtn) {
      bulkMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = bulkMoreBtn.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 4, [
          { label: 'Actualizar capturas', onClick: startBulkCapture },
          { isDivider: true },
          { label: 'Eliminar de Lossy', isDanger: true, onClick: promptDeleteSelectedConversations }
        ]);
      });
    }

    const bulkCaptureBtn = document.getElementById('btn-bulk-capture');
    if (bulkCaptureBtn) {
      bulkCaptureBtn.addEventListener('click', startBulkCapture);
    }

    const bulkDeleteBtn = document.getElementById('btn-bulk-delete');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', promptDeleteSelectedConversations);
    }

    const newCollBtn = document.getElementById('btn-new-collection');
    if (newCollBtn) {
      newCollBtn.addEventListener('click', () => promptCreateCollectionWithItems([]));
    }

    const sidebarNewCollBtn = document.getElementById('btn-sidebar-new-collection');
    if (sidebarNewCollBtn) {
      sidebarNewCollBtn.addEventListener('click', () => promptCreateCollectionWithItems([]));
    }

    const btnBackToColl = document.getElementById('btn-back-to-collections');
    if (btnBackToColl) {
      btnBackToColl.addEventListener('click', () => navigateToView('collections').catch(error => showToast(error.message)));
    }

    document.getElementById('library-page-prev').addEventListener('click',()=>{libraryPage--;renderLibraryPage();});document.getElementById('library-page-next').addEventListener('click',()=>{libraryPage++;renderLibraryPage();});
    document.getElementById('transfer-mode-archive').addEventListener('click',()=>setTransferMode('archive'));document.getElementById('transfer-mode-selection').addEventListener('click',()=>setTransferMode('selection'));
    setupProjectEditor();
    window.lossyMigrationPanel=new Lossy.MigrationPanel({db:getLinerDb,flush:flushProjectEditor,refresh:async()=>{await loadLibraryData();await updateAllCounts();},openProject:async id=>{await navigateToView('collections');await openCollectionDetail(id);},toast:showToast});
    setupProjectRestore();
    document.getElementById('btn-coll-document')?.addEventListener('click',async()=>{try{const project=await getLinerDb().getCollection(currentOpenCollectionId);if(project)await openDocumentStudio(currentProjectVisibleIds,project.collectionId);}catch(error){showToast(error.message);}});
    document.getElementById('btn-bulk-document')?.addEventListener('click',()=>openDocumentStudio([...selectedConversationIds]).catch(error=>showToast(error.message)));
    const newProjectButton = document.getElementById('btn-home-new-project');
    if (newProjectButton) newProjectButton.addEventListener('click', () => promptCreateCollectionWithItems(Array.from(selectedConversationIds)));

    const btnCollCreateTransfer = document.getElementById('btn-coll-create-transfer');
    if (btnCollCreateTransfer) {
      btnCollCreateTransfer.addEventListener('click', async () => {
        if (!currentOpenCollectionId) return;
        try { await flushProjectEditor(); startTransferFromCollection(currentOpenCollectionId); } catch (error) { showToast(error.message); }
      });
    }

    const btnCollExport = document.getElementById('btn-coll-export');
    if (btnCollExport) {
      btnCollExport.addEventListener('click', () => {
        if (!currentOpenCollectionId) return;
        exportCollectionZip(currentOpenCollectionId);
      });
    }

    const btnCollRename = document.getElementById('btn-coll-rename');
    if (btnCollRename) {
      btnCollRename.addEventListener('click', () => {
        if (!currentOpenCollectionId) return;
        promptRenameCollection(currentOpenCollectionId);
      });
    }

    const btnCollAddConvs = document.getElementById('btn-coll-add-convs');
    if (btnCollAddConvs) {
      btnCollAddConvs.addEventListener('click', async () => {
        if (!currentOpenCollectionId) return;
        const db = getLinerDb();
        if (!db) return;
        const col = await db.getCollection(currentOpenCollectionId);
        if (!col) return;
        const allMeta = await db.listMetadata();
        const existingSet = new Set(col.conversationIds || []);
        const available = allMeta.filter(m => !existingSet.has(m.canonicalId));

        if (available.length === 0) {
          showToast('Todas las conversaciones de tu biblioteca ya están en este proyecto.');
          return;
        }

        const pickerHtml = `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <p style="font-size: 12px; color: var(--text-secondary);">Selecciona las conversaciones que deseas añadir a "${escapeHtml(col.name)}":</p>
            <div id="picker-available-convs" style="max-height: 240px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 4px;">
              ${available.map(m => `
                <div class="collection-picker-row">
                  <label>
                    <input type="checkbox" class="cb-add-conv" data-id="${escapeHtml(m.canonicalId)}" checked>
                    <span>${escapeHtml(m.title)}</span>
                  </label>
                  <span style="font-size: 11px; color: var(--text-tertiary);">${m.messageCount} msgs</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;

        const confirmed = await showModal({
          title: `Añadir a "${col.name}"`,
          bodyHtml: pickerHtml,
          confirmText: 'Añadir Seleccionadas',
          cancelText: 'Cancelar'
        });

        if (!confirmed) return;

        const toAdd = Array.from(document.querySelectorAll('.cb-add-conv:checked')).map(cb => cb.dataset.id);
        if (toAdd.length > 0) {
          await db.addConversationsToCollection(currentOpenCollectionId, toAdd);
          await openCollectionDetail(currentOpenCollectionId);
          await updateAllCounts();
          showToast(`Añadidas ${formatCount(toAdd.length, 'conversación', 'conversaciones')} a "${col.name}".`);
        }
      });
    }

    const btnCollDelete = document.getElementById('btn-coll-delete');
    if (btnCollDelete) {
      btnCollDelete.addEventListener('click', () => {
        if (!currentOpenCollectionId) return;
        promptDeleteCollection(currentOpenCollectionId);
      });
    }

    // Controles de Selección de Contexto en Transfer Builder
    const collSelect = document.getElementById('transfer-collection-select');
    if (collSelect) {
      collSelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (!val) { clearTransferProject(); await updateTransferBuilder(); return; }
        const db = getLinerDb();
        if (!db) return;
        const col = await db.getCollection(val);
        if (col && Array.isArray(col.conversationIds)) {
          setTransferProject(col);
          selectedConversationIds.clear();
          col.conversationIds.forEach(id => selectedConversationIds.add(id));
          updateBulkActionBar();
          await updateTransferBuilder();
        }
      });
    }

    const btnTransferSelectAll = document.getElementById('btn-transfer-select-all');
    if (btnTransferSelectAll) {
      btnTransferSelectAll.addEventListener('click', async () => {
        currentLoadedConversations.forEach(c => selectedConversationIds.add(c.canonicalId));
        updateBulkActionBar();
        await updateTransferBuilder();
      });
    }

    const btnTransferClear = document.getElementById('btn-transfer-clear');
    if (btnTransferClear) {
      btnTransferClear.addEventListener('click', async () => {
        selectedConversationIds.clear();
        clearTransferProject();
        if (collSelect) collSelect.value = '';
        updateBulkActionBar();
        await updateTransferBuilder();
      });
    }

    // Controles del Job Tray
    const btnJobPause = document.getElementById('btn-job-pause');
    if (btnJobPause) {
      btnJobPause.addEventListener('click', () => {
        const engine = getJobEngine();
        if (engine) engine.pause();
      });
    }

    const btnJobResume = document.getElementById('btn-job-resume');
    if (btnJobResume) {
      btnJobResume.addEventListener('click', () => {
        const engine = getJobEngine();
        if (engine && currentActiveWorkerFn) engine.resume(currentActiveWorkerFn);
      });
    }

    const btnJobCancel = document.getElementById('btn-job-cancel');
    if (btnJobCancel) {
      btnJobCancel.addEventListener('click', () => {
        const engine = getJobEngine();
        if (engine) {
          engine.cancel();
          loadLibraryData();
        }
      });
    }

    const btnJobDismiss = document.getElementById('btn-job-dismiss');
    if (btnJobDismiss) {
      btnJobDismiss.addEventListener('click', () => {
        const tray = document.getElementById('global-job-tray');
        if (tray) tray.classList.add('hidden');
      });
    }

    const executeTransferBtn = document.getElementById('btn-execute-transfer');
    if (executeTransferBtn) {
      executeTransferBtn.addEventListener('click', executeTransfer);
    }

    const exportDiagBtn = document.getElementById('btn-export-diagnostics');
    if (exportDiagBtn) {
      exportDiagBtn.addEventListener('click', exportDiagnosticsFile);
    }

    const clearDbBtn = document.getElementById('btn-clear-db');
    if (clearDbBtn) {
      clearDbBtn.addEventListener('click', async () => {
        const confirmed = await showModal({
          title: 'Borrar datos locales',
          bodyHtml: `
            <p style="margin-bottom: 12px; font-size: 13.5px;">
              ¿Estás seguro de que deseas eliminar todas las conversaciones, proyectos e índices locales?
            </p>
            <div style="background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; font-size: 12px; color: var(--accent-red); line-height: 1.5;">
              Esta acción borrará la memoria local de este navegador. Tu historial original de ChatGPT no se verá afectado en absoluto.
            </div>
          `,
          confirmText: 'Eliminar todo',
          cancelText: 'Cancelar',
          isDestructive: true
        });

        if (confirmed) {
          const db = getLinerDb();
          if (projectSaveTimer) {
            clearTimeout(projectSaveTimer);
            projectSaveTimer = null;
          }
          lastDeletedContext = null;
          if (activeJobEngine && typeof activeJobEngine.cancel === 'function') {
            try { activeJobEngine.cancel(); } catch (_) {}
          }
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            try {
              const activeTabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*'] });
              for (const t of (activeTabs || [])) {
                try { chrome.tabs.sendMessage(t.id, { action: 'CANCEL_ACQUISITION' }).catch(() => {}); } catch (_) {}
              }
            } catch (_) {}
          }
          if (db) {
            await db.clearAll();
            selectedConversationIds.clear();
            updateBulkActionBar();
            await loadLibraryData();
            showToast('Base de datos local eliminada con éxito.');
          }
        }
      });
    }

    const clearSelectBtn = document.getElementById('btn-bulk-clear');
    if (clearSelectBtn) {
      clearSelectBtn.addEventListener('click', () => {
        selectedConversationIds.clear();
        document.querySelectorAll('.row-select, #check-all').forEach(cb => { cb.checked = false; });
        updateBulkActionBar();
      });
    }

    // Tema: sigue al sistema salvo que el usuario elija uno; la elección se recuerda en este navegador.
    const themeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const readTheme = () => { try { return localStorage.getItem('lossy_workspace_theme') || 'system'; } catch (_) { return 'system'; } };
    function applyTheme(choice) {
      const light = choice === 'theme-light' || (choice === 'system' && Boolean(themeQuery && themeQuery.matches));
      document.body.classList.toggle('theme-light', light);
      document.body.classList.toggle('theme-dark', !light);
      document.querySelectorAll('[data-theme]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.theme === choice)));
    }
    applyTheme(readTheme());
    if (themeQuery && themeQuery.addEventListener) {
      themeQuery.addEventListener('change', () => { if (readTheme() === 'system') applyTheme('system'); });
    }
    document.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        try { localStorage.setItem('lossy_workspace_theme', btn.dataset.theme); } catch (_) {}
        applyTheme(btn.dataset.theme);
      });
    });
  });

})();
