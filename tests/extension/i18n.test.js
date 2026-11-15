'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../../extension/src/core/i18n/translator.js');
const { TEXT, PATTERNS } = require('../../extension/src/core/i18n/en_strings.js');

test('translates a known label and keeps the surrounding spaces', () => {
  assert.equal(i18n.translateText('  Biblioteca  '), '  Library  ');
});

test('leaves Spanish text without an entry unchanged', () => {
  assert.equal(i18n.translateText('Texto sin entrada registrada'), 'Texto sin entrada registrada');
});

test('translates variable messages through patterns and keeps their numbers', () => {
  assert.equal(i18n.translateText('2 mensajes capturados'), '2 messages captured');
  assert.equal(i18n.translateText('1 mensaje capturado'), '1 message captured');
  assert.equal(i18n.translateText('Exportación rápida TXT'), 'Quick TXT export');
  assert.equal(i18n.translateText('Actualizado: hace 5 min'), 'Updated 5 min ago');
  assert.equal(i18n.translateText('3 de 5 imágenes guardadas · Disponibles sin conexión.'), '3 of 5 images saved · Available offline.');
});

test('translates only when the browser language is English', () => {
  assert.equal(i18n.isEnglishLanguage('en-US'), true);
  assert.equal(i18n.isEnglishLanguage('en'), true);
  assert.equal(i18n.isEnglishLanguage('en_GB'), true);
  assert.equal(i18n.isEnglishLanguage('es-ES'), false);
  assert.equal(i18n.isEnglishLanguage('engl'), false);
  assert.equal(i18n.isEnglishLanguage(''), false);
  assert.equal(i18n.isEnglishLanguage(undefined), false);
});

test('English output is not translated again', () => {
  const english = i18n.translateText('Biblioteca');
  assert.equal(i18n.translateText(english), english);
});

test('dictionary keys are trimmed, non-empty, and map to a different English text', () => {
  for (const [spanish, english] of Object.entries(TEXT)) {
    assert.equal(spanish, spanish.trim(), `La clave tiene espacios sobrantes: "${spanish}"`);
    assert.ok(spanish.length > 0);
    assert.equal(typeof english, 'string');
    assert.ok(english.trim().length > 0, `Sin traducción para "${spanish}"`);
  }
});

test('every pattern replacement only refers to groups its regular expression defines', () => {
  for (const [pattern, replacement] of PATTERNS) {
    const groups = new RegExp(`${pattern.source}|`).exec('').length - 1;
    const referenced = [...replacement.matchAll(/\$(\d)/g)].map(match => Number(match[1]));
    for (const index of referenced) {
      assert.ok(index >= 1 && index <= groups, `${pattern} usa $${index} sin grupo correspondiente`);
    }
  }
});
