# Lossy — Security, Permissions Matrix & Data Governance

Lossy is a **100% local-first Chrome Manifest V3** extension with zero external backend, zero telemetry, and zero declared npm runtime dependencies (bundled vendorized offline renderers: `extension/vendor/markdown-it.min.js` and `extension/vendor/katex*`).

## 1. Manifest V3 Permission Matrix

| Permission / Host | Purpose | Consuming Modules | Automated Verification |
| --- | --- | --- | --- |
| `activeTab` | Inspect active tab URL/title when the user clicks the extension icon | `src/popup/popup.js` | `tests/extension/aicp_canonical.test.js` |
| `storage` | Persist user language (`lossy.uiLanguage`) and pinned quick-export formats | `src/popup/popup.js`, `src/core/portability/export_center.js`, `src/content/content_script.js` | `tests/extension/i18n.test.js` |
| `scripting` | Dynamically inject the matching platform content script on first capture if a tab was opened before extension reload | `src/popup/popup.js` (`triggerActiveAcquisition`) | `tests/extension/aicp_canonical.test.js` |
| `unlimitedStorage` | Store large multi-turn conversations and embedded images in local IndexedDB (`LinerContextWorkbenchDB`) without silent truncation | `src/core/storage/liner_db.js` | `tests/extension/hardening.test.js` |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | Passive detection, DOM/structured capture, and session-scoped asset resolution on ChatGPT | `src/content/content_script.js`, `src/platforms/chatgpt/*` | `tests/extension/asset_acquisition.test.js` |
| `https://claude.ai/*` | Passive detection and DOM capture on Claude.ai | `src/platforms/multi_platform_adapter.js`, `src/content/multi_platform_content.js` | `tests/extension/scout_features.test.js` |
| `https://gemini.google.com/*` | Passive detection and DOM capture (including Markdown tables and thought-trace filtering) on Gemini | `src/platforms/multi_platform_adapter.js`, `src/content/multi_platform_content.js` | `tests/extension/scout_features.test.js` |
| `https://*.googleusercontent.com/*` | Authenticated raster image hydration (`DataURI`) for Gemini uploaded/generated images | `src/content/multi_platform_content.js`, `src/core/portability/export_center.js` | `tests/extension/scout_features.test.js` |
| `https://*.oaiusercontent.com/*` | Authenticated raster image hydration for ChatGPT generated/uploaded images | `src/platforms/chatgpt/chatgpt_assets.js`, `src/core/portability/export_center.js` | `tests/extension/asset_acquisition.test.js` |

## 2. Content Security Policy & Isolation Controls

- **Default MV3 CSP:** zero `eval`, zero `new Function`, zero remote scripts, zero inline HTML event handlers (`onclick=` / `onerror=`).
- **Sender Verification:** `service_worker.js` and `multi_platform_content.js` verify `sender.id === chrome.runtime.id` before processing runtime messages.
- **DIL v2 Widget Sandbox (`chatgpt_widgets.js`):** zero-`eval` recursive-descent evaluator with `Object.hasOwn` prototype-chain isolation, token/depth/node budgets, SVG tag/attribute allowlist, and strict color/URL sanitization.
- **Offline HTML Export (`html_builder.js`):** strict embedded `<meta http-equiv="Content-Security-Policy">`, raster-only `data:image/` allowlist (rejects `data:image/svg+xml`), and progress-guarded Markdown parser.
- **ZIP & Project Bundle Integrity (`zip_builder.js`, `project_bundle.js`):** CRC-32 verification, path-traversal rejection, overlap/bomb limits, SHA-256 receipt validation, and strict entity schema validation.

## 3. Data Retention, Deletion & Backup

- **Storage:** All captured conversations, clips, collections, and embedded images remain strictly inside the browser's local IndexedDB (`LinerContextWorkbenchDB`).
- **Anti-Regression Guard:** `LinerDB.saveConversation` refuses to silently overwrite a complete capture with a smaller `partial` capture unless `forceOverwrite: true` is explicitly passed.
- **Deletion:** Users can delete individual conversations, clips, or wipe the entire local database (`clearAll()`) from Workspace Settings at any time. Deleting a conversation preserves derived clips while marking their provenance as `source_unavailable_locally`.
- **Portable Backup:** Full lossless backups are exported locally as `.json` or verified Project `.zip` archives with SHA-256 receipts (`portability/receipt.json`).
