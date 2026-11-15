/**
 * Liner Context Portability — Gestor de Adquisición Híbrida para ChatGPT
 * Orquesta la jerarquía de adquisición:
 *   Preferencia 1: Adquisición Estructurada (Session API / DAG)
 *   Preferencia 2: Adquisición DOM con Re-hidratación y Barrido de Scroll
 *   Preferencia 3: Ingestión de Export Oficial de ChatGPT
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const structured = require('./structured/chatgpt_structured_acquisition.js');
    const canonical = require('../../core/canonical_model.js');
    const capabilities = require('./capabilities/chatgpt_capabilities.js');
    module.exports = factory(structured, canonical, capabilities);
  } else {
    root.Liner = root.Liner || {};
    const structured = {
      parseChatGPTConversationTree: root.Liner.parseChatGPTConversationTree,
      ChatGPTStructuredClient: root.Liner.ChatGPTStructuredClient
    };
    const canonical = root.Liner.CanonicalModel;
    const capabilities = {
      ChatGPTCapabilityDetector: root.Liner.ChatGPTCapabilityDetector
    };
    root.Liner.ChatGPTAcquisitionManager = factory(structured, canonical, capabilities).ChatGPTAcquisitionManager;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (structured, canonical, capabilities) {
  'use strict';

  const {
    parseChatGPTConversationTree,
    ChatGPTStructuredClient
  } = structured;
  const {
    createCanonicalConversation,
    ACQUISITION_METHODS,
    INTEGRITY_STATUS
  } = canonical;
  const { ChatGPTCapabilityDetector } = capabilities;

  class ChatGPTAcquisitionManager {
    constructor(options = {}) {
      this.structuredClient = options.structuredClient || new ChatGPTStructuredClient(options.fetch);
      this.capabilityDetector = options.capabilityDetector || new ChatGPTCapabilityDetector(options);
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
    }

    /**
     * Adquiere una conversación por su ID o desde el DOM actual según disponibilidad.
     */
    async acquireConversation(conversationId, options = {}) {
      const warnings = [];
      const missingItems = [];

      // 1. Intento Tier 1: Adquisición Estructurada
      if (conversationId) {
        try {
          const canonicalConv = await this.structuredClient.getConversation(conversationId);
          if (canonicalConv && canonicalConv.messages && canonicalConv.messages.length > 0) {
            return canonicalConv;
          }
        } catch (err) {
          warnings.push(`Fallo en adquisición estructurada (${err.message}). Ejecutando fallback a DOM.`);
        }
      }

      // 2. Intento Tier 2: Adquisición por DOM / Content Script
      if (options.domHarvester) {
        try {
          const domResult = await options.domHarvester();
          if (domResult && domResult.turns && domResult.turns.length > 0) {
            const status = domResult.integrity === 'partial' 
              ? INTEGRITY_STATUS.PARTIAL 
              : (warnings.length > 0 ? INTEGRITY_STATUS.DEGRADED : INTEGRITY_STATUS.CAPTURED);

            return createCanonicalConversation({
              title: domResult.title || 'Conversación ChatGPT',
              platform: 'chatgpt',
              conversationId: conversationId || null,
              model: domResult.model || null,
              acquisitionMethod: ACQUISITION_METHODS.DOM_HARVEST,
              messages: domResult.turns,
              integrity: {
                status,
                acquisitionMethod: ACQUISITION_METHODS.DOM_HARVEST,
                messageCount: domResult.turns.length,
                warnings: warnings.concat(domResult.integrityNotice ? [domResult.integrityNotice] : []),
                missingItems,
                browserVerified: true
              }
            });
          }
        } catch (domErr) {
          warnings.push(`Fallo en adquisición DOM: ${domErr.message}`);
        }
      }

      // 3. Fallo Total
      return createCanonicalConversation({
        title: options.title || 'Conversación no recuperada',
        platform: 'chatgpt',
        conversationId: conversationId || null,
        acquisitionMethod: ACQUISITION_METHODS.DOM_HARVEST,
        messages: [],
        integrity: {
          status: INTEGRITY_STATUS.FAILED,
          acquisitionMethod: ACQUISITION_METHODS.DOM_HARVEST,
          messageCount: 0,
          warnings: warnings.concat(['No se pudo recuperar contenido ni por sesión estructurada ni por DOM']),
          missingItems: ['all_messages'],
          browserVerified: false
        }
      });
    }

    /**
     * Ingesta un archivo oficial de exportación de ChatGPT (conversations.json).
     */
    ingestOfficialExport(rawConversationsArray) {
      if (!Array.isArray(rawConversationsArray)) {
        throw new Error('El archivo de exportación debe contener un array de conversaciones');
      }

      const identities = new Set();
      rawConversationsArray.forEach((rawConv, index) => {
        const label = `Conversación ${index + 1}`;
        if (!rawConv || typeof rawConv !== 'object' || Array.isArray(rawConv)) {
          throw new Error(`${label}: formato de conversación no válido`);
        }
        const id = rawConv.id || rawConv.conversation_id;
        if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
          throw new Error(`${label}: falta una identidad de origen válida`);
        }
        if (identities.has(id)) throw new Error(`${label}: identidad de conversación duplicada`);
        identities.add(id);
        if (!rawConv.mapping || typeof rawConv.mapping !== 'object' || Array.isArray(rawConv.mapping)) {
          throw new Error(`${label}: mapping de mensajes no válido`);
        }
        if (Object.values(rawConv.mapping).some(node => !node || typeof node !== 'object' || Array.isArray(node))) {
          throw new Error(`${label}: nodo del mapping no válido`);
        }
        if (rawConv.title != null && typeof rawConv.title !== 'string') {
          throw new Error(`${label}: título de conversación no válido`);
        }
      });

      return rawConversationsArray.map(rawConv => {
        return parseChatGPTConversationTree(rawConv, {
          acquisitionMethod: ACQUISITION_METHODS.OFFICIAL_EXPORT
        });
      });
    }
  }

  return {
    ChatGPTAcquisitionManager
  };
});
