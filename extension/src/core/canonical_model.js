/**
 * AI Context Portability (AICP / Liner) — Modelo Canónico de Datos v1.3
 * Representación neutral unificada para transporte local de contexto de IA.
 * 100% Local-first, sin dependencias externas de npm. Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const cryptoUtil = require('./crypto_util.js');
    const schema = require('./canonical/canonical_schema.js');
    module.exports = factory(cryptoUtil, schema);
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const cryptoUtil = root.Liner.Crypto;
    const schema = root.Liner.CanonicalSchema;
    const modelExports = factory(cryptoUtil, schema);
    root.Liner.CanonicalModel = modelExports;
    root.Lossy.CanonicalModel = modelExports;
    Object.assign(root.Liner, modelExports);
    Object.assign(root.Lossy, modelExports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cryptoUtil, schema) {
  'use strict';

  const {
    LINER_CANONICAL_VERSION,
    SCHEMA_URI,
    INTEGRITY_STATUS,
    ACQUISITION_METHODS,
    MESSAGE_ROLES
  } = schema || {
    LINER_CANONICAL_VERSION: '1.3.0',
    SCHEMA_URI: 'https://aicp.dev/v1.3/canonical-context.schema.json',
    INTEGRITY_STATUS: { CAPTURED: 'captured', PARTIAL: 'partial', DEGRADED: 'degraded', FAILED: 'failed' },
    ACQUISITION_METHODS: { STRUCTURED_SESSION: 'structured-session', DOM_HARVEST: 'dom-harvest', DOM_SNIPPET: 'dom-snippet', OFFICIAL_EXPORT: 'official-export' },
    MESSAGE_ROLES: ['user', 'assistant', 'system', 'tool']
  };

  const AICP_VERSION = '1.0.0'; // Mantiene compatibilidad con clientes v1.0

  function generateId(prefix, seed) {
    if (cryptoUtil && typeof cryptoUtil.generateId === 'function') {
      return cryptoUtil.generateId(prefix, seed);
    }
    const rand = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }

  /**
   * Formalización del Modelo Canónico de Asset (CanonicalAsset).
   */
  function createCanonicalAsset(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new Error('Parámetros de asset inválidos');
    }
    const assetId = params.assetId || params.id || generateId('asset', `${params.filename || params.name || 'res'}`);
    const sourceType = params.sourceType || (params.assetPointer ? 'image_asset_pointer' : (params.dataURI ? 'data-uri' : (params.kind === 'image' ? 'dom-image' : 'attachment')));
    const mimeType = params.mimeType || (params.kind === 'image' || (typeof sourceType === 'string' && sourceType.includes('image')) ? 'image/png' : 'application/octet-stream');
    const filename = params.filename || params.name || `${assetId}.${mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : (mimeType.includes('png') ? 'png' : 'bin')}`;

    let availability = params.availability || 'referenced';
    if (params.data || params.dataURI || params.blob) {
      availability = 'embedded';
    } else if (params.localBlob || params.downloaded) {
      availability = 'downloaded';
    } else if (!params.sourceURL && !params.url && !params.assetPointer) {
      availability = 'unavailable';
    }

    return {
      id: assetId,
      assetId,
      name: filename,
      filename,
      kind: params.kind || (mimeType.startsWith('image/') ? 'image' : 'file'),
      sourceType,
      mimeType,
      width: typeof params.width === 'number' ? params.width : null,
      height: typeof params.height === 'number' ? params.height : null,
      size: typeof params.size === 'number' ? params.size : (typeof params.sizeBytes === 'number' ? params.sizeBytes : null),
      sourceURL: params.sourceURL || params.url || null,
      assetPointer: params.assetPointer || null,
      fileId: params.fileId || null,
      dataURI: params.dataURI || null,
      data: params.data || null,
      blob: params.blob || params.localBlob || null,
      sourceMessageId: params.sourceMessageId || null,
      availability,
      resolutionMethod: params.resolutionMethod || 'direct',
      integrity: params.integrity || 'verified',
      warnings: Array.isArray(params.warnings) ? params.warnings : []
    };
  }

  /**
   * Normaliza y valida una entidad de adjunto (Attachment).
   */
  function normalizeAttachment(att, index) {
    if (!att || typeof att !== 'object') return null;
    const kind = att.kind || (att.mimeType && att.mimeType.startsWith('image/') ? 'image' : 'file');
    return {
      id: att.id || generateId('att', `${att.name || 'file'}_${index}`),
      assetId: att.assetId || att.id || generateId('att', `${att.name || 'file'}_${index}`),
      name: att.name || 'unnamed_file',
      filename: att.filename || att.name || 'unnamed_file',
      mimeType: att.mimeType || att.contentType || 'application/octet-stream',
      sizeBytes: typeof att.sizeBytes === 'number' ? att.sizeBytes : (typeof att.size === 'number' ? att.size : null),
      size: typeof att.size === 'number' ? att.size : (typeof att.sizeBytes === 'number' ? att.sizeBytes : null),
      kind,
      sourceType: att.sourceType || (kind === 'image' ? 'dom-image' : 'attachment'),
      sourceRelationship: att.sourceRelationship || 'uploaded', // 'uploaded' | 'generated' | 'reference'
      sourceURL: att.sourceURL || att.url || null,
      url: att.url || att.sourceURL || null,
      assetPointer: att.assetPointer || null,
      fileId: att.fileId || null,
      dataURI: att.dataURI || null,
      data: att.data || null,
      blob: att.blob || att.localBlob || null,
      availability: att.availability || (att.dataURI || att.data || att.blob ? 'embedded' : (att.url || att.sourceURL ? 'referenced' : 'unavailable')),
      downloadable: Boolean(att.downloadable || att.url || att.sourceURL),
      checksumSha256: att.checksumSha256 || null,
      width: typeof att.width === 'number' ? att.width : null,
      height: typeof att.height === 'number' ? att.height : null,
      warnings: Array.isArray(att.warnings) ? att.warnings : []
    };
  }

  /**
   * Normaliza y valida una referencia o cita web.
   */
  function normalizeReference(ref, index) {
    if (!ref || typeof ref !== 'object') return null;
    return {
      id: ref.id || generateId('ref', `${ref.url || 'ref'}_${index}`),
      title: ref.title || ref.name || 'Fuente de Referencia',
      url: ref.url || '',
      snippet: ref.snippet || ref.text || null,
      attributedDate: ref.attributedDate || null
    };
  }

  /**
   * Clasifica un nodo de mensaje de forma determinista bajo la taxonomía de Lossy.
   * Separa el diálogo conversacional primario humano/IA de herramientas, sistemas y eventos internos.
   */
  function classifyMessageNode(nodeOrMsg) {
    if (!nodeOrMsg) return { role: 'unknown', isConversational: false, category: 'unknown', nodeCategory: 'unknown' };
    
    // Nodos estructurales puros del DAG (raíz o bifurcaciones sin objeto message)
    if (nodeOrMsg.message === null || (nodeOrMsg.children && !nodeOrMsg.message)) {
      return {
        role: 'structural',
        isConversational: false,
        category: 'structural',
        nodeCategory: 'structural'
      };
    }

    const msg = nodeOrMsg.message || nodeOrMsg;
    if (!msg || typeof msg !== 'object') {
      return { role: 'unknown', isConversational: false, category: 'unknown', nodeCategory: 'unknown' };
    }

    const authorRole = (msg.author && msg.author.role)
      ? msg.author.role.toLowerCase()
      : ((msg.role || 'user').toLowerCase());

    const recipient = msg.recipient || (msg.metadata && msg.metadata.recipient) || null;
    const toolCalls = (msg.metadata && Array.isArray(msg.metadata.tool_calls)) ? msg.metadata.tool_calls : [];
    const contentType = (msg.content && msg.content.content_type) ? msg.content.content_type : '';
    const isThought = contentType === 'thought' || Boolean(msg.metadata && msg.metadata.thought) || authorRole === 'reasoning' || authorRole === 'thought';

    if (isThought) {
      return {
        role: 'reasoning',
        isConversational: false,
        category: 'reasoning',
        nodeCategory: 'reasoning'
      };
    }

    if (authorRole === 'user') {
      const text = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
      const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : [];
      const isConversational = text.trim().length > 0 || parts.length > 0;
      return {
        role: 'user',
        isConversational,
        category: 'user',
        nodeCategory: isConversational ? 'conversational' : 'user'
      };
    }

    if (authorRole === 'tool') {
      return {
        role: 'tool',
        isConversational: false,
        category: 'tool',
        nodeCategory: 'tool'
      };
    }

    if (authorRole === 'system') {
      return {
        role: 'system',
        isConversational: false,
        category: 'system',
        nodeCategory: 'system'
      };
    }

    if (authorRole === 'developer') {
      return {
        role: 'developer',
        isConversational: false,
        category: 'developer',
        nodeCategory: 'developer'
      };
    }

    if (authorRole === 'agent' || contentType === 'tether_browsing_display' || contentType === 'tether_quote' || contentType === 'execution_output') {
      return {
        role: authorRole === 'agent' ? 'agent' : 'tool',
        isConversational: false,
        category: authorRole === 'agent' ? 'agent' : 'tool',
        nodeCategory: authorRole === 'agent' ? 'agent' : 'tool'
      };
    }

    if (authorRole === 'assistant') {
      const isToolInvocation = Boolean(recipient || toolCalls.length > 0 || contentType === 'code');
      let text = '';
      if (Array.isArray(msg.content?.parts)) {
        text = msg.content.parts
          .filter(p => typeof p === 'string' || (p && p.text))
          .map(p => typeof p === 'string' ? p : p.text)
          .join('\n')
          .trim();
      } else if (typeof msg.content?.text === 'string') {
        text = msg.content.text.trim();
      } else if (typeof msg.text === 'string') {
        text = msg.text.trim();
      }

      if (isToolInvocation && (recipient || toolCalls.length > 0 || !text || text.startsWith('bash -') || text.startsWith('python ') || text.startsWith('```bash'))) {
        return {
          role: 'assistant',
          isConversational: false,
          category: 'tool',
          nodeCategory: 'tool'
        };
      }

      const isConversational = text.length > 0;
      return {
        role: 'assistant',
        isConversational,
        category: 'assistant',
        nodeCategory: isConversational ? 'conversational' : 'assistant'
      };
    }

    return {
      role: authorRole || 'unknown',
      isConversational: false,
      category: authorRole || 'unknown',
      nodeCategory: authorRole || 'unknown'
    };
  }

  /**
   * Crea una conversación en formato canónico Liner v1.3 (compatible con AICP v1.0).
   */
  function createCanonicalConversation(params = {}) {
    const title = (params.title || 'Conversación Sin Título').trim();
    const platform = (params.platform || 'unknown').toLowerCase();
    
    // Principio Epistémico: No model inference. Si no es verificable, es null.
    const model = (params.model && params.model !== 'unspecified' && params.model !== 'unknown') ? params.model : null;
    
    const acquisitionMethod = params.acquisitionMethod || 
      (params.source && params.source.acquisitionMethod) || 
      ACQUISITION_METHODS.DOM_HARVEST;

    // Integridad granular v1.3 con retrocompatibilidad para cadenas simples
    let integrityObj;
    if (typeof params.integrity === 'object' && params.integrity !== null) {
      integrityObj = {
        status: params.integrity.status || INTEGRITY_STATUS.CAPTURED,
        acquisitionMethod: params.integrity.acquisitionMethod || acquisitionMethod,
        messageCount: typeof params.integrity.messageCount === 'number' ? params.integrity.messageCount : 0,
        warnings: Array.isArray(params.integrity.warnings) ? params.integrity.warnings : [],
        missingItems: Array.isArray(params.integrity.missingItems) ? params.integrity.missingItems : [],
        browserVerified: Boolean(params.integrity.browserVerified)
      };
    } else {
      const rawStatus = params.integrity || 'harvested';
      integrityObj = {
        status: rawStatus === 'partial' ? INTEGRITY_STATUS.PARTIAL : (rawStatus === 'degraded' ? INTEGRITY_STATUS.DEGRADED : (rawStatus === 'failed' ? INTEGRITY_STATUS.FAILED : (rawStatus === 'captured' ? INTEGRITY_STATUS.CAPTURED : 'harvested'))),
        acquisitionMethod,
        messageCount: Array.isArray(params.messages) ? params.messages.length : 0,
        warnings: params.integrityNotice ? [params.integrityNotice] : [],
        missingItems: [],
        browserVerified: true
      };
    }

    const url = params.url || (params.source && params.source.url) || '';
    const now = new Date().toISOString();
    const rawMessages = Array.isArray(params.messages) ? params.messages : [];
    const conversationId = params.conversationId || (params.source && params.source.conversationId) || null;
    const canonicalId = params.id || params.canonicalId || generateId('conv', `${platform}_${conversationId || title}_${now}`);

    const messages = rawMessages.map((msg, index) => {
      const classification = classifyMessageNode(msg);
      const role = (msg.role && MESSAGE_ROLES.includes(msg.role)) ? msg.role : classification.role;
      const author = msg.author || (role === 'user' ? 'Usuario' : (role === 'assistant' ? 'ChatGPT' : (role === 'tool' ? 'Herramienta' : (role === 'system' ? 'Sistema' : role))));
      const isConversational = typeof msg.isConversational === 'boolean'
        ? msg.isConversational
        : classification.isConversational;
      const nodeCategory = msg.nodeCategory || classification.nodeCategory || classification.category;

      const timestamp = msg.timestamp || msg.createdAt || now;
      const text = typeof msg.text === 'string' ? msg.text : (msg.content?.text || '');
      const codeBlocks = Array.isArray(msg.codeBlocks) ? msg.codeBlocks : (Array.isArray(msg.content?.codeBlocks) ? msg.content.codeBlocks : []);
      const citations = Array.isArray(msg.citations) ? msg.citations : (Array.isArray(msg.content?.citations) ? msg.content.citations : []);
      const attachments = (Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.content?.attachments) ? msg.content.attachments : []))
        .map((att, attIdx) => normalizeAttachment(att, attIdx))
        .filter(Boolean);
      const references = (Array.isArray(msg.references) ? msg.references : citations)
        .map((ref, refIdx) => normalizeReference(ref, refIdx))
        .filter(Boolean);

      return {
        id: msg.id || generateId('msg', `${canonicalId}_${index}_${timestamp}`),
        role,
        author,
        isConversational,
        nodeCategory,
        timestamp,
        createdAt: timestamp,
        model: msg.model || model,
        parentId: msg.parentId || null,
        sourceOrdinal: typeof msg.sourceOrdinal === 'number' ? msg.sourceOrdinal : index,
        content: {
          text,
          codeBlocks,
          citations: references,
          attachments
        },
        attachments,
        references,
        metadata: {
          turnIndex: index,
          originalPlatform: platform,
          isConversational,
          nodeCategory,
          ...(msg.metadata || {})
        },
        provenance: {
          originalPlatform: platform,
          turnIndex: index,
          nodeId: msg.id || null,
          isConversational,
          ...(msg.provenance || {})
        }
      };
    });

    integrityObj.messageCount = messages.length;

    const conversationalMessages = messages.filter(m => {
      if (typeof m.isConversational === 'boolean') return m.isConversational;
      if (m.role !== 'user' && m.role !== 'assistant') return false;
      const hasText = Boolean(m.content?.text && m.content.text.trim().length > 0);
      const hasCode = Boolean(Array.isArray(m.content?.codeBlocks) && m.content.codeBlocks.length > 0);
      return hasText || hasCode;
    });

    const conversationMessageCount = typeof params.conversationMessageCount === 'number'
      ? params.conversationMessageCount
      : (typeof params.visibleMessageCount === 'number' ? params.visibleMessageCount : conversationalMessages.length);

    const visibleMessageCount = conversationMessageCount;
    const sourceNodeCount = typeof params.sourceNodeCount === 'number'
      ? params.sourceNodeCount
      : messages.length;

    const rawNodeMetrics = params.nodeMetrics || {};
    const uCount = rawNodeMetrics.userNodes ?? rawNodeMetrics.userMessageCount ?? messages.filter(m => m.role === 'user' && m.isConversational !== false).length;
    const aCount = rawNodeMetrics.assistantNodes ?? rawNodeMetrics.assistantMessageCount ?? messages.filter(m => m.role === 'assistant' && m.isConversational !== false).length;
    const tCount = rawNodeMetrics.toolNodes ?? rawNodeMetrics.toolEventCount ?? messages.filter(m => m.role === 'tool' || m.nodeCategory === 'tool' || (m.role === 'assistant' && m.isConversational === false)).length;
    const sCount = rawNodeMetrics.systemNodes ?? rawNodeMetrics.systemNodeCount ?? messages.filter(m => m.role === 'system' || m.role === 'developer' || m.nodeCategory === 'system' || m.nodeCategory === 'developer').length;
    const strCount = rawNodeMetrics.structuralNodes ?? messages.filter(m => m.role === 'structural' || m.nodeCategory === 'structural').length;
    const oCount = rawNodeMetrics.otherNodes ?? rawNodeMetrics.otherNodeCount ?? messages.filter(m => !['user', 'assistant', 'tool', 'system', 'developer', 'structural'].includes(m.role) && m.isConversational === false).length;

    const nodeMetrics = {
      sourceNodeCount,
      conversationMessageCount,
      visibleMessageCount,
      userMessageCount: uCount,
      userNodes: uCount,
      assistantMessageCount: aCount,
      assistantNodes: aCount,
      toolEventCount: tCount,
      toolNodes: tCount,
      systemNodeCount: sCount,
      systemNodes: sCount,
      structuralNodes: strCount,
      otherNodeCount: oCount,
      otherNodes: oCount
    };

    integrityObj.conversationMessageCount = conversationMessageCount;
    integrityObj.visibleMessageCount = visibleMessageCount;
    integrityObj.sourceNodeCount = sourceNodeCount;
    integrityObj.nodeMetrics = nodeMetrics;

    const topLevelAttachments = (Array.isArray(params.attachments) ? params.attachments : [])
      .map((att, idx) => normalizeAttachment(att, idx))
      .filter(Boolean);

    const topLevelReferences = (Array.isArray(params.references) ? params.references : [])
      .map((ref, idx) => normalizeReference(ref, idx))
      .filter(Boolean);

    return {
      $schema: SCHEMA_URI,
      specVersion: params.specVersion || AICP_VERSION, // Garantiza compatibilidad v1.0.0
      canonicalVersion: LINER_CANONICAL_VERSION,
      canonicalId,
      source: {
        platform,
        conversationId,
        url,
        workspace: (params.source && params.source.workspace) || params.workspace || null,
        project: (params.source && params.source.project) || params.project || null,
        acquisitionMethod
      },
      title,
      createdAt: params.createdAt || now,
      updatedAt: params.updatedAt || now,
      model,
      conversationMessageCount,
      visibleMessageCount,
      sourceNodeCount,
      nodeMetrics,
      messages,
      branches: params.branches || null,
      attachments: topLevelAttachments,
      references: topLevelReferences,
      integrity: integrityObj,
      capabilities: params.capabilities || {},
      provenance: {
        generator: 'Liner Context Portability Layer (Clean-Room / 100% Local)',
        version: LINER_CANONICAL_VERSION,
        capturedAt: now,
        transformations: params.transformations || ['canonical-normalization-v1.3'],
        license: 'Apache-2.0'
      },
      metadata: {
        id: canonicalId,
        title,
        platform,
        model,
        integrity: typeof params.integrity === 'string' ? params.integrity : integrityObj.status,
        ...(integrityObj.warnings.length > 0 ? { integrityNotice: integrityObj.warnings.join('; ') } : {}),
        url,
        exportedAt: now,
        totalMessages: messages.length,
        visibleMessageCount,
        sourceNodeCount,
        nodeMetrics,
        provenance: {
          generator: 'Liner Context Portability Layer (Clean-Room / 100% Local)',
          license: 'Apache-2.0'
        }
      },
      projectContext: {
        instructions: params.projectContext?.instructions || '',
        customInstructions: params.projectContext?.customInstructions || null
      }
    };
  }

  /**
   * Valida un objeto contra las invariantes del esquema canónico Liner/AICP.
   */
  function validateCanonicalConversation(conv) {
    const errors = [];

    if (!conv || typeof conv !== 'object') {
      return { valid: false, errors: ['El objeto de conversación no es válido'] };
    }

    const isCompatible = conv.specVersion === AICP_VERSION || conv.canonicalVersion === LINER_CANONICAL_VERSION || conv.specVersion === LINER_CANONICAL_VERSION;
    if (!isCompatible) {
      errors.push(`specVersion incompatible: esperado ${AICP_VERSION} o ${LINER_CANONICAL_VERSION}, recibido ${conv.specVersion}`);
    }

    const meta = conv.metadata || {};
    const title = meta.title || conv.title;
    const platform = meta.platform || (conv.source && conv.source.platform);

    if (!title) errors.push('metadata.title o title es obligatorio');
    if (!platform) errors.push('metadata.platform o source.platform es obligatorio');

    if (!Array.isArray(conv.messages)) {
      errors.push('messages debe ser un array');
    } else {
      conv.messages.forEach((m, idx) => {
        if (!m.id) errors.push(`messages[${idx}].id es obligatorio`);
        if (!m.role || !MESSAGE_ROLES.includes(m.role)) {
          errors.push(`messages[${idx}].role inválido: ${m.role}`);
        }
        if (!m.content || typeof m.content.text !== 'string') {
          errors.push(`messages[${idx}].content.text debe ser una cadena`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  const CLIP_SELECTION_TYPES = ['single-message', 'turn-pair', 'contiguous-range', 'multi-message'];

  /**
   * Crea un Clip canónico de Lossy v1.4 a partir de mensajes seleccionados de una conversación.
   * Preserva procedencia, orden cronológico, y nunca crea texto huérfano.
   */
  function createCanonicalClip(params = {}) {
    const sourceConv = params.sourceConversation || {};
    const sourceConvId = params.sourceConversationId || sourceConv.source?.conversationId || (sourceConv.canonicalId ? sourceConv.canonicalId.replace(/^(conv_chatgpt_|conv_lossy_)/, '') : null);
    const sourceConvCanonicalId = params.sourceConversationCanonicalId || sourceConv.canonicalId || (sourceConvId ? `conv_chatgpt_${sourceConvId}` : null);
    const sourceConvTitle = (params.sourceConversationTitle || sourceConv.title || 'Conversación ChatGPT').trim();
    const sourcePlatform = (params.sourcePlatform || sourceConv.source?.platform || 'chatgpt').toLowerCase();
    const sourceModel = params.model || sourceConv.model || (sourceConv.metadata && sourceConv.metadata.model) || null;
    let rawMessages = Array.isArray(params.selectedMessages)
      ? params.selectedMessages
      : (Array.isArray(params.messages) ? params.messages : []);
    if (rawMessages.length === 0 && Array.isArray(params.selectedTurnIndices) && Array.isArray(sourceConv.messages)) {
      rawMessages = params.selectedTurnIndices.map(idx => sourceConv.messages[idx]).filter(Boolean);
    }

    // Preservar orden cronológico estricto de la conversación origen
    const sortedRaw = [...rawMessages].sort((a, b) => {
      const ordA = typeof a.sourceOrdinal === 'number' ? a.sourceOrdinal : (typeof a.index === 'number' ? a.index : null);
      const ordB = typeof b.sourceOrdinal === 'number' ? b.sourceOrdinal : (typeof b.index === 'number' ? b.index : null);
      if (ordA !== null && ordB !== null) return ordA - ordB;

      const timeA = a.create_time ? (a.create_time * 1000) : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
      const timeB = b.create_time ? (b.create_time * 1000) : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
      if (timeA && timeB) return timeA - timeB;
      return 0;
    });

    const selectedMessages = sortedRaw.map((m, idx) => ({
      id: m.id || generateId('cmsg', `${sourceConvId}_${idx}`),
      role: m.role || 'user',
      author: m.author || (m.role === 'assistant' ? 'ChatGPT' : 'Usuario'),
      timestamp: m.timestamp || m.createdAt || new Date().toISOString(),
      content: {
        text: (m.content && typeof m.content === 'object') ? (m.content.text || '') : (m.text || ''),
        codeBlocks: (m.content && Array.isArray(m.content.codeBlocks)) ? m.content.codeBlocks : (Array.isArray(m.codeBlocks) ? m.codeBlocks : []),
        attachments: (m.attachments || m.content?.attachments || []).map(normalizeAttachment)
      },
      attachments: (m.attachments || m.content?.attachments || []).map(normalizeAttachment),
      sourceOrdinal: typeof m.sourceOrdinal === 'number' ? m.sourceOrdinal : (typeof m.index === 'number' ? m.index : idx)
    }));

    // Determinar tipo de selección
    let selectionType = params.selectionType;
    if (!selectionType) {
      if (selectedMessages.length === 1) {
        selectionType = 'single-message';
      } else if (selectedMessages.length === 2 && selectedMessages[0].role !== selectedMessages[1].role) {
        selectionType = 'turn-pair';
      } else if (selectedMessages.length > 2) {
        const ordinals = selectedMessages.map(m => m.sourceOrdinal);
        const isContiguous = ordinals.every((ord, i) => i === 0 || ord === ordinals[i - 1] + 1);
        selectionType = isContiguous ? 'contiguous-range' : 'multi-message';
      } else {
        selectionType = 'multi-message';
      }
    }

    const now = new Date().toISOString();
    const clipId = params.id || params.canonicalId || generateId('clip', `${sourceConvId || 'custom'}_${selectedMessages.length}`);
    const defaultTitle = `Clip: ${sourceConvTitle} (${selectedMessages.length} ${selectedMessages.length === 1 ? 'mensaje' : 'mensajes'})`;
    const title = (params.title || defaultTitle).trim();

    const sourceIntegrityStatus = (sourceConv.integrity && typeof sourceConv.integrity === 'object')
      ? (sourceConv.integrity.status || 'captured')
      : (sourceConv.integrity || 'captured');

    return {
      $schema: 'https://aicp.dev/v1.3/canonical-clip.schema.json',
      entityType: 'clip',
      specVersion: AICP_VERSION,
      canonicalVersion: '1.4.0',
      id: clipId,
      canonicalId: clipId,
      title,
      sourcePlatform,
      model: sourceModel,
      sourceModel,
      sourceConversationId: sourceConvId,
      sourceConversationCanonicalId: sourceConvCanonicalId,
      sourceConversationTitle: sourceConvTitle,
      sourceStatus: params.sourceStatus || 'source_available_locally',
      selectedMessages,
      messages: selectedMessages,
      visibleMessageCount: selectedMessages.length,
      sourceNodeCount: selectedMessages.length,
      selectionType,
      createdAt: params.createdAt || now,
      updatedAt: params.updatedAt || now,
      notes: params.notes || '',
      integrity: {
        clipSelectionIntegrity: 'complete',
        sourceConversationIntegrity: sourceIntegrityStatus,
        messageCount: selectedMessages.length,
        visibleMessageCount: selectedMessages.length,
        sourceNodeCount: selectedMessages.length
      },
      provenance: {
        sourcePlatform,
        sourceModel,
        sourceConversation: sourceConvTitle,
        sourceConversationCanonicalId: sourceConvCanonicalId,
        sourceConversationId: sourceConvId,
        sourceMessageIds: selectedMessages.map(m => m.id),
        messageOrdering: 'chronological',
        captureTimestamp: sourceConv.createdAt || now,
        clipCreationTimestamp: now,
        integrityRelationship: 'exact-subset',
        sourceStatus: params.sourceStatus || 'source_available_locally',
        generator: 'Lossy Context Portability Layer (Clean-Room / 100% Local)',
        license: 'Apache-2.0'
      }
    };
  }

  /**
   * Valida un objeto contra las invariantes de Clip canónico.
   */
  function validateCanonicalClip(clip) {
    const errors = [];
    if (!clip || typeof clip !== 'object') {
      return { valid: false, errors: ['El objeto de clip no es válido'] };
    }
    if (!clip.id && !clip.canonicalId) errors.push('clip.id o canonicalId es obligatorio');
    if (!clip.title) errors.push('clip.title es obligatorio');
    if (!clip.sourcePlatform) errors.push('clip.sourcePlatform es obligatorio');
    if (!clip.sourceConversationTitle) errors.push('clip.sourceConversationTitle es obligatorio (anti-orfandad)');
    if (!clip.selectionType || !CLIP_SELECTION_TYPES.includes(clip.selectionType)) {
      errors.push(`clip.selectionType inválido: ${clip.selectionType}`);
    }
    if (!Array.isArray(clip.selectedMessages) || clip.selectedMessages.length === 0) {
      errors.push('clip.selectedMessages debe contener al menos 1 mensaje');
    } else {
      clip.selectedMessages.forEach((m, idx) => {
        if (!m.role) errors.push(`selectedMessages[${idx}].role es obligatorio`);
        if (!m.content || typeof m.content.text !== 'string') {
          errors.push(`selectedMessages[${idx}].content.text debe ser una cadena`);
        }
      });
    }
    if (!clip.provenance || typeof clip.provenance !== 'object') {
      errors.push('clip.provenance es obligatorio');
    } else {
      if (!clip.provenance.sourceConversation) {
        errors.push('clip.provenance.sourceConversation es obligatorio');
      }
      if (!Array.isArray(clip.provenance.sourceMessageIds)) {
        errors.push('clip.provenance.sourceMessageIds debe ser un array');
      }
    }
    if (!clip.integrity || typeof clip.integrity !== 'object') {
      errors.push('clip.integrity es obligatorio');
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  function isCanonicalClip(entity) {
    return Boolean(
      entity &&
      (entity.entityType === 'clip' ||
       (typeof entity.canonicalId === 'string' && entity.canonicalId.startsWith('clip_')) ||
       (typeof entity.id === 'string' && entity.id.startsWith('clip_')))
    );
  }

  return {
    AICP_VERSION,
    LINER_CANONICAL_VERSION,
    SCHEMA_URI,
    INTEGRITY_STATUS,
    ACQUISITION_METHODS,
    MESSAGE_ROLES,
    CLIP_SELECTION_TYPES,
    generateId,
    createCanonicalConversation,
    validateCanonicalConversation,
    createCanonicalClip,
    validateCanonicalClip,
    isCanonicalClip,
    createCanonicalAsset,
    normalizeAttachment,
    normalizeReference,
    classifyMessageNode
  };
});
