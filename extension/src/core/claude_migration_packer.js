/**
 * AI Conversation Portability (AICP / Liner) — Empaquetador de Migración para Claude v1.3
 * Conecta con ClaudeTargetAdapter para inyectar contexto masivo en Claude (Code, Web, Projects).
 */

const { ClaudeTargetAdapter } = require('../targets/claude_target_adapter.js');

const defaultAdapter = new ClaudeTargetAdapter();

/**
 * Crea un paquete de migración semántico para Claude.
 */
function createClaudeMigrationPacket(conversations, options = {}) {
  return defaultAdapter.generatePackage(conversations, options);
}

module.exports = {
  createClaudeMigrationPacket,
  ClaudeTargetAdapter
};
