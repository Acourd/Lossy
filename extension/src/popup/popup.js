/**
 * AI Conversation Portability (AICP) — Controlador del Popup
 * Versión 1.2.1 — Interfaz Nativa Chrome Refresh 2023 / Apple Minimalism & Integridad
 * 100% Local-first, sin telemetría, sin llamadas de red externas.
 */

// A toolbar popup is auto-sized by Chromium. Give that host its own geometry;
// viewport limits used by the standalone preview otherwise constrain the host itself.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.extension?.getViews) {
  if (chrome.extension.getViews({ type: 'popup' }).includes(window)) {
    const root = document.documentElement;
    // Bootstrap with a fixed preferred size, then respect any height the host
    // clamps for a smaller browser window. Never adopt its tiny initial size.
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 400 && window.innerHeight >= 300) {
        root.style.setProperty('--action-popup-height', Math.min(600, window.innerHeight) + 'px');
      }
    });
    root.classList.add('action-popup');
  }
}

/**
 * Limpia y normaliza texto.
 */
function cleanText(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

/**
 * Genera un nombre de archivo seguro y normalizado.
 */
function getSafeFilename(rawTitle, extension) {
  const base = (rawTitle || 'conversacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50)
    .toLowerCase();
  const safeBase = base || 'conversacion';
  return `${safeBase}_aicp.${extension}`;
}

/**
 * Serializa la conversación canónica a Markdown con Frontmatter YAML estructurado y estado de integridad.
 */
function serializeToMarkdownBrowser(conv) {
  const meta = conv.metadata || {};
  const messages = conv.messages || [];

  const hasModel = meta.model && meta.model !== 'unspecified';
  const platformHeader = hasModel ? `${meta.platform || 'Desconocida'} (${meta.model})` : (meta.platform || 'Desconocida');

  const frontmatterLines = [
    '---',
    `title: ${JSON.stringify(meta.title || 'Conversación')}`,
    `platform: ${JSON.stringify(meta.platform || 'unknown')}`,
    `model: ${hasModel ? JSON.stringify(meta.model) : 'null'}`,
    `exported_at: ${JSON.stringify(meta.exportedAt || new Date().toISOString())}`,
    `source: ${JSON.stringify(meta.url || '')}`,
    `total_messages: ${meta.totalMessages || messages.length}`,
    `integrity: ${JSON.stringify(meta.integrity || 'harvested')}`
  ];

  if (meta.integrity === 'partial' && meta.integrityNotice) {
    frontmatterLines.push(`capture_notice: ${JSON.stringify(meta.integrityNotice)}`);
  }

  frontmatterLines.push('schema: "AICP v1.0.0"', '---', '');

  const integrityText = meta.integrity === 'partial'
    ? '> **Integridad**: Captura parcial (turnos visibles en DOM)'
    : '> **Integridad**: Recorrido de scroll (harvested)';

  const header = [
    `# ${meta.title || 'Conversación'}`,
    '',
    '> **Exportador**: AI Conversation Portability Layer (100% Local-First)',
    `> **Plataforma Original**: ${platformHeader}`,
    integrityText,
    `> **Fecha**: ${new Date(meta.exportedAt || Date.now()).toLocaleString()}`,
    meta.url ? `> **Enlace Original**: [Abrir conversación](${meta.url})` : '',
    '',
    '---',
    ''
  ].filter(line => line !== null && line !== '').join('\n');

  const bodyParts = messages.map(msg => {
    const isUser = msg.role === 'user';
    const authorName = msg.author || (isUser ? 'Usuario' : 'ChatGPT');
    const timeStr = msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString()}` : '';

    let text = (msg.content?.text || '').trim();
    const codeBlocks = msg.content?.codeBlocks || [];
    if (codeBlocks.length > 0 && !text.includes('```')) {
      const codeMd = codeBlocks.map(cb => `\n\`\`\`${cb.language || ''}\n${cb.code}\n\`\`\``).join('\n');
      text += `\n${codeMd}`;
    }

    return `### ${authorName}${timeStr}\n\n${text}\n\n---`;
  });

  return `${frontmatterLines.join('\n')}${header}${bodyParts.join('\n\n')}\n`;
}

/**
 * Construye el paquete de migración semántica para inyectar en Claude con bloques de código preservados.
 */
function createClaudePromptBrowser(conv) {
  const title = conv.metadata?.title || 'Conversación Migrada';
  const body = (conv.messages || []).map(m => {
    const author = m.author || (m.role === 'user' ? 'Usuario' : 'ChatGPT');
    const role = m.role || 'assistant';
    let text = (m.content?.text || '').trim();
    const codeBlocks = m.content?.codeBlocks || [];
    if (codeBlocks.length > 0 && !text.includes('```')) {
      const codeMd = codeBlocks.map(cb => `\n\`\`\`${cb.language || ''}\n${cb.code}\n\`\`\``).join('\n');
      text += `\n${codeMd}`;
    }
    return `**${author} (${role}):**\n${text}`;
  }).join('\n\n');

  return [
    '# PAQUETE DE MIGRACIÓN DE CONTEXTO SEMÁNTICO (AICP)',
    '',
    `Hola Claude. Te comparto el historial completo de mi sesión previa en ChatGPT ("${title}").`,
    'Quiero continuar trabajando contigo exactamente desde este punto técnico:',
    '',
    '---',
    '',
    body,
    '',
    '---',
    'Por favor confirma que has asimilado el contexto para proceder con el siguiente paso.'
  ].join('\n');
}

/**
 * Formatea una fecha ISO a tiempo relativo en español.
 */
function formatRelativeTime(isoString) {
  if (!isoString) return 'hace unos instantes';
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
    return 'hace unos instantes';
  }
}

/**
 * Genera texto con gramática y concordancia correcta en español.
 */
function formatLibrarySubtitle(conversationsCount, transfersCount) {
  const cStr = conversationsCount === 1 ? '1 conversación guardada' : `${conversationsCount} conversaciones guardadas`;
  const tStr = transfersCount === 1 ? '1 transferencia' : `${transfersCount} transferencias`;
  return `${cStr} · ${tStr}`;
}

/**
 * Controlador de Inicialización del Popup en Navegador
 */
function initPopup() {
  // Elementos de Estado
  const statusIndicator = document.getElementById('status-indicator');
  const statusTitle = document.getElementById('status-title');
  const statusSub = document.getElementById('status-sub');
  const statusActionWrapper = document.getElementById('status-action-wrapper');
  const btnStatusAction = document.getElementById('btn-status-action');
  const statusActionLabel = document.getElementById('status-action-label');

  // Tarjeta de Conversación
  const convCard = document.getElementById('conversation-info');
  const convTitle = document.getElementById('conv-title');
  const msgCount = document.getElementById('msg-count');
  const platformTag = document.getElementById('platform-tag');
  const transitStatusSub = document.getElementById('transit-status-sub');
  const transitRailNode = document.getElementById('transit-rail-node');

  // Botones de Acción
  const btnOpenWorkspace = document.getElementById('btn-open-workspace');
  const btnExportMd = document.getElementById('btn-export-md');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnPopupExport = document.getElementById('btn-popup-export');
  const popupFormatPanel = document.getElementById('popup-format-panel');
  const btnCloseFormatPanel = document.getElementById('btn-close-format-panel');
  const btnPopupOpenCenter = document.getElementById('btn-popup-open-center');
  const btnClaudePacket = document.getElementById('btn-claude-packet');
  const btnQuickMd = document.getElementById('btn-quick-md');
  const btnQuickPdf = document.getElementById('btn-quick-pdf');
  const btnQuickDocx = document.getElementById('btn-quick-docx');

  // Toast de Feedback
  const feedbackMsg = document.getElementById('feedback-message');
  const feedbackText = document.getElementById('feedback-text');
  const feedbackIconSuccess = document.getElementById('feedback-icon-success');
  const feedbackIconError = document.getElementById('feedback-icon-error');

  let extractedData = null;
  let capturePersisted = false;
  let feedbackTimer = null;
  let isExporting = false;

  /**
   * Muestra notificación de retroalimentación nativa sin emojis.
   */
  function showFeedback(text, isError = false) {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }

    feedbackText.textContent = text;

    if (isError) {
      feedbackMsg.classList.add('error');
      feedbackIconSuccess.classList.add('hidden');
      feedbackIconError.classList.remove('hidden');
    } else {
      feedbackMsg.classList.remove('error');
      feedbackIconSuccess.classList.remove('hidden');
      feedbackIconError.classList.add('hidden');
    }

    feedbackMsg.classList.remove('hidden');

    feedbackTimer = setTimeout(() => {
      feedbackMsg.classList.add('hidden');
      feedbackTimer = null;
    }, 3200);
  }

  /**
   * Descarga un archivo en memoria local mediante Blob determinista.
   * Evita revocar el blob de forma inmediata para permitir al gestor de descargas de Chromium leerlo.
   */
  function downloadFile(content, filename, mimeType) {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Retardar revocación para que Chromium no aborte la descarga asíncrona
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showFeedback(`Descargado: ${filename}`, false);
    } catch (err) {
      showFeedback(`Error en descarga: ${err.message}`, true);
    }
  }

  /**
   * Configura el estado visual del indicador.
   */
  function setStatus(state, title, subtitle) {
    statusIndicator.className = `status-dot ${state}`;
    statusTitle.textContent = title;
    statusSub.textContent = subtitle;
  }

  /**
   * Muestra botón de acción secundaria en la tarjeta de estado.
   */
  function showStatusAction(label, onClick) {
    statusActionLabel.textContent = label;
    btnStatusAction.onclick = onClick;
    statusActionWrapper.classList.remove('hidden');
  }

  /**
   * Oculta el botón de acción secundaria.
   */
  function hideStatusAction() {
    statusActionWrapper.classList.add('hidden');
  }

  /**
   * Deshabilita los botones de acción.
   */
  function disableActions() {
    if (btnExportMd) btnExportMd.disabled = true;
    if (btnExportJson) btnExportJson.disabled = true;
    if (btnPopupExport) {
      btnPopupExport.disabled = true;
      btnPopupExport.title = 'Captura requerida para exportar';
    }
    if (btnClaudePacket) btnClaudePacket.disabled = true;
    document.querySelectorAll('.btn-quick-export').forEach(b => {
      b.disabled = true;
      b.title = 'Captura requerida para exportar';
    });
    document.querySelectorAll('.btn-popup-format-choice').forEach(b => {
      b.disabled = true;
      b.title = 'Captura requerida para exportar';
    });
  }

  /**
   * Habilita los botones de acción.
   */
  function enableActions() {
    updateAssetReadiness();
    if (btnExportMd) btnExportMd.disabled = false;
    if (btnExportJson) btnExportJson.disabled = false;
    if (btnPopupExport) {
      btnPopupExport.disabled = false;
      btnPopupExport.title = 'Exportar contexto';
    }
    if (btnClaudePacket) btnClaudePacket.disabled = false;
    document.querySelectorAll('.btn-quick-export').forEach(b => {
      b.disabled = false;
      const label = b.querySelector('.quick-format-label, span');
      b.title = `Exportación rápida ${(label ? label.textContent : b.textContent).trim()}`;
    });
    document.querySelectorAll('.btn-popup-format-choice').forEach(b => {
      b.disabled = false;
      b.title = '';
    });
  }

  /**
   * Ejecuta una acción de exportación con retroalimentación visual táctil.
   */
  async function triggerExport(btn, actionFn) {
    if (!extractedData || isExporting || btn.classList.contains('is-busy')) return;
    isExporting = true;
    btn.setAttribute('aria-busy','true');
    btn.classList.add('is-busy');
    try {
      await actionFn();
    } catch (err) {
      showFeedback(`Error: ${err.message}`, true);
    } finally {
      isExporting = false;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('is-busy');
    }
  }

  // Tarjeta de Conversación y Captura
  const btnCaptureUpdate = document.getElementById('btn-capture-update');
  const btnCaptureLabel = document.getElementById('btn-capture-label');
  const btnCancelCapture = document.getElementById('btn-cancel-capture');
  const storedTimeMeta = document.getElementById('stored-time-meta');
  const storedTimeText = document.getElementById('stored-time-text');
  const popupWorkspaceSubtitle = document.getElementById('popup-workspace-subtitle');

  let currentTab = null;
  let currentConvId = null;
  let isAcquiring = false;

  // Actualización de contadores de biblioteca local
  async function updateLibraryStats() {
    try {
      const db = typeof LinerDB !== 'undefined' ? new LinerDB() : null;
      if (db) {
        const [metaList, transfers] = await Promise.all([db.listMetadata(), db.listTransfers()]);
        const libCount = metaList.length;
        const trCount = transfers.length;

        const libElem = document.getElementById('popup-library-count');
        const trElem = document.getElementById('popup-transfers-count');
        if (libElem) libElem.textContent = libCount;
        if (trElem) trElem.textContent = trCount;

        if (popupWorkspaceSubtitle) {
          popupWorkspaceSubtitle.innerHTML = `<span id="popup-library-count">${libCount}</span> ${libCount === 1 ? 'conversación guardada' : 'conversaciones guardadas'} · <span id="popup-transfers-count">${trCount}</span> ${trCount === 1 ? 'transferencia' : 'transferencias'}`;
        }
      }
    } catch (_) {}
  }

  /**
   * PASIVE DETECTION: Operación ligera al abrir el popup.
   * Identifica pestaña, extrae ID/metadata de URL y DOM sin recorrer el chat ni forzar scroll.
   * Consulta LinerDB y presenta el estado almacenado real (Single Source of Truth).
   */
  async function passiveDetectTab() {
    try {
      extractedData = null;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url) {
        setStatus('inactive', 'Sin pestaña activa', 'Selecciona una pestaña del navegador');
        hideStatusAction();
        convCard.classList.add('hidden');
        disableActions();
        await updateLibraryStats();
        return;
      }

      currentTab = tab;
      const isChatGPT = tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com');

      if (!isChatGPT) {
        setStatus('inactive', 'Pestaña no compatible', 'Abre una conversación en ChatGPT');
        showStatusAction('Abrir ChatGPT', () => {
          chrome.tabs.create({ url: 'https://chatgpt.com' });
          window.close();
        });
        convCard.classList.add('hidden');
        disableActions();
        await updateLibraryStats();
        return;
      }

      // ChatGPT detectado pasivamente
      hideStatusAction();
      convCard.classList.remove('hidden');

      const match = tab.url.match(/\/c\/([a-zA-Z0-9_-]+)/);
      currentConvId = match ? match[1] : null;

      // Consultar estado de página de forma ligera
      let pageStatus = null;
      try {
        pageStatus = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_STATUS' }, (res) => {
            const lastErr = chrome.runtime && chrome.runtime.lastError;
            if (lastErr || !res || !res.success) {
              resolve(null);
            } else {
              resolve(res.status);
            }
          });
        });
      } catch (_) {}

      if (pageStatus && pageStatus.conversationId) {
        currentConvId = pageStatus.conversationId;
      }

      // Consultar base de datos local (LinerDB) para determinar si existe captura previa
      const db = typeof LinerDB !== 'undefined' ? new LinerDB() : null;
      let stored = null;
      if (db && currentConvId) {
        stored = await db.getConversation(`conv_chatgpt_${currentConvId}`);
      }

      // Búsqueda estricta por identidad canónica exacta (cero matches ambiguos por URL genérica)
      if (db && !stored && currentConvId) {
        const metaList = await db.listMetadata();
        const matchMeta = metaList.find(m => m.sourceConversationId === currentConvId || (m.canonicalId && m.canonicalId === `conv_chatgpt_${currentConvId}`));
        if (matchMeta) {
          stored = await db.getConversation(matchMeta.canonicalId);
        }
      }

      // INVARIANTE: Si el registro cargado tiene una identidad distinta a la pestaña activa, descartar
      if (stored && (!currentConvId || !stored.source?.conversationId || stored.source.conversationId !== currentConvId)) {
        stored = null;
      }

      const pageTitle = (pageStatus && pageStatus.title) || (tab.title ? tab.title.replace(' - ChatGPT', '').trim() : 'Conversación ChatGPT');
      const observedModel = (pageStatus && pageStatus.model) || (stored && stored.model) || null;
      platformTag.textContent = observedModel ? `CHATGPT · ${observedModel}` : 'CHATGPT';
      const visibleTurns = (pageStatus && typeof pageStatus.visibleTurnsCount === 'number') ? pageStatus.visibleTurnsCount : null;

      if (stored) {
        // Estado: Conversación previamente almacenada en LinerDB (Single Source of Truth)
        extractedData = stored;
        capturePersisted = true;
        const messageCount = stored.messages ? stored.messages.length : (stored.integrity?.messageCount || 0);
        const integrity = stored.integrity?.status || 'captured';

        convTitle.textContent = stored.title || pageTitle;
        msgCount.textContent = `${messageCount} ${messageCount === 1 ? 'mensaje' : 'mensajes'}`;

        const updatedTime = stored.updatedAt || stored.createdAt || new Date().toISOString();
        const liveInfo = (visibleTurns !== null && visibleTurns !== messageCount)
          ? ` · ~${visibleTurns} turnos en pantalla`
          : '';
        if (storedTimeText) storedTimeText.textContent = `Actualizado: ${formatRelativeTime(updatedTime)}${liveInfo}`;
        if (storedTimeMeta) storedTimeMeta.classList.remove('hidden');

        if (visibleTurns !== null && visibleTurns > messageCount) {
          setStatus('warning', 'ChatGPT', `Actualización disponible (~${visibleTurns} turnos en pantalla)`);
          if (transitStatusSub) transitStatusSub.textContent = 'Actualizable';
          if (transitRailNode) transitRailNode.className = 'rail-node partial';
          if (btnCaptureLabel) btnCaptureLabel.textContent = 'Actualizar captura';
        } else if (integrity === 'partial') {
          setStatus('warning', 'ChatGPT', `Captura parcial guardada (${messageCount} msgs guardados${visibleTurns !== null ? ` · ~${visibleTurns} visibles` : ''})`);
          if (transitStatusSub) transitStatusSub.textContent = 'Parcial';
          if (transitRailNode) transitRailNode.className = 'rail-node partial';
          if (btnCaptureLabel) btnCaptureLabel.textContent = 'Continuar / Actualizar captura';
        } else {
          setStatus('ready', 'ChatGPT', `Conversación guardada (${messageCount} mensajes)`);
          if (transitStatusSub) transitStatusSub.textContent = 'Capturado';
          if (transitRailNode) transitRailNode.className = 'rail-node';
          if (btnCaptureLabel) btnCaptureLabel.textContent = 'Actualizar captura';
        }

        enableActions();
      } else {
        // Estado: Conversación detectada pero aún no capturada
        extractedData = null;
        convTitle.textContent = pageTitle;
        msgCount.textContent = (visibleTurns !== null) ? `Aún no capturada (~${visibleTurns} turnos)` : 'Aún no capturada (Captura requerida para exportar)';
        if (storedTimeMeta) storedTimeMeta.classList.add('hidden');

        setStatus('warning', 'ChatGPT', 'Conversación detectada (Captura requerida para exportar)');
        if (transitStatusSub) transitStatusSub.textContent = 'No guardada';
        if (transitRailNode) transitRailNode.className = 'rail-node';
        if (btnCaptureLabel) btnCaptureLabel.textContent = 'Capturar contexto';

        disableActions();
      }

      await updateLibraryStats();

    } catch (err) {
      setStatus('error', 'Error en detección pasiva', err.message);
      hideStatusAction();
      convCard.classList.add('hidden');
      disableActions();
      await updateLibraryStats();
    }
  }

  /**
   * ACTIVE ACQUISITION: Operación deliberada ejecutada solo ante clic explícito.
   * Realiza recorrido completo, extracción de turnos, guardado en LinerDB y habilitación de exportación.
   * INVARIANTE: Salvo coincidencia exacta de ID, la captura se rechaza (cero contaminación cruzada).
   */
  async function triggerActiveAcquisition() {
    if (!currentTab || isAcquiring) return;

    const targetConvId = currentConvId;
    isAcquiring = true;
    if (btnCaptureUpdate) btnCaptureUpdate.disabled = true;
    if (btnCancelCapture) btnCancelCapture.classList.remove('hidden');

    setStatus('detecting', 'ChatGPT', 'Capturando contexto...');
    showFeedback('Iniciando captura de conversación...', false);

    const sendRequest = (isRetry = false) => {
      chrome.tabs.sendMessage(currentTab.id, { action: 'ACQUIRE_CONVERSATION', conversationId: targetConvId }, (response) => {
        const lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError || !response) {
          if (!isRetry && chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
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
            }).then(() => sendRequest(true)).catch(() => {
              setStatus('warning', 'Conexión requerida', 'Recarga la pestaña para activar la captura');
              showStatusAction('Recargar', () => {
                chrome.tabs.reload(currentTab.id);
                window.close();
              });
              finalizeAcquisition();
            });
            return;
          }

          setStatus('warning', 'Conexión requerida', 'Recarga la pestaña para activar la captura');
          showStatusAction('Recargar', () => {
            chrome.tabs.reload(currentTab.id);
            window.close();
          });
          finalizeAcquisition();
          return;
        }

        if(response.error==='Captura cancelada'){setStatus('warning','Captura cancelada','Se conserva la captura anterior, si existe.');showFeedback('Captura cancelada');finalizeAcquisition();return;}
        if (!response.success || !response.data) {
          setStatus('error', 'Error en captura', response.error || 'No se pudo leer el chat');
          showFeedback(`Error: ${response.error || 'Fallo en captura'}`, true);
          finalizeAcquisition();
          return;
        }

        const acquired = response.data;
        // SOURCE IDENTITY INVARIANT:
        if (targetConvId && (!acquired.source?.conversationId || acquired.source.conversationId !== targetConvId)) {
          setStatus('error', 'Mismatch de identidad', 'Los datos recibidos pertenecen a otra conversación');
          showFeedback('Error crítico: Mismatch de identidad entre pestaña y captura. Abortado.', true);
          finalizeAcquisition();
          return;
        }

        // RACE CONDITION SHIELD (Delayed Acquisition):
        // Si el usuario navegó a otra conversación mientras la petición estaba en vuelo, descartar
        if (currentConvId && targetConvId && currentConvId !== targetConvId) {
          console.warn('[Lossy] Adquisición descartada por navegación en vuelo de ' + targetConvId + ' a ' + currentConvId);
          showFeedback('Captura descartada: la conversación cambió mientras se procesaba.', true);
          finalizeAcquisition();
          return;
        }

        extractedData = acquired;
        capturePersisted = false;
        const meta = extractedData.metadata || {};
        const totalMessages = extractedData.messages ? extractedData.messages.length : (meta.totalMessages || 0);
        const integrity = extractedData.integrity?.status || meta.integrity || 'harvested';

        // Persistir / actualizar en LinerDB con identidad garantizada
        (async () => {
          let persistenceError;
          try {
            const db = typeof LinerDB !== 'undefined' ? new LinerDB() : null;
            if(!db && totalMessages>0)throw new Error('Almacenamiento no disponible');
            if (db && totalMessages > 0) {
              const canonicalConv = {
                canonicalId: `conv_chatgpt_${targetConvId || Date.now()}`,
                title: extractedData.title || meta.title || 'Conversación ChatGPT',
                source: extractedData.source || { platform: 'chatgpt', conversationId: targetConvId, url: currentTab.url, acquisitionMethod: 'dom-harvest' },
                model: extractedData.model || meta.model || null,
                createdAt: extractedData.createdAt || meta.exportedAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                messages: extractedData.messages || [],
                integrity: typeof extractedData.integrity === 'object' ? extractedData.integrity : { status: integrity },
                attachments: extractedData.attachments || [],
                references: extractedData.references || []
              };
              await db.saveConversation(canonicalConv);
              extractedData = canonicalConv;
              capturePersisted = true;
            }
          } catch (error) {persistenceError=error;}

          if (totalMessages === 0) {
            setStatus('warning', 'Conversación vacía', 'Inicia un chat con mensajes para exportarlo');
            finalizeAcquisition();
            return;
          }

          // Reflejar estado finalizado honesto
          if (integrity === 'harvested' || integrity === 'captured') {
            setStatus('ready', 'Conversación capturada', `${totalMessages} ${totalMessages === 1 ? 'mensaje capturado' : 'mensajes capturados'}`);
            if (transitStatusSub) transitStatusSub.textContent = 'Capturado';
            if (transitRailNode) transitRailNode.className = 'rail-node';
            if (btnCaptureLabel) btnCaptureLabel.textContent = 'Actualizar captura';
          } else {
            setStatus('warning', 'Captura parcial', `${totalMessages} mensajes capturados`);
            if (transitStatusSub) transitStatusSub.textContent = 'Parcial';
            if (transitRailNode) transitRailNode.className = 'rail-node partial';
            if (btnCaptureLabel) btnCaptureLabel.textContent = 'Continuar / Actualizar captura';
          }

          convTitle.textContent = extractedData.title || meta.title || 'Conversación ChatGPT';
          msgCount.textContent = `${totalMessages} ${totalMessages === 1 ? 'mensaje' : 'mensajes'}`;

          if (storedTimeText) storedTimeText.textContent = `Actualizado: hace unos instantes`;
          if (storedTimeMeta) storedTimeMeta.classList.remove('hidden');

          enableActions();
          if(persistenceError){
            setStatus('warning','Captura sin guardar','No se pudo guardar. Exporta antes de cerrar esta ventana.');
            if(transitStatusSub)transitStatusSub.textContent='Sin guardar';
            if(storedTimeText)storedTimeText.textContent='Esta captura solo está disponible en esta ventana';
            showFeedback('No se pudo guardar la captura: '+persistenceError.message,true);
          }else showFeedback(`Contexto capturado con éxito (${totalMessages} mensajes)`, false);
          finalizeAcquisition();
        })();
      });
    };

    function finalizeAcquisition() {
      isAcquiring = false;
      if (btnCaptureUpdate) btnCaptureUpdate.disabled = false;
      if (btnCancelCapture) btnCancelCapture.classList.add('hidden');
      updateLibraryStats();
    }

    sendRequest(false);
  }

  /**
   * CANCEL ACQUISITION: Interrupción deliberada a petición del usuario.
   */
  async function cancelActiveAcquisition() {
    if (!currentTab) return;
    try {
      chrome.tabs.sendMessage(currentTab.id, { action: 'CANCEL_ACQUISITION' }, () => {
        void (chrome.runtime && chrome.runtime.lastError);
      });
      showFeedback('Cancelando captura...', false);
    } catch (_) {}
  }

  // Event Listeners de Captura y Cancelación
  if (btnCaptureUpdate) {
    btnCaptureUpdate.addEventListener('click', () => {
      triggerActiveAcquisition();
    });
  }

  if (btnCancelCapture) {
    btnCancelCapture.addEventListener('click', () => {
      cancelActiveAcquisition();
    });
  }

  // Re-verificación de identidad de pestaña activa viva antes de exportar
  async function assertActiveTabIdentityMatches() {
    if (!extractedData) return false;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          const match = tab.url.match(/\/c\/([a-zA-Z0-9_-]+)/);
          const liveId = match ? match[1] : null;
          const dataConvId = extractedData.source?.conversationId || (extractedData.canonicalId ? extractedData.canonicalId.replace('conv_chatgpt_', '').replace('conv_lossy_', '') : null);
          if (liveId && dataConvId && liveId !== dataConvId) {
            showFeedback('Error de identidad: los datos corresponden a otra conversación. Recaptura requerida.', true);
            extractedData = null;
            disableActions();
            return false;
          }
          if (!liveId && dataConvId) {
            showFeedback('Error de identidad: la pestaña activa no está en la conversación. Recaptura requerida.', true);
            return false;
          }
        }
      }
    } catch (_) {}
    return true;
  }

  // Event Listeners de Exportación con enlace estricto de identidad (Identity-Bound)
  if (btnExportMd) {
    btnExportMd.addEventListener('click', async () => {
      const isLiveMatch = await assertActiveTabIdentityMatches();
      if (!isLiveMatch) return;
      triggerExport(btnExportMd, () => exportWithCenter('md'));
    });
  }

  if (btnExportJson) {
    btnExportJson.addEventListener('click', async () => {
      const isLiveMatch = await assertActiveTabIdentityMatches();
      if (!isLiveMatch) return;
      triggerExport(btnExportJson, () => exportWithCenter('json'));
    });
  }

  if (btnClaudePacket) {
    btnClaudePacket.addEventListener('click', async () => {
      const isLiveMatch = await assertActiveTabIdentityMatches();
      if (!isLiveMatch) return;
      triggerExport(btnClaudePacket, async () => {
        if (!extractedData) return;
        if (currentConvId && extractedData.source?.conversationId && extractedData.source.conversationId !== currentConvId) {
          showFeedback('Error de identidad: los datos corresponden a otra conversación. Recaptura requerida.', true);
          return;
        }
        const url=new URL(chrome.runtime.getURL('src/workspace/workspace.html'));
        url.searchParams.set('context',extractedData.canonicalId);
        url.searchParams.set('target','claude');
        await chrome.tabs.create({url:url.href});

      });
    });
  }

  function updateAssetReadiness() {
    const el=document.getElementById('asset-readiness');
    if (!el) return;
    const info=window.Lossy?.ChatGPTAssets?.summary(extractedData || {});
    if (!info?.total) {el.classList.add('hidden');return;}
    el.classList.remove('hidden');el.classList.toggle('has-pending',info.missing>0);
    el.textContent=info.ready+' de '+info.total+(capturePersisted?' imágenes guardadas':' imágenes disponibles en esta ventana')+(info.missing ? ' · Se intentarán recuperar las pendientes al exportar.' : capturePersisted?' · Disponibles sin conexión.':' · Esta captura no se ha guardado.');
    const badge=document.getElementById('export-readiness-label');
    if(badge)badge.textContent=info.missing?'REVISAR':extractedData.integrity?.status==='partial'?'PARCIAL':'LISTO';
    // Se marca con un atributo, porque el texto puede estar traducido al inglés.
    if(info.missing && transitStatusSub){transitStatusSub.textContent='Imágenes pendientes';transitStatusSub.dataset.pending='1';}
    else if(transitStatusSub?.dataset.pending==='1'){transitStatusSub.textContent='Capturado';delete transitStatusSub.dataset.pending;}
  }

  function chooseMarkdownStrategy() {
    const dialog=document.getElementById('md-export-dialog');
    if(!dialog) return Promise.reject(new Error('No se pudo abrir la elección de Markdown'));
    return new Promise(resolve=>{
      const previous=document.activeElement;let selected=null;
      const click=e=>{const button=e.target.closest('[data-md-strategy]');if(button){selected=button.dataset.mdStrategy;dialog.close();}else if(e.target.closest('#btn-cancel-md-export'))dialog.close();};
      const close=()=>{dialog.removeEventListener('click',click);previous?.focus();resolve(selected);};
      dialog.addEventListener('click',click);dialog.addEventListener('close',close,{once:true});dialog.showModal();
    });
  }

  async function recoverStoredImages() {
    const info=window.Lossy?.ChatGPTAssets?.summary(extractedData||{});
    if(!info?.missing || !currentTab?.id || !extractedData?.source?.conversationId)return;
    const sourceId=extractedData.source.conversationId;
    const entity=extractedData;
    showFeedback('Recuperando las imágenes de la conversación…');
    const response=await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve({success:false}),55000);
      chrome.tabs.sendMessage(currentTab.id,{action:'RESOLVE_CONVERSATION_ASSETS',conversationId:sourceId,conversation:entity},res=>{const error=chrome.runtime?.lastError;clearTimeout(timer);resolve(error?{success:false}:res);});
    });
    if(currentConvId!==sourceId)throw new Error('La conversación cambió durante la exportación');
    if(response?.success && response.data?.source?.conversationId===sourceId){
      extractedData={...response.data,canonicalId:entity.canonicalId,updatedAt:new Date().toISOString()};
      if(typeof LinerDB!=='undefined'){
        try{await new LinerDB().saveConversation(extractedData);capturePersisted=true;}catch(error){capturePersisted=false;showFeedback('Recursos recuperados, pero no se pudo guardar: '+error.message,true);}
      }
    }
    updateAssetReadiness();
  }

  async function exportWithCenter(format, customProfile = null, customOptions = {}) {
    if (!extractedData) return;
    const isLiveMatch = await assertActiveTabIdentityMatches();
    if (!isLiveMatch) return;
    if (currentConvId && extractedData.source?.conversationId && extractedData.source.conversationId !== currentConvId) {
      showFeedback('Error de identidad: los datos corresponden a otra conversación. Recaptura requerida.', true);
      return;
    }
    if (format === 'pdf' && !customOptions.quickPdf) {
      try {
        await recoverStoredImages();
        if (!await assertActiveTabIdentityMatches()) return;
        const db = new LinerDB();
        if (!capturePersisted) {
          try { await db.saveConversation(extractedData); capturePersisted = true; }
          catch (_) {
            // Without storage the editor cannot open this capture; download the direct PDF so it is not lost.
            return exportWithCenter('pdf', customProfile, { ...customOptions, quickPdf: true });
          }
        }
        const id = extractedData.canonicalId;
        if (!id || !await db.getConversation(id)) throw new Error('Guarda la captura antes de abrir el editor');
        await chrome.tabs.create({url:chrome.runtime.getURL('src/documents/document.html')+'?id='+encodeURIComponent(id)});
      } catch (error) { showFeedback('No se pudo preparar el documento: '+error.message,true); }
      return;
    }
    const exportCenterModule = (window.Lossy && window.Lossy.ExportCenter) || null;
    const exportCenterClass = exportCenterModule?.ExportCenter || (window.Lossy && window.Lossy.ExportCenter && window.Lossy.ExportCenter.ExportCenter) || null;
    if (exportCenterClass) {
      try {
        const center = new exportCenterClass();
        const profile = customProfile || ((format === 'md' || format === 'txt') ? 'ai' : 'human');
        const incTech = document.getElementById('popup-export-tech-events')?.checked || false;
        const options = Object.assign({ includeTechnicalEvents: incTech }, customOptions);

        if (format === 'md' && !options.imageStrategy) {
          options.imageStrategy=await chooseMarkdownStrategy();
          if(!options.imageStrategy)return;
        }
        if(format !== 'json' && options.imageStrategy !== 'omit')await recoverStoredImages();
        if(!await assertActiveTabIdentityMatches())return;

        const res = await center.exportSingle(extractedData, format, profile, options);
        downloadFile(res.data, res.filename, res.mimeType);
        const unavailable=(res.assets||[]).filter(a=>!a.dataURI && !a.data?.length && !a.blob);
        if(format!=='json' && options.imageStrategy!=='omit' && unavailable.length) showFeedback('Exportación descargada con '+unavailable.length+' imágenes pendientes. Actualiza la captura para reintentarlo.',true);
        return;
      } catch (err) {
        showFeedback(`Error: ${err.message}`, true);
        return;
      }
    }
    if (format === 'md') {
      const md = serializeToMarkdownBrowser(extractedData);
      const filename = getSafeFilename(extractedData.title || extractedData.metadata?.title, 'md');
      downloadFile(md, filename, 'text/markdown;charset=utf-8');
    } else if (format === 'json') {
      const jsonStr = JSON.stringify(extractedData, null, 2);
      const filename = getSafeFilename(extractedData.title || extractedData.metadata?.title, 'json');
      downloadFile(jsonStr, filename, 'application/json;charset=utf-8');
    }
  }

  if (btnPopupExport) {
    btnPopupExport.addEventListener('click', () => {
      if (popupFormatPanel) {
        const open = popupFormatPanel.classList.toggle('hidden') === false;
        btnPopupExport.setAttribute('aria-expanded', String(open));
      }
    });
  }

  if (btnCloseFormatPanel) {
    btnCloseFormatPanel.addEventListener('click', () => {
      if (popupFormatPanel) popupFormatPanel.classList.add('hidden');
      if (btnPopupExport) {
        btnPopupExport.setAttribute('aria-expanded', 'false');
        btnPopupExport.focus();
      }
    });
  }

  if (btnPopupOpenCenter) {
    btnPopupOpenCenter.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/workspace/workspace.html') });
      }
    });
  }

  document.querySelectorAll('.btn-popup-format-choice').forEach(choiceBtn => {
    choiceBtn.addEventListener('click', () => {
      const fmt = choiceBtn.dataset.format;
      if (fmt) {
        triggerExport(choiceBtn, () => exportWithCenter(fmt, null, fmt === 'pdf' ? {quickPdf:true} : {}));
      }
    });
  });

  if (btnQuickMd) {
    btnQuickMd.addEventListener('click', () => triggerExport(btnQuickMd, () => exportWithCenter('md')));
  }
  if (btnQuickPdf) {
    btnQuickPdf.addEventListener('click', () => triggerExport(btnQuickPdf, () => exportWithCenter('pdf')));
  }
  if (btnQuickDocx) {
    btnQuickDocx.addEventListener('click', () => triggerExport(btnQuickDocx, () => exportWithCenter('docx')));
  }

  async function initQuickExports() {
    const exportCenterModule = (window.Lossy && window.Lossy.ExportCenter) || null;
    let pinned = ['md', 'pdf', 'docx'];
    if (exportCenterModule && typeof exportCenterModule.getPinnedQuickExports === 'function') {
      try {
        const customPinned = await exportCenterModule.getPinnedQuickExports();
        if (Array.isArray(customPinned) && customPinned.length > 0) {
          pinned = customPinned.slice(0, 3);
        }
      } catch (_) {}
    }

    const container = document.querySelector('.quick-exports-container');
    if (!container) return;

    const quickMeta = {
      md: { label: 'MD', cls: 'quick-chip-md', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 10V6l2 2 2-2v4M11 6v4"/></svg>' },
      pdf: { label: 'PDF', cls: 'quick-chip-pdf', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h7l3 3v9H3z"/><path d="M6 9h4M6 12h2"/></svg>' },
      docx: { label: 'DOCX', cls: 'quick-chip-docx', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h7l3 3v9H3z"/><path d="M5 8l1.5 4 1.5-4 1.5 4 1.5-4"/></svg>' },
      txt: { label: 'TXT', cls: 'quick-chip-txt', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 2h10v12H3z"/><path d="M6 6h4M8 6v6"/></svg>' },
      json: { label: 'JSON', cls: 'quick-chip-json', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M6 5c-1 0-1 1-1 3s0 3 1 3M10 5c1 0 1 1 1 3s0 3-1 3"/></svg>' },
      png: { label: 'PNG', cls: 'quick-chip-png', icon: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="6" cy="6" r="1.5"/><path d="m14 11-3-3-5 5"/></svg>' }
    };

    container.innerHTML = '';
    pinned.forEach(fmt => {
      const meta = quickMeta[fmt] || { label: fmt.toUpperCase(), cls: `quick-chip-${fmt}`, icon: '' };
      const btn = document.createElement('button');
      btn.id = `btn-quick-${fmt}`;
      btn.className = `btn-quick-export ${meta.cls}`;
      btn.type = 'button';
      btn.disabled = !extractedData;
      btn.title = extractedData ? `Exportación rápida ${meta.label}` : 'Captura requerida para exportar';
      btn.classList.add('quick-format-card');
      const notes={md:'Texto e imágenes',pdf:'Seleccionar y revisar',docx:'Documento editable',txt:'Texto sin formato',json:'Datos originales',png:'Vista en imagen'};
      btn.innerHTML = meta.icon+'<span class="quick-format-label">'+meta.label+'</span><span class="quick-format-note">'+notes[fmt]+'</span>';
      btn.setAttribute('aria-label','Exportar '+meta.label);
      btn.addEventListener('click', () => triggerExport(btn, () => exportWithCenter(fmt)));
      container.appendChild(btn);
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes['lossy_quick_exports_pinned']) {
        initQuickExports();
      }
    });
  }

  // Abrir Liner Workspace (siempre disponible)
  if (btnOpenWorkspace) {
    btnOpenWorkspace.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/workspace/workspace.html') });
      }
    });
  }

  // Monitor dinámico de ciclo de vida de pestaña activa viva en navegador
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    if (chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (currentTab && tabId === currentTab.id && changeInfo.url) {
          extractedData = null;
          disableActions();
          passiveDetectTab();
        }
      });
    }
    if (chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        extractedData = null;
        disableActions();
        passiveDetectTab();
      });
    }
  }

  // Inicio Pasivo
  initQuickExports().catch(console.warn);
  passiveDetectTab();
}

// Iniciar en entorno navegador
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initPopup);
}

// Exportar para tests deterministas en Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanText,
    getSafeFilename,
    serializeToMarkdownBrowser,
    createClaudePromptBrowser,
    formatRelativeTime,
    formatLibrarySubtitle
  };
}
