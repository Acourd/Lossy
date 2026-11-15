/*
 * Arranque de la traducción en las páginas de la extensión (popup y espacio de trabajo).
 * Requiere que en_strings.js y translator.js se carguen antes.
 */
(function () {
  if (typeof LossyI18n === 'undefined') return;
  const KEY = 'lossy.uiLanguage';

  function storedLanguage() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function storeLanguage(language) {
    try { localStorage.setItem(KEY, language); } catch (_) { /* sin almacenamiento local */ }
    try { chrome.storage.local.set({ [KEY]: language }); } catch (_) { /* sin API de extensión */ }
  }

  // Predeterminado: inglés. Español solo si la persona lo eligió en Configuración.
  const language = storedLanguage() === 'es' ? 'es' : 'en';
  LossyI18n.setLanguage(language);

  function start() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-ui-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.uiLanguage === language));
    });
    LossyI18n.startDomTranslation(document);
  }

  // Los botones de idioma guardan la elección y recargan la página para aplicarla.
  document.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-ui-language]') : null;
    if (!button) return;
    storeLanguage(button.dataset.uiLanguage === 'es' ? 'es' : 'en');
    location.reload();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
