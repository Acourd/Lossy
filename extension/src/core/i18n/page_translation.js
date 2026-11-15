/*
 * Arranque de la traducción en las páginas de la extensión (popup y espacio de trabajo).
 * Requiere que en_strings.js y translator.js se carguen antes.
 */
(function () {
  if (typeof LossyI18n === 'undefined') return;
  function start() {
    const language = LossyI18n.currentLanguage();
    if (!LossyI18n.isEnglishLanguage(language)) return;
    document.documentElement.lang = 'en';
    LossyI18n.startDomTranslation(document, language);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
