/**
 * Liner Context Portability — Adquisición Estructurada de ChatGPT (Clean-Room)
 * Parsea el árbol DAG de mensajes (mapping) tanto de endpoints de sesión web (/backend-api/conversation/{id})
 * como de archivos oficiales de exportación (conversations.json). 100% pasivo y de solo lectura.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const canonicalModel = require('../../../core/canonical_model.js');
    module.exports = factory(canonicalModel, require('../chatgpt_assets.js'));
  } else {
    root.Liner = root.Liner || {};
    const canonicalModel = root.Liner.CanonicalModel;
    const structuredModule = factory(canonicalModel, root.Lossy?.ChatGPTAssets || root.Liner.ChatGPTAssets);
    root.Liner.extractCodeBlocksFromText = structuredModule.extractCodeBlocksFromText;
    root.Liner.parseChatGPTConversationTree = structuredModule.parseChatGPTConversationTree;
    root.Liner.ChatGPTStructuredClient = structuredModule.ChatGPTStructuredClient;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (canonicalModel, assets) {
  'use strict';

  const {
    createCanonicalConversation,
    ACQUISITION_METHODS,
    INTEGRITY_STATUS
  } = canonicalModel || {
    createCanonicalConversation: (x) => x,
    ACQUISITION_METHODS: { STRUCTURED_SESSION: 'structured-session', DOM_HARVEST: 'dom-harvest' },
    INTEGRITY_STATUS: { CAPTURED: 'captured', PARTIAL: 'partial', DEGRADED: 'degraded', FAILED: 'failed' }
  };

  /**
   * Extrae bloques de código Markdown con su lenguaje especificado.
   */
  function extractCodeBlocksFromText(text) {
    if (typeof text !== 'string') return [];
    const blocks = [];
    const codeRegex = /```([a-zA-Z0-9_\-+.]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = codeRegex.exec(text)) !== null) {
      blocks.push({
        language: match[1] || 'plaintext',
        code: match[2].trim()
      });
    }
    return blocks;
  }

  /**
   * Parsea una estructura en árbol DAG de ChatGPT a Modelo Canónico Liner v1.3.
   */
  function parseChatGPTConversationTree(rawJson, options = {}) {
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error('El objeto de conversación no es válido');
    }

    const title = (rawJson.title || options.title || 'Conversación de ChatGPT').trim();
    const conversationId = rawJson.id || rawJson.conversation_id || options.conversationId || null;
    const mapping = rawJson.mapping || {};
    const currentNode = rawJson.current_node;

    // 1. Reconstruir la ruta activa cronológica (desde la raíz hasta la hoja actual)
    const activePath = [];
    let curr = currentNode;
    const visited = new Set();

    while (curr && mapping[curr] && !visited.has(curr)) {
      visited.add(curr);
      activePath.push(mapping[curr]);
      curr = mapping[curr].parent;
    }
    activePath.reverse();

    // Si no hay current_node o mapping plano, iterar sobre todos los nodos con mensaje
    const nodesToProcess = activePath.length > 0
      ? activePath
      : Object.values(mapping).sort((a, b) => {
          const tA = (a.message && a.message.create_time) ? a.message.create_time : 0;
          const tB = (b.message && b.message.create_time) ? b.message.create_time : 0;
          return tA - tB;
        });

    let observedModel = null;
    const messages = [];
    const branches = {
      rootNodeId: null,
      totalNodes: Object.keys(mapping).length,
      branchPoints: []
    };

    // Identificar bifurcaciones (nodos con múltiples hijos)
    for (const [nodeId, node] of Object.entries(mapping)) {
      if (Array.isArray(node.children) && node.children.length > 1) {
        branches.branchPoints.push({
          nodeId,
          childrenCount: node.children.length,
          childIds: node.children
        });
      }
      if (!node.parent && !branches.rootNodeId) {
        branches.rootNodeId = nodeId;
      }
    }

    let turnIndex = 0;
    for (const node of nodesToProcess) {
      const msg = node.message;
      if (!msg) continue;

      const rawRole = (msg.author && msg.author.role) ? msg.author.role.toLowerCase() : 'user';
      let role = 'user';
      if (rawRole === 'assistant') role = 'assistant';
      else if (rawRole === 'system') role = 'system';
      else if (rawRole === 'tool') role = 'tool';

      let textContent = '';
      const content = msg.content || {};

      if (Array.isArray(content.parts)) {
        textContent = content.parts
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
              if (part.text) return part.text;
              if (part.content_type === 'image_asset_pointer') return '';
              return ''; // Non-text parts stay in typed attachments, never in the transcript.
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (typeof content.text === 'string') {
        textContent = content.text;
      }

      // Omitir mensajes de sistema internos vacíos o de inicialización
      if (role === 'system' && !textContent.trim()) {
        continue;
      }

      // Principio Epistémico: Extraer modelo solo si está explícitamente en metadata
      if (role === 'assistant' && msg.metadata && msg.metadata.model_slug) {
        observedModel = msg.metadata.model_slug;
      }

      const createTime = msg.create_time ? new Date(msg.create_time * 1000).toISOString() : new Date().toISOString();

      // Citas y referencias
      const citations = [];
      if (msg.metadata && Array.isArray(msg.metadata.citations)) {
        msg.metadata.citations.forEach((cit, cIdx) => {
          citations.push({
            id: `cit_${turnIndex}_${cIdx}`,
            title: cit.metadata?.title || cit.metadata?.url || 'Fuente Citada',
            url: cit.metadata?.url || '',
            snippet: cit.metadata?.snippet || null
          });
        });
      }

      // Adjuntos (archivos subidos o imágenes generadas)
      const attachments = [];

      // 1. Punteros de imagen en content.parts
      if (Array.isArray(content.parts)) {
        content.parts.forEach((part, pIdx) => {
          if (part && typeof part === 'object' && (part.content_type === 'image_asset_pointer' || part.asset_pointer)) {
            const ptr = part.asset_pointer || part.id || `img_ptr_${turnIndex}_${pIdx}`;
            attachments.push({
              id: `att_ptr_${turnIndex}_${pIdx}`,
              assetId: `att_ptr_${turnIndex}_${pIdx}`,
              name: `chatgpt_asset_${ptr.substring(0, 16)}.png`,
              filename: `chatgpt_asset_${ptr.substring(0, 16)}.png`,
              mimeType: 'image/png',
              sizeBytes: typeof part.size_bytes === 'number' ? part.size_bytes : null,
              size: typeof part.size_bytes === 'number' ? part.size_bytes : null,
              kind: 'image',
              sourceType: 'image_asset_pointer',
              assetPointer: ptr,
              fileId: ptr.replace(/^(?:sediment|file-service):\/\//, ''),
              width: typeof part.width === 'number' ? part.width : null,
              height: typeof part.height === 'number' ? part.height : null,
              sourceRelationship: 'generated',
              downloadable: false,
              availability: 'referenced',
              sourceURL: null,
              url: null,
              checksumSha256: null
            });
          }
        });
      }

      // 2. Metadata attachments (subidos por usuario o generados)
      if (msg.metadata && Array.isArray(msg.metadata.attachments)) {
        msg.metadata.attachments.forEach((att, aIdx) => {
          const kind = att.mime_type && att.mime_type.startsWith('image/') ? 'image' : 'file';
          const downloadUrl = att.download_url || att.url || null;
          attachments.push({
            id: att.id || att.file_id || `att_${turnIndex}_${aIdx}`,
            assetId: att.id || att.file_id || `att_${turnIndex}_${aIdx}`,
            name: att.name || (kind === 'image' ? `image_${turnIndex}_${aIdx}.png` : 'archivo_adjunto'),
            filename: att.name || (kind === 'image' ? `image_${turnIndex}_${aIdx}.png` : 'archivo_adjunto'),
            mimeType: att.mime_type || (kind === 'image' ? 'image/png' : 'application/octet-stream'),
            sizeBytes: typeof att.size === 'number' ? att.size : null,
            size: typeof att.size === 'number' ? att.size : null,
            kind,
            sourceType: 'attachment',
            sourceRelationship: 'uploaded',
            sourceURL: downloadUrl,
            url: downloadUrl,
            downloadable: Boolean(downloadUrl),
            availability: downloadUrl ? 'referenced' : 'unavailable',
            checksumSha256: null
          });
        });
      }

      const codeBlocks = extractCodeBlocksFromText(textContent);
      const isToolCall = Boolean((msg.recipient && msg.recipient !== 'all') || (msg.metadata && msg.metadata.recipient && msg.metadata.recipient !== 'all') || (msg.metadata && Array.isArray(msg.metadata.tool_calls) && msg.metadata.tool_calls.length > 0));
      const isConversational = (role === 'user' || role === 'assistant') &&
        Boolean(textContent.trim().length > 0 || codeBlocks.length > 0 || attachments.length > 0) &&
        !(role === 'assistant' && isToolCall && (!textContent.trim() || textContent.trim().startsWith('bash -') || textContent.trim().startsWith('python ')));
      const nodeCategory = role === 'tool' ? 'tool' : (role === 'system' ? 'system' : (isConversational ? role : 'tool'));

      messages.push({
        id: msg.id || node.id || `msg_${turnIndex + 1}`,
        role,
        author: role === 'user' ? 'Usuario' : (role === 'assistant' ? 'ChatGPT' : (role === 'system' ? 'Sistema' : 'Herramienta')),
        isConversational,
        nodeCategory,
        timestamp: createTime,
        createdAt: createTime,
        model: role === 'assistant' ? (msg.metadata?.model_slug || observedModel) : null,
        parentId: node.parent || null,
        sourceOrdinal: turnIndex,
        content: {
          text: textContent,
          codeBlocks,
          citations,
          attachments
        },
        attachments,
        references: citations,
        metadata: {
          turnIndex,
          nodeId: node.id,
          isConversational,
          nodeCategory,
          modelSlug: msg.metadata?.model_slug || null,
          finishDetails: msg.metadata?.finish_details || null,
          weight: msg.weight || 1
        },
        provenance: {
          originalPlatform: 'chatgpt',
          nodeId: node.id,
          parentId: node.parent || null,
          isConversational
        }
      });

      turnIndex++;
    }

    // Análisis integral de la totalidad de nodos brutos del DAG mapping si está presente
    let dagUserCount = 0;
    let dagAssistantCount = 0;
    let dagToolCount = 0;
    let dagSystemCount = 0;
    let dagOtherCount = 0;

    if (rawJson.mapping && typeof rawJson.mapping === 'object') {
      for (const node of Object.values(rawJson.mapping)) {
        if (!node || !node.message) {
          dagOtherCount++;
          continue;
        }
        const r = (node.message.author?.role || '').toLowerCase();
        const hasToolCalls = Boolean(node.message.metadata?.tool_calls?.length || node.message.recipient);
        if (r === 'user') {
          dagUserCount++;
        } else if (r === 'assistant') {
          dagAssistantCount++;
          if (hasToolCalls) dagToolCount++;
        } else if (r === 'tool') {
          dagToolCount++;
        } else if (r === 'system') {
          dagSystemCount++;
        } else {
          dagOtherCount++;
        }
      }
    }

    const userNodes = messages.filter(m => m.role === 'user');
    const assistantNodes = messages.filter(m => m.role === 'assistant');
    const toolNodes = messages.filter(m => m.role === 'tool');
    const systemNodes = messages.filter(m => m.role === 'system');
    const otherNodes = messages.filter(m => !['user', 'assistant', 'tool', 'system'].includes(m.role));

    const conversationalMessages = messages.filter(m => {
      if (typeof m.isConversational === 'boolean') return m.isConversational;
      if (m.role !== 'user' && m.role !== 'assistant') return false;
      const hasText = Boolean(m.content?.text && m.content.text.trim().length > 0);
      const hasCode = Boolean(Array.isArray(m.content?.codeBlocks) && m.content.codeBlocks.length > 0);
      return hasText || hasCode;
    });

    const sourceNodeCount = (rawJson.mapping && Object.keys(rawJson.mapping).length) || nodesToProcess.length || messages.length;
    const conversationMessageCount = conversationalMessages.length;
    const visibleMessageCount = conversationMessageCount;
    const finalUserCount = dagUserCount || userNodes.length;
    const finalAssistantCount = dagAssistantCount || assistantNodes.length;
    const finalToolCount = dagToolCount || toolNodes.length;
    const finalSystemCount = dagSystemCount || systemNodes.length;
    const finalOtherCount = dagOtherCount || otherNodes.length;

    const nodeMetrics = {
      sourceNodeCount,
      conversationMessageCount,
      visibleMessageCount,
      userMessageCount: finalUserCount,
      userNodes: finalUserCount,
      assistantMessageCount: finalAssistantCount,
      assistantNodes: finalAssistantCount,
      toolEventCount: finalToolCount,
      toolNodes: finalToolCount,
      systemNodeCount: finalSystemCount,
      systemNodes: finalSystemCount,
      otherNodeCount: finalOtherCount,
      otherNodes: finalOtherCount
    };

    const convCreatedAt = rawJson.create_time ? new Date(rawJson.create_time * 1000).toISOString() : new Date().toISOString();
    const convUpdatedAt = rawJson.update_time ? new Date(rawJson.update_time * 1000).toISOString() : convCreatedAt;
    const acquisitionMethod = options.acquisitionMethod || ACQUISITION_METHODS.STRUCTURED_SESSION;

    const topLevelAttachments = messages.flatMap(m => Array.isArray(m.attachments) ? m.attachments : []);

    return createCanonicalConversation({
      canonicalId: conversationId ? `conv_chatgpt_${conversationId}` : undefined,
      title,
      platform: 'chatgpt',
      conversationId,
      url: conversationId ? `https://chatgpt.com/c/${conversationId}` : (options.url || 'https://chatgpt.com'),
      model: observedModel,
      createdAt: convCreatedAt,
      updatedAt: convUpdatedAt,
      acquisitionMethod,
      messages,
      attachments: topLevelAttachments,
      conversationMessageCount,
      visibleMessageCount,
      sourceNodeCount,
      nodeMetrics,
      branches: branches.branchPoints.length > 0 ? branches : null,
      integrity: {
        status: INTEGRITY_STATUS.CAPTURED,
        acquisitionMethod,
        messageCount: conversationMessageCount,
        conversationMessageCount,
        visibleMessageCount,
        sourceNodeCount,
        nodeMetrics,
        warnings: [],
        missingItems: [],
        browserVerified: true
      },
      capabilities: {
        structuredMapping: 'available',
        branchDetection: branches.branchPoints.length > 0 ? 'available' : 'unavailable',
        realTimestamps: 'available',
        modelSlug: observedModel ? 'available' : 'unavailable'
      }
    });
  }

  /**
   * Cliente seguro de solo lectura para endpoints de sesión web de ChatGPT.
   * Se ejecuta exclusivamente en el contexto de la sesión activa en el navegador.
   * Cero almacenamiento no volátil de tokens.
   */
  class ChatGPTStructuredClient {
    constructor(fetchFn = (typeof fetch !== 'undefined' ? fetch : null), baseOrigin = '') {
      this.fetch = fetchFn;
      this.baseOrigin = baseOrigin || (typeof window !== 'undefined' && window.location && window.location.origin.includes('chatgpt.com') ? '' : 'https://chatgpt.com');
      this.sessionToken = null;
      this.tokenExpiry = 0;
    }

    async getSessionToken() {
      if (this.sessionToken && Date.now() < this.tokenExpiry) {
        return this.sessionToken;
      }

      if (!this.fetch) {
        throw new Error('Entorno sin fetch disponible');
      }

      const sessionUrl = `${this.baseOrigin}/api/auth/session`;
      const res = await this.fetch(sessionUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`Error al obtener sesión de ChatGPT: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data || !data.accessToken) {
        throw new Error('Sesión de ChatGPT no autenticada o token ausente');
      }

      this.sessionToken = data.accessToken;
      this.tokenExpiry = Date.now() + 10 * 60 * 1000;
      return this.sessionToken;
    }

    async listConversations(offset = 0, limit = 28) {
      const token = await this.getSessionToken();
      const url = `${this.baseOrigin}/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`;

      const res = await this.fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (res.status === 429) {
        const retryAfter = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
        const err = new Error('HTTP_429_RATE_LIMITED');
        err.retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Error al listar conversaciones: HTTP ${res.status}`);
      }

      return await res.json();
    }

    async getConversation(conversationId) {
      const token = await this.getSessionToken();
      const url = `${this.baseOrigin}/backend-api/conversation/${conversationId}`;

      const res = await this.fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (res.status === 429) {
        const retryAfter = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
        const err = new Error('HTTP_429_RATE_LIMITED');
        err.retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Error al obtener conversación ${conversationId}: HTTP ${res.status}`);
      }

      const rawData = await res.json();
      const parsed = parseChatGPTConversationTree(rawData, {
        conversationId,
        acquisitionMethod: ACQUISITION_METHODS.STRUCTURED_SESSION
      });
      return assets ? assets.resolveConversationAssets(parsed, {fetch:this.fetch,baseOrigin:this.baseOrigin || globalThis.location?.origin,getToken:()=>this.getSessionToken()}) : parsed;
    }
  }

  return {
    extractCodeBlocksFromText,
    parseChatGPTConversationTree,
    ChatGPTStructuredClient
  };
});
