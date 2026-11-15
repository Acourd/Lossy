/*
 * Traducción de la interfaz al inglés.
 *
 * El inglés es el idioma predeterminado; el español se usa solo si la persona lo elige
 * en Configuración. Cada nodo de texto o atributo
 * (title, aria-label, placeholder, alt) cuyo contenido coincide con una entrada de
 * en_strings.js se reemplaza por su traducción, también cuando la interfaz lo genera
 * después de cargar. Lo que no tiene entrada se muestra tal cual, en español.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LossyI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const dictionary = (typeof module !== 'undefined' && module.exports)
    ? require('./en_strings.js')
    : root.LossyEnStrings;
  const TEXT = dictionary.TEXT;
  const PATTERNS = dictionary.PATTERNS;
  const TRANSLATABLE_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];
  const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

  function isEnglishLanguage(language) {
    return typeof language === 'string' && /^en(?:[-_]|$)/i.test(language);
  }

  // Idioma activo. El inglés es el predeterminado; el español solo se usa si la persona lo elige.
  let activeLanguage = 'en';
  function setLanguage(language) {
    activeLanguage = language === 'es' ? 'es' : 'en';
  }
  function getLanguage() {
    return activeLanguage;
  }

  // Traduce un texto completo. Conserva los espacios de los extremos.
  function translateText(value) {
    if (activeLanguage !== 'en' || typeof value !== 'string') return value;
    const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    const core = parts[2];
    if (!core) return value;
    let translated;
    if (Object.prototype.hasOwnProperty.call(TEXT, core)) {
      translated = TEXT[core];
    } else {
      for (const [pattern, replacement] of PATTERNS) {
        if (pattern.test(core)) {
          translated = core.replace(pattern, replacement);
          break;
        }
      }
    }
    return translated === undefined ? value : parts[1] + translated + parts[3];
  }

  function translateAttributes(element) {
    for (const name of TRANSLATABLE_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      const next = translateText(value);
      if (next !== value) element.setAttribute(name, next);
    }
  }

  function translateNode(node) {
    if (node.nodeType === 3) {
      const next = translateText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1) return;
    translateAttributes(node);
    if (SKIPPED_TAGS.has(node.tagName)) return;
    for (const child of Array.from(node.childNodes)) translateNode(child);
  }

  // Traduce el documento y sigue traduciendo lo que se añada o cambie después.
  // Devuelve el observador, o null si el idioma activo no es inglés.
  function startDomTranslation(doc) {
    if (activeLanguage !== 'en' || typeof MutationObserver === 'undefined') return null;
    const scope = doc.body || doc.documentElement;
    translateNode(scope);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') translateNode(record.target);
        else if (record.type === 'attributes') translateAttributes(record.target);
        else for (const node of record.addedNodes) translateNode(node);
      }
    });
    observer.observe(scope, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });
    return observer;
  }

  return {
    isEnglishLanguage,
    setLanguage,
    getLanguage,
    translateText,
    translateNode,
    startDomTranslation,
  };
});
