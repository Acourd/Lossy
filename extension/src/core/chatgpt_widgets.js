/**
 * Lossy — ChatGPT DIL (Dynamic Interface Language) Parser, Evaluator & Renderer
 * Soporta el lenguaje completo de componentes visuales de ChatGPT:
 *   - Bloques: <grid>, <grid-item>, <card>, <box>, <row>, <stack>, <col>, <svg>
 *   - Controles: <title>, <caption>, <text>, <badge>, <slider>, <divider>, <spacer>, <favicon>, <AsyncImage>, <Link>
 *   - Directivas DIL: {@body const [x,setX]=DIL.useState(...)}, {@body const y=...}, {#each [...] as item,i}...{/each}
 *   - Tokens de control internos: <Cite .../>, <SuggestAutomation .../>, <DisplayAutomation .../>
 * Zero-eval, zero-dependencies, 100% compatible con CSP estricto MV3. Dual Browser/Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Lossy = root.Lossy || {};
    root.Lossy.ChatGPTWidgets = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAFE_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const SAFE_SVG_TAGS = new Set([
    'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan'
  ]);
  const SVG_ATTR_MAP = {
    viewbox: 'viewBox',
    width: 'width',
    height: 'height',
    x: 'x',
    y: 'y',
    x1: 'x1',
    y1: 'y1',
    x2: 'x2',
    y2: 'y2',
    cx: 'cx',
    cy: 'cy',
    r: 'r',
    rx: 'rx',
    ry: 'ry',
    d: 'd',
    points: 'points',
    fill: 'fill',
    fillopacity: 'fill-opacity',
    'fill-opacity': 'fill-opacity',
    stroke: 'stroke',
    strokeopacity: 'stroke-opacity',
    'stroke-opacity': 'stroke-opacity',
    strokewidth: 'stroke-width',
    'stroke-width': 'stroke-width',
    strokedasharray: 'stroke-dasharray',
    'stroke-dasharray': 'stroke-dasharray',
    strokelinecap: 'stroke-linecap',
    'stroke-linecap': 'stroke-linecap',
    strokelinejoin: 'stroke-linejoin',
    'stroke-linejoin': 'stroke-linejoin',
    fontsize: 'font-size',
    'font-size': 'font-size',
    fontweight: 'font-weight',
    'font-weight': 'font-weight',
    textanchor: 'text-anchor',
    'text-anchor': 'text-anchor',
    dominantbaseline: 'dominant-baseline',
    'dominant-baseline': 'dominant-baseline',
    opacity: 'opacity',
    transform: 'transform'
  };

  const SEMANTIC_COLORS = {
    success: '#15803d',
    warning: '#b45309',
    danger: '#b91c1c',
    error: '#b91c1c',
    secondary: '#5c7068',
    muted: '#6b7f77',
    primary: '#194f3b'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function sanitizeColor(raw, fallback) {
    const val = String(raw || '').trim();
    if (SAFE_HEX_RE.test(val)) return val;
    if (val === 'none' || val === 'currentColor' || val === 'transparent') return val;
    if (Object.hasOwn(SEMANTIC_COLORS, val.toLowerCase())) return SEMANTIC_COLORS[val.toLowerCase()];
    return fallback;
  }

  function parsePercent(raw) {
    const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!match) return null;
    return Math.max(0, Math.min(100, Math.round(Number(match[1]))));
  }

  // --- 1. EVALUADOR SEGURO DE EXPRESIONES DIL (ZERO-EVAL, CSP SAFE) ---

  function tokenizeExpr(src) {
    const MAX_TOKENS = 2000;
    const tokens = [];
    let i = 0;
    const len = src.length;
    while (i < len && tokens.length < MAX_TOKENS) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }

      // Numbers (including .61)
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || ''))) {
        let num = '';
        while (i < len && /[\d.]/.test(src[i])) num += src[i++];
        tokens.push({ type: 'num', value: Number(num) });
        continue;
      }

      // Quoted strings
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        let str = '';
        while (i < len && src[i] !== quote) {
          if (src[i] === '\\' && i + 1 < len) {
            i++;
            const esc = src[i++];
            str += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          } else {
            str += src[i++];
          }
        }
        i++;
        tokens.push({ type: 'str', value: str });
        continue;
      }

      // Template literals `...${expr}...`
      if (ch === '`') {
        i++;
        const parts = [];
        let buf = '';
        while (i < len && src[i] !== '`') {
          if (src[i] === '$' && src[i + 1] === '{') {
            if (buf) { parts.push({ kind: 'lit', value: buf }); buf = ''; }
            i += 2;
            let depth = 1, exprBuf = '';
            while (i < len && depth > 0) {
              if (src[i] === '{') depth++;
              else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
              exprBuf += src[i++];
            }
            parts.push({ kind: 'expr', value: exprBuf });
          } else {
            buf += src[i++];
          }
        }
        if (buf) parts.push({ kind: 'lit', value: buf });
        i++;
        tokens.push({ type: 'tpl', value: parts });
        continue;
      }

      // 3-char & 2-char operators
      const three = src.slice(i, i + 3);
      if (three === '===' || three === '!==') {
        tokens.push({ type: 'op', value: three }); i += 3; continue;
      }
      const two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        tokens.push({ type: 'op', value: two }); i += 2; continue;
      }

      // 1-char punctuation/operators
      if ('+-*/%<>!?:()[]{},.'.includes(ch)) {
        tokens.push({ type: 'op', value: ch }); i++; continue;
      }

      // Identifiers
      if (/[a-zA-Z_$]/.test(ch)) {
        let id = '';
        while (i < len && /[a-zA-Z0-9_$]/.test(src[i])) id += src[i++];
        if (id === 'true') tokens.push({ type: 'bool', value: true });
        else if (id === 'false') tokens.push({ type: 'bool', value: false });
        else if (id === 'null') tokens.push({ type: 'null', value: null });
        else tokens.push({ type: 'id', value: id });
        continue;
      }

      i++;
    }
    return tokens;
  }

  function safeEvalExpr(exprStr, env, depth = 0) {
    if (depth > 32) return undefined;
    const tokens = tokenizeExpr(String(exprStr || '').trim());
    let pos = 0;
    let callDepth = depth;
    const guardDepth = () => { if (++callDepth > 64) throw new Error('DEPTH'); };

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];
    const matchOp = op => {
      if (peek() && peek().type === 'op' && peek().value === op) { pos++; return true; }
      return false;
    };

    function parseTernary() {
      guardDepth();
      const cond = parseOr();
      if (matchOp('?')) {
        const t = parseTernary();
        matchOp(':');
        const f = parseTernary();
        return cond ? t : f;
      }
      return cond;
    }

    function parseOr() {
      let left = parseAnd();
      while (matchOp('||')) {
        const right = parseAnd();
        left = left || right;
      }
      return left;
    }

    function parseAnd() {
      let left = parseEq();
      while (matchOp('&&')) {
        const right = parseEq();
        left = left && right;
      }
      return left;
    }

    function parseEq() {
      let left = parseRel();
      while (peek() && peek().type === 'op' && ['===', '!==', '==', '!='].includes(peek().value)) {
        const op = consume().value;
        const right = parseRel();
        if (op === '===') left = left === right;
        else if (op === '!==') left = left !== right;
        else if (op === '==') left = left == right; // eslint-disable-line eqeqeq
        else left = left != right; // eslint-disable-line eqeqeq
      }
      return left;
    }

    function parseRel() {
      let left = parseAdd();
      while (peek() && peek().type === 'op' && ['<', '<=', '>', '>='].includes(peek().value)) {
        const op = consume().value;
        const right = parseAdd();
        if (op === '<') left = left < right;
        else if (op === '<=') left = left <= right;
        else if (op === '>') left = left > right;
        else left = left >= right;
      }
      return left;
    }

    function parseAdd() {
      let left = parseMul();
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseMul();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseMul() {
      let left = parseUnary();
      while (peek() && peek().type === 'op' && ['*', '/', '%'].includes(peek().value)) {
        const op = consume().value;
        const right = parseUnary();
        if (op === '*') left = left * right;
        else if (op === '/') left = right === 0 ? 0 : left / right;
        else left = right === 0 ? 0 : left % right;
      }
      return left;
    }

    function parseUnary() {
      if (matchOp('-')) return -parseUnary();
      if (matchOp('+')) return +parseUnary();
      if (matchOp('!')) return !parseUnary();
      return parsePostfix();
    }

    function parsePostfix() {
      let val = parsePrimary();
      while (peek() && peek().type === 'op' && (peek().value === '.' || peek().value === '[')) {
        if (matchOp('.')) {
          const propTok = consume();
          if (!propTok || propTok.type !== 'id') break;
          const prop = propTok.value;
          if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') return undefined;
          if (matchOp('(')) {
            const args = [];
            while (peek() && !(peek().type === 'op' && peek().value === ')')) {
              args.push(parseTernary());
              matchOp(',');
            }
            matchOp(')');
            if (prop === 'toFixed' && typeof val === 'number') {
              val = val.toFixed(Math.max(0, Math.min(6, Number(args[0]) || 0)));
            } else if (val === Math && ['round', 'floor', 'ceil', 'abs', 'min', 'max'].includes(prop)) {
              val = Math[prop](...args.map(Number));
            } else {
              val = undefined;
            }
          } else if (val && typeof val === 'object' && Object.hasOwn(val, prop)) {
            val = val[prop];
          } else if (Array.isArray(val) && prop === 'length') {
            val = val.length;
          } else {
            val = undefined;
          }
        } else if (matchOp('[')) {
          const key = parseTernary();
          matchOp(']');
          const keyStr = String(key);
          if (val && (Array.isArray(val) || typeof val === 'object') && keyStr !== '__proto__' && keyStr !== 'constructor' && keyStr !== 'prototype' && Object.hasOwn(val, keyStr)) {
            val = val[keyStr];
          } else {
            val = undefined;
          }
        }
      }
      return val;
    }

    function parsePrimary() {
      const tok = peek();
      if (!tok) return undefined;

      if (tok.type === 'num' || tok.type === 'str' || tok.type === 'bool' || tok.type === 'null') {
        consume();
        return tok.value;
      }

      if (tok.type === 'tpl') {
        consume();
        return tok.value.map(p => (p.kind === 'lit' ? p.value : String(safeEvalExpr(p.value, env, callDepth + 1) ?? ''))).join('');
      }

      if (tok.type === 'id') {
        consume();
        if (tok.value === 'Math') return Math;
        if (env && Object.hasOwn(env, tok.value)) return env[tok.value];
        return undefined;
      }

      if (matchOp('(')) {
        const inner = parseTernary();
        matchOp(')');
        return inner;
      }

      if (matchOp('[')) {
        const arr = [];
        while (peek() && !(peek().type === 'op' && peek().value === ']')) {
          arr.push(parseTernary());
          if (!matchOp(',')) break;
        }
        matchOp(']');
        return arr;
      }

      if (matchOp('{')) {
        const obj = Object.create(null);
        while (peek() && !(peek().type === 'op' && peek().value === '}')) {
          const keyTok = consume();
          if (!keyTok) break;
          const k = String(keyTok.value);
          matchOp(':');
          const v = parseTernary();
          if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
            obj[k] = v;
          }
          if (!matchOp(',')) break;
        }
        matchOp('}');
        return obj;
      }

      consume();
      return undefined;
    }

    try {
      const result = parseTernary();
      if (pos !== tokens.length) return undefined;
      return result;
    } catch (_) {
      return undefined;
    }
  }

  function interpolateBraces(str, env) {
    let out = '';
    let i = 0;
    const len = str.length;
    while (i < len) {
      if (str[i] === '{' && str[i + 1] !== '@' && str[i + 1] !== '#' && str[i + 1] !== '/') {
        let depth = 1, j = i + 1;
        while (j < len && depth > 0) {
          if (str[j] === '{') depth++;
          else if (str[j] === '}') depth--;
          j++;
        }
        if (depth === 0) {
          const inner = str.slice(i + 1, j - 1).trim();
          const evaluated = safeEvalExpr(inner, env);
          if (evaluated !== undefined && evaluated !== null && typeof evaluated !== 'object') {
            out += String(evaluated);
          } else {
            out += str.slice(i, j);
          }
          i = j;
          continue;
        }
      }
      out += str[i++];
    }
    return out;
  }

  /**
   * Expande directivas {@body ...} y bucles {#each ... as item,i}...{/each} en bloques DIL.
   */
  function expandDilDirectives(source, inheritedEnv = null) {
    const env = Object.assign(Object.create(null), inheritedEnv || {});
    let text = String(source || '');

    // 1. Extraer y evaluar {@body const ...} usando escáner de llaves balanceadas
    {
      let rebuilt = '';
      let idx = 0;
      while (idx < text.length) {
        const start = text.indexOf('{@body', idx);
        if (start === -1) { rebuilt += text.slice(idx); break; }
        rebuilt += text.slice(idx, start);
        let depth = 1;
        let j = start + 6;
        let inQuote = null;
        while (j < text.length && depth > 0) {
          const ch = text[j];
          if (inQuote) {
            if (ch === '\\') { j += 2; continue; }
            if (ch === inQuote) inQuote = null;
          } else {
            if (ch === '"' || ch === "'" || ch === '`') inQuote = ch;
            else if (ch === '{') depth++;
            else if (ch === '}') depth--;
          }
          j++;
        }
        if (depth === 0) {
          const stmt = text.slice(start + 6, j - 1).trim();
          const stateMatch = stmt.match(/^const\s*\[\s*([a-zA-Z_$][\w$]*)\s*(?:,\s*[a-zA-Z_$][\w$]*)?\s*\]\s*=\s*DIL\.useState\(([\s\S]+)\)$/);
          if (stateMatch) {
            env[stateMatch[1]] = safeEvalExpr(stateMatch[2], env);
          } else {
            const constMatch = stmt.match(/^(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*([\s\S]+)$/);
            if (constMatch) env[constMatch[1]] = safeEvalExpr(constMatch[2], env);
          }
          idx = j;
        } else {
          rebuilt += text.slice(start, start + 6);
          idx = start + 6;
        }
      }
      text = rebuilt;
    }

    // 2. Expandir bucles {#each expr as item[, idx]}...{/each}
    let guard = 0;
    const eachRe = /\{#each\s+([\s\S]*?)\s+as\s+([a-zA-Z_$][\w$]*)(?:\s*,\s*([a-zA-Z_$][\w$]*))?\s*\}([\s\S]*?)\{\/each\}/;
    while (eachRe.test(text) && guard++ < 25) {
      text = text.replace(eachRe, (full, listExpr, itemVar, idxVar, body) => {
        const list = safeEvalExpr(listExpr, env);
        if (!Array.isArray(list) || list.length === 0) return '';
        return list.slice(0, 100).map((item, idx) => {
          const localEnv = Object.assign(Object.create(null), env);
          localEnv[itemVar] = item;
          if (idxVar) localEnv[idxVar] = idx;
          return interpolateBraces(body, localEnv);
        }).join('\n');
      });
    }

    // 3. Evaluar interpolaciones restantes (incluyendo expresiones sin @body)
    if (text.includes('{')) {
      text = interpolateBraces(text, env);
    }

    return { text: text.trim(), env };
  }

  // --- 2. PARSER DE ATRIBUTOS Y AST RECURSIVO ---

  function parseAttrs(attrString, env) {
    const attrs = {};
    if (!attrString) return attrs;
    const re = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^}]*\})*)\}|([^\s/>]+)))?/g;
    let m;
    while ((m = re.exec(attrString)) !== null) {
      const key = m[1].toLowerCase();
      if (m[2] !== undefined) attrs[key] = m[2].trim();
      else if (m[3] !== undefined) attrs[key] = m[3].trim();
      else if (m[4] !== undefined) {
        const evaluated = env ? safeEvalExpr(m[4], env) : undefined;
        attrs[key] = evaluated !== undefined && typeof evaluated !== 'object' ? String(evaluated) : m[4].trim();
      } else if (m[5] !== undefined) attrs[key] = m[5].trim();
      else attrs[key] = 'true';
    }
    return attrs;
  }

  function parseWidgetAst(source, env) {
    const MAX_AST_NODES = 2000;
    const MAX_AST_DEPTH = 40;
    const root = { type: 'root', children: [] };
    const stack = [root];
    const tokenRe = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)(\s+(?:[^>"'{/]|\/(?!>)|\{(?:[^{}]|\{[^}]*\})*\}|"[^"]*"|'[^']*')*)?\s*(\/)?>|([^<]+)/g;
    let m;
    let nodeCount = 0;

    while ((m = tokenRe.exec(source)) !== null && nodeCount < MAX_AST_NODES) {
      nodeCount++;
      const [, isClosing, rawTag, rawAttrs, isSelfClosing, textChunk] = m;
      const current = stack[stack.length - 1];

      if (textChunk !== undefined) {
        const cleaned = textChunk.replace(/\s+/g, ' ');
        if (cleaned.trim()) {
          current.children.push({ type: 'text', value: cleaned.trim() });
        }
        continue;
      }

      const tag = rawTag.toLowerCase();
      if (isClosing) {
        for (let i = stack.length - 1; i >= 1; i--) {
          if (stack[i].tag === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }

      const node = {
        type: 'element',
        tag,
        attrs: parseAttrs(rawAttrs || '', env),
        children: []
      };
      current.children.push(node);

      const voidTags = ['hr', 'br', 'divider', 'spacer', 'favicon', 'asyncimage', 'slider', 'cite', 'suggestautomation', 'displayautomation'];
      if (!isSelfClosing && !voidTags.includes(tag) && stack.length < MAX_AST_DEPTH) {
        stack.push(node);
      }
    }

    return root;
  }

  function extractText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.value;
    if (node.tag === 'cite' || node.tag === 'favicon' || node.tag === 'asyncimage') return '';
    return (node.children || []).map(extractText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isProgressBarBox(node) {
    if (!node || node.type !== 'element' || node.tag !== 'box') return false;
    const childBox = (node.children || []).find(c => c.type === 'element' && c.tag === 'box' && parsePercent(c.attrs?.width) !== null);
    return Boolean(childBox);
  }

  function isStandaloneBarBox(node) {
    if (!node || node.type !== 'element' || node.tag !== 'box') return false;
    return (node.children || []).length === 0 && parsePercent(node.attrs?.width) !== null && Boolean(node.attrs?.background);
  }

  function extractProgressBar(node) {
    const fill = isProgressBarBox(node)
      ? (node.children || []).find(c => c.type === 'element' && c.tag === 'box' && parsePercent(c.attrs?.width) !== null)
      : node;
    if (!fill) return null;
    const percent = parsePercent(fill.attrs.width);
    const trackColor = isProgressBarBox(node) ? sanitizeColor(node.attrs?.background, '#e5e7eb') : '#e5e7eb';
    const fillColor = sanitizeColor(fill.attrs?.background, '#16a34a');
    const rawHeight = Number(node.attrs?.height || fill.attrs?.height || 8);
    const height = Number.isFinite(rawHeight) ? Math.max(5, Math.min(24, rawHeight)) : 8;
    return { percent, trackColor, fillColor, height };
  }

  function unicodeBar(percent) {
    const filled = Math.round((percent / 100) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  }

  function renderInlineMdToHtml(raw) {
    let safe = escapeHtml(raw);
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/(?:&amp;|[^)\s"'<>])+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return safe;
  }

  function renderSvgNodeToHtml(node) {
    if (!node) return '';
    if (node.type === 'text') return escapeHtml(node.value);
    if (node.type !== 'element' || !SAFE_SVG_TAGS.has(node.tag)) return '';
    const attrsOut = [];
    for (const [k, v] of Object.entries(node.attrs || {})) {
      const mapped = SVG_ATTR_MAP[k.toLowerCase()];
      if (!mapped) continue;
      const valStr = String(v || '').trim();
      if (/javascript:|expression\(|url\(/i.test(valStr)) continue;
      attrsOut.push(`${mapped}="${escapeHtml(valStr)}"`);
    }
    if (node.tag === 'svg' && !node.attrs?.xmlns) {
      attrsOut.push('xmlns="http://www.w3.org/2000/svg"');
      attrsOut.push('class="lossy-widget-svg"');
    }
    const childrenHtml = (node.children || []).map(renderSvgNodeToHtml).join('');
    return `<${node.tag}${attrsOut.length ? ' ' + attrsOut.join(' ') : ''}>${childrenHtml}</${node.tag}>`;
  }

  function summarizeSvgToText(node) {
    const labels = [];
    function walk(n) {
      if (!n) return;
      if (n.type === 'element' && n.tag === 'text') {
        const t = extractText(n);
        if (t) labels.push(t);
        return;
      }
      (n.children || []).forEach(walk);
    }
    walk(node);
    return labels.length ? labels.join(' · ') : '';
  }

  // --- 3. RENDERIZADOR RECURSIVO A HTML (PDF / DOCUMENT PREVIEW) ---

  function renderAstChildrenToHtml(children) {
    const out = [];
    let pendingCaption = null;

    const flushCaption = () => {
      if (pendingCaption !== null) {
        out.push(`<div class="lossy-widget-caption">${renderInlineMdToHtml(pendingCaption)}</div>`);
        pendingCaption = null;
      }
    };

    for (let i = 0; i < children.length; i++) {
      const node = children[i];

      if (node.type === 'text') {
        flushCaption();
        out.push(`<p class="lossy-widget-note">${renderInlineMdToHtml(node.value)}</p>`);
        continue;
      }

      const tag = node.tag;
      if (tag === 'cite' || tag === 'suggestautomation' || tag === 'displayautomation' || tag === 'asyncimage') {
        continue;
      }

      if (tag === 'spacer') {
        out.push('<span class="lossy-widget-spacer"></span>');
        continue;
      }

      if (tag === 'divider' || tag === 'hr') {
        flushCaption();
        out.push('<hr class="lossy-widget-divider">');
        continue;
      }

      if (tag === 'favicon') {
        const url = String(node.attrs?.url || '');
        const host = url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '');
        const initial = (host[0] || 'W').toUpperCase();
        out.push(`<span class="lossy-widget-favicon" aria-hidden="true">${escapeHtml(initial)}</span>`);
        continue;
      }

      if (tag === 'caption') {
        flushCaption();
        pendingCaption = extractText(node);
        continue;
      }

      if (isProgressBarBox(node) || isStandaloneBarBox(node)) {
        const bar = extractProgressBar(node);
        const labelHtml = pendingCaption
          ? `<div class="lossy-widget-bar-head"><span>${renderInlineMdToHtml(pendingCaption)}</span><span class="lossy-widget-pct">${bar.percent}%</span></div>`
          : '';
        pendingCaption = null;
        out.push(
          `<div class="lossy-widget-metric">${labelHtml}` +
          `<div class="lossy-widget-track" style="height:${bar.height}px;background:${bar.trackColor}">` +
          `<div class="lossy-widget-fill" style="width:${bar.percent}%;background:${bar.fillColor}"></div>` +
          `</div></div>`
        );
        continue;
      }

      if (tag === 'slider') {
        flushCaption();
        const min = Number(node.attrs?.min ?? 0);
        const max = Number(node.attrs?.max ?? 100);
        const val = Number(node.attrs?.value ?? min);
        const pct = max > min ? Math.max(0, Math.min(100, Math.round(((val - min) / (max - min)) * 100))) : 0;
        out.push(
          `<div class="lossy-widget-slider">` +
          `<div class="lossy-widget-track" style="height:6px;background:#e5e7eb">` +
          `<div class="lossy-widget-fill" style="width:${pct}%;background:#194f3b"></div>` +
          `</div></div>`
        );
        continue;
      }

      if (tag === 'svg') {
        flushCaption();
        out.push(`<div class="lossy-widget-svg-wrap">${renderSvgNodeToHtml(node)}</div>`);
        continue;
      }

      if (tag === 'title') {
        const val = extractText(node);
        const color = node.attrs?.color ? sanitizeColor(node.attrs.color, '#142821') : '#142821';
        const sizeClass = node.attrs?.size === '2xl' ? ' is-2xl' : (node.attrs?.size === 'lg' ? ' is-lg' : '');
        if (pendingCaption) {
          out.push(`<div class="lossy-widget-kpi"><div class="lossy-widget-caption">${renderInlineMdToHtml(pendingCaption)}</div><div class="lossy-widget-title${sizeClass}" style="color:${color}">${renderInlineMdToHtml(val)}</div></div>`);
          pendingCaption = null;
        } else {
          out.push(`<div class="lossy-widget-title${sizeClass}" style="color:${color}">${renderInlineMdToHtml(val)}</div>`);
        }
        continue;
      }

      if (tag === 'text') {
        const val = extractText(node);
        const colorKey = String(node.attrs?.color || '').toLowerCase();
        const isMuted = colorKey === 'secondary' || colorKey === 'muted';
        const colorStyle = Object.hasOwn(SEMANTIC_COLORS, colorKey) ? ` style="color:${SEMANTIC_COLORS[colorKey]}"` : '';
        const weightClass = node.attrs?.weight === 'medium' || node.attrs?.weight === 'bold' ? ' is-strong' : '';
        if (pendingCaption) {
          out.push(`<div class="lossy-widget-kv"><div class="lossy-widget-caption">${renderInlineMdToHtml(pendingCaption)}</div><div class="lossy-widget-value${isMuted ? ' is-muted' : ''}${weightClass}"${colorStyle}>${renderInlineMdToHtml(val)}</div></div>`);
          pendingCaption = null;
        } else if (val) {
          out.push(`<span class="lossy-widget-note${isMuted ? ' is-muted' : ''}${weightClass}"${colorStyle}>${renderInlineMdToHtml(val)}</span>`);
        }
        continue;
      }

      if (tag === 'link') {
        flushCaption();
        const label = extractText(node);
        const url = String(node.attrs?.url || '');
        if (/^https?:\/\//i.test(url)) {
          out.push(`<a class="lossy-widget-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>`);
        } else if (label) {
          out.push(`<span class="lossy-widget-link-text">${escapeHtml(label)}</span>`);
        }
        continue;
      }

      if (tag === 'badge') {
        flushCaption();
        out.push(`<span class="lossy-widget-badge">${escapeHtml(extractText(node))}</span>`);
        continue;
      }

      if (tag === 'grid') {
        flushCaption();
        const cols = Math.max(1, Math.min(4, Number(node.attrs?.columns) || 2));
        out.push(`<div class="lossy-widget-grid lossy-widget-cols-${cols}">${renderAstChildrenToHtml(node.children || [])}</div>`);
        continue;
      }

      if (tag === 'grid-item') {
        flushCaption();
        out.push(`<div class="lossy-widget-item">${renderAstChildrenToHtml(node.children || [])}</div>`);
        continue;
      }

      if (tag === 'card') {
        flushCaption();
        out.push(`<div class="lossy-widget-card">${renderAstChildrenToHtml(node.children || [])}</div>`);
        continue;
      }

      if (tag === 'row') {
        flushCaption();
        out.push(`<div class="lossy-widget-row">${renderAstChildrenToHtml(node.children || [])}</div>`);
        continue;
      }

      if (tag === 'box' || tag === 'stack' || tag === 'col') {
        flushCaption();
        const hasBorder = Boolean(node.attrs?.border);
        const cls = hasBorder ? 'lossy-widget-card' : (node.attrs?.flex ? 'lossy-widget-flex' : 'lossy-widget-stack');
        out.push(`<div class="${cls}">${renderAstChildrenToHtml(node.children || [])}</div>`);
        continue;
      }

      flushCaption();
      const fallback = extractText(node);
      if (fallback) out.push(`<span class="lossy-widget-note">${renderInlineMdToHtml(fallback)}</span>`);
    }

    flushCaption();
    return out.join('');
  }

  // --- 4. RENDERIZADOR RECURSIVO A MARKDOWN ---

  function renderNodeLinesToMarkdown(children) {
    const lines = [];
    let pendingCaption = null;

    const flushCaption = () => {
      if (pendingCaption !== null) {
        lines.push(`**${pendingCaption}**`);
        pendingCaption = null;
      }
    };

    for (const node of children) {
      if (node.type === 'text') {
        flushCaption();
        lines.push(node.value);
        continue;
      }

      const tag = node.tag;
      if (tag === 'cite' || tag === 'suggestautomation' || tag === 'displayautomation' || tag === 'asyncimage' || tag === 'favicon' || tag === 'spacer' || tag === 'slider') {
        continue;
      }

      if (tag === 'divider' || tag === 'hr') {
        flushCaption();
        lines.push('---');
        continue;
      }

      if (tag === 'caption') {
        flushCaption();
        pendingCaption = extractText(node);
        continue;
      }

      if (isProgressBarBox(node) || isStandaloneBarBox(node)) {
        const bar = extractProgressBar(node);
        const prefix = pendingCaption ? `**${pendingCaption}:** ` : '';
        pendingCaption = null;
        lines.push(`- ${prefix}\`${unicodeBar(bar.percent)}\` **${bar.percent}%**`);
        continue;
      }

      if (tag === 'svg') {
        flushCaption();
        const summary = summarizeSvgToText(node);
        if (summary) lines.push(`> *Diagrama:* ${summary}`);
        continue;
      }

      if (tag === 'title') {
        const val = extractText(node);
        if (pendingCaption) {
          lines.push(`- **${pendingCaption}:** **${val}**`);
          pendingCaption = null;
        } else if (val) {
          lines.push(`#### ${val}`);
        }
        continue;
      }

      if (tag === 'text') {
        const val = extractText(node);
        const isMuted = node.attrs?.color === 'secondary' || node.attrs?.color === 'muted';
        if (pendingCaption) {
          lines.push(`- **${pendingCaption}:** ${isMuted ? `*${val}*` : val}`);
          pendingCaption = null;
        } else if (val) {
          lines.push(isMuted ? `*${val}*` : val);
        }
        continue;
      }

      if (tag === 'link') {
        flushCaption();
        const label = extractText(node);
        const url = String(node.attrs?.url || '');
        lines.push(/^https?:\/\//i.test(url) ? `[${label || url}](${url})` : label);
        continue;
      }

      if (tag === 'row') {
        flushCaption();
        const rowLines = renderNodeLinesToMarkdown(node.children || []);
        if (rowLines.length) {
          const hasBar = rowLines.some(l => l.includes('█') || l.includes('░'));
          if (hasBar) {
            lines.push(rowLines.map(l => l.replace(/^- /, '')).join(' '));
          } else if (rowLines.length <= 3 && rowLines.every(l => l.length < 70)) {
            lines.push(`- ${rowLines.join(' — ')}`);
          } else {
            lines.push(...rowLines);
          }
        }
        continue;
      }

      if (tag === 'grid') {
        flushCaption();
        const items = (node.children || []).filter(c => c.type === 'element' && (c.tag === 'grid-item' || c.tag === 'card'));
        const cols = Number(node.attrs?.columns) || items.length;
        if (cols >= 2 && items.length >= 2 && items.length <= 4) {
          const parsedCols = items.map((it, idx) => {
            const innerLines = renderNodeLinesToMarkdown(it.children || []);
            const first = innerLines[0] || `Elemento ${idx + 1}`;
            const header = first.replace(/^####\s*/, '').replace(/^\*\*|\*\*$/g, '');
            const rest = innerLines.slice(1).map(l => l.replace(/^- /, '')).join('<br>');
            return { header: header.replace(/\|/g, '\\|'), body: (rest || first).replace(/\|/g, '\\|') };
          });
          lines.push(
            '',
            `| ${parsedCols.map(c => `**${c.header}**`).join(' | ')} |`,
            `| ${parsedCols.map(() => ':---').join(' | ')} |`,
            `| ${parsedCols.map(c => c.body).join(' | ')} |`,
            ''
          );
        } else {
          lines.push(...renderNodeLinesToMarkdown(node.children || []));
        }
        continue;
      }

      if (tag === 'card' || tag === 'grid-item' || tag === 'box' || tag === 'stack' || tag === 'col') {
        flushCaption();
        lines.push(...renderNodeLinesToMarkdown(node.children || []));
        continue;
      }

      flushCaption();
      const fb = extractText(node);
      if (fb) lines.push(fb);
    }

    flushCaption();
    return lines;
  }

  // --- 5. DETECCIÓN DE BLOQUES DIL TOP-LEVEL Y LIMPIEZA GLOBAL ---

  function stripInlineControlTags(text, mode) {
    let out = String(text || '');
    // Eliminar citas internas de ChatGPT y etiquetas de automatización
    out = out.replace(/<Cite\b[^>]*\/>/gi, '');
    out = out.replace(/<SuggestAutomation\b[^>]*\/>/gi, '');
    out = out.replace(/<DisplayAutomation\b[^>]*\/>/gi, '');
    // Limpiar <text color="...">...</text> inline (ej. dentro de tablas Markdown)
    out = out.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (_, rawAttrs, inner) => {
      const clean = inner.trim();
      if (mode === 'html') {
        const attrs = parseAttrs(rawAttrs);
        const colorKey = String(attrs.color || '').toLowerCase();
        const hex = SEMANTIC_COLORS[colorKey];
        return hex ? `<span style="color:${hex};font-weight:600">${escapeHtml(clean)}</span>` : escapeHtml(clean);
      }
      return clean;
    });
    // Limpiar <caption>...</caption> sueltos fuera de tarjetas
    out = out.replace(/<caption\b[^>]*>([\s\S]*?)<\/caption>/gi, (_, inner) => {
      const clean = inner.trim();
      return mode === 'html' ? `<p class="lossy-widget-caption">${renderInlineMdToHtml(clean)}</p>` : `*${clean}*`;
    });
    // Limpiar <Link url=...>...</Link> sueltos
    out = out.replace(/<Link\b([^>]*)>([\s\S]*?)<\/Link>/gi, (_, rawAttrs, inner) => {
      const attrs = parseAttrs(rawAttrs);
      const url = String(attrs.url || '');
      const label = inner.trim();
      if (/^https?:\/\//i.test(url)) {
        return mode === 'html' ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>` : `[${label || url}](${url})`;
      }
      return label;
    });
    out = out.replace(/<divider\s*\/>/gi, mode === 'html' ? '<hr class="lossy-widget-divider">' : '\n---\n');
    return out;
  }

  /**
   * Encuentra bloques DIL balanceados de nivel superior (incluyendo directivas {@body ...} precedentes).
   */
  function findTopLevelWidgetRanges(segment) {
    const ranges = [];
    const openRe = /((?:(?:\{@body\s+[^}]+\}\s*)+)?)<(grid|card|stack|box|row|svg)(?=[\s/>])[^>]*>/gi;
    let match;
    let searchFrom = 0;

    while (searchFrom < segment.length) {
      openRe.lastIndex = searchFrom;
      match = openRe.exec(segment);
      if (!match) break;

      const startIdx = match.index;
      const tag = match[2].toLowerCase();
      const tagRe = new RegExp(`<(\\/)?${tag}(?=[\\s/>])[^>]*>`, 'gi');
      tagRe.lastIndex = match.index + match[1].length;

      let depth = 0;
      let endIdx = -1;
      let tm;
      while ((tm = tagRe.exec(segment)) !== null) {
        const isSelfClosing = tm[0].endsWith('/>');
        if (tm[1]) {
          depth--;
          if (depth === 0) {
            endIdx = tm.index + tm[0].length;
            break;
          }
        } else if (!isSelfClosing) {
          depth++;
        } else if (depth === 0) {
          endIdx = tm.index + tm[0].length;
          break;
        }
      }

      if (endIdx > startIdx) {
        ranges.push({ start: startIdx, end: endIdx, raw: segment.slice(startIdx, endIdx) });
        searchFrom = endIdx;
      } else {
        searchFrom = match.index + match[0].length;
      }
    }

    return ranges;
  }

  function renderWidgetBlockToHtml(blockSource) {
    const { text, env } = expandDilDirectives(blockSource);
    const ast = parseWidgetAst(text, env);
    if (!ast.children.length) return '';
    return `<div class="lossy-widget-root">${renderAstChildrenToHtml(ast.children)}</div>`;
  }

  function renderWidgetBlockToMarkdown(blockSource) {
    const { text, env } = expandDilDirectives(blockSource);
    const ast = parseWidgetAst(text, env);
    const lines = renderNodeLinesToMarkdown(ast.children);
    return lines.length ? '\n\n' + lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n\n' : '';
  }

  function renderWidgetBlockToPlainText(blockSource) {
    const md = renderWidgetBlockToMarkdown(blockSource);
    return md
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^####\s*/gm, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/<br>/g, '\n');
  }

  function transformSegment(segment, blockRenderer, mode) {
    const ranges = findTopLevelWidgetRanges(segment);
    const cleanNonWidget = chunk => {
      const lines = chunk.split('\n');
      let prevBlank = true;
      let inIndented = false;
      const out = [];
      let plainBuf = [];
      const flushPlain = () => {
        if (!plainBuf.length) return;
        out.push(transformOutsideInlineCode(plainBuf.join('\n'), s => stripInlineControlTags(s, mode)));
        plainBuf = [];
      };
      for (const line of lines) {
        const isBlank = line.trim().length === 0;
        if (inIndented) {
          if (/^(?: {4}|\t)/.test(line) || isBlank) {
            out.push(line);
            prevBlank = isBlank;
            continue;
          }
          inIndented = false;
        }
        if (prevBlank && /^(?: {4}|\t)/.test(line) && !isBlank) {
          flushPlain();
          inIndented = true;
          out.push(line);
          prevBlank = false;
          continue;
        }
        plainBuf.push(line);
        prevBlank = isBlank;
      }
      flushPlain();
      return out.join('\n');
    };
    let rebuilt = '';
    let cursor = 0;
    for (const r of ranges) {
      rebuilt += cleanNonWidget(segment.slice(cursor, r.start));
      rebuilt += blockRenderer(r.raw);
      cursor = r.end;
    }
    rebuilt += cleanNonWidget(segment.slice(cursor));
    return rebuilt;
  }

  function splitFencedCodeSegments(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const segments = [];
    let buf = [];
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let fenceContainers = [];
    let containers = [];

    const flush = isCode => {
      if (buf.length) {
        segments.push({ isCode, text: buf.join('\n') });
        buf = [];
      }
    };
    const matchFenceContainers = (line, fcStack) => {
      let rest = line;
      const hasBq = fcStack.some(c => c.type === 'bq');
      for (const c of fcStack) {
        if (c.type === 'bq') {
          const m = rest.match(/^ {0,3}>[ \t]?/);
          if (!m) return { bqOk: false, rest };
          rest = rest.slice(m[0].length);
        } else {
          const sp = (rest.match(/^ */) || [''])[0].length;
          if (sp >= c.indent) rest = rest.slice(c.indent);
          else if (hasBq && rest.trim().length > 0) return { bqOk: false, rest };
          else rest = rest.slice(sp);
        }
      }
      return { bqOk: true, rest };
    };
    const advanceContainers = line => {
      let rest = line;
      let matched = 0;
      while (matched < containers.length) {
        const c = containers[matched];
        if (c.type === 'bq') {
          const m = rest.match(/^ {0,3}>[ \t]?/);
          if (!m) break;
          rest = rest.slice(m[0].length);
          matched++;
        } else {
          if (rest.trim().length === 0) {
            matched++;
            continue;
          }
          const sp = (rest.match(/^ */) || [''])[0].length;
          if (sp < c.indent) break;
          rest = rest.slice(c.indent);
          matched++;
        }
      }
      containers.length = matched;
      while (rest.trim().length > 0) {
        const bq = rest.match(/^ {0,3}>[ \t]?/);
        if (bq) {
          containers.push({ type: 'bq' });
          rest = rest.slice(bq[0].length);
          continue;
        }
        const lst = rest.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/);
        if (lst) {
          containers.push({ type: 'list', indent: lst[0].length });
          rest = rest.slice(lst[0].length);
          continue;
        }
        break;
      }
      return rest;
    };

    for (const line of lines) {
      if (inFence) {
        const { bqOk, rest } = matchFenceContainers(line, fenceContainers);
        if (!bqOk) {
          flush(true);
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          fenceContainers = [];
        } else {
          buf.push(line);
          const closeM = rest.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
          if (closeM && closeM[1][0] === fenceChar && closeM[1].length >= fenceLen) {
            flush(true);
            inFence = false;
            fenceChar = '';
            fenceLen = 0;
            fenceContainers = [];
          }
          continue;
        }
      }

      const rest = advanceContainers(line);
      const openM = rest.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (openM && !(openM[1][0] === '`' && openM[2].includes('`'))) {
        flush(false);
        inFence = true;
        fenceChar = openM[1][0];
        fenceLen = openM[1].length;
        fenceContainers = containers.map(c => ({ ...c }));
        buf.push(line);
        continue;
      }
      buf.push(line);
    }
    flush(inFence);
    return segments;
  }

  function transformOutsideCodeFences(text, blockRenderer, mode) {
    const input = String(text || '');
    if (!input) return '';
    return splitFencedCodeSegments(input).map(seg => seg.isCode ? seg.text : transformSegment(seg.text, blockRenderer, mode)).join('\n');
  }

  function hasVisualWidgets(text) {
    const input = String(text || '');
    for (const seg of splitFencedCodeSegments(input)) {
      if (!seg.isCode && findTopLevelWidgetRanges(seg.text).length > 0) return true;
    }
    return false;
  }

  function renderWidgetsToMarkdown(text) {
    return transformOutsideCodeFences(text, renderWidgetBlockToMarkdown, 'md');
  }

  function renderWidgetsToPlainText(text) {
    return transformOutsideCodeFences(text, renderWidgetBlockToPlainText, 'txt');
  }

  function renderWidgetsToHtml(text) {
    return transformOutsideCodeFences(text, renderWidgetBlockToHtml, 'html');
  }

  function transformOutsideInlineCode(str, fn) {
    const s = String(str || '');
    let out = '';
    let plainBuf = '';
    let i = 0;
    const isEscaped = idx => {
      let bs = 0;
      for (let k = idx - 1; k >= 0 && s[k] === '\\'; k--) bs++;
      return (bs % 2) === 1;
    };
    while (i < s.length) {
      if (s[i] === '`' && !isEscaped(i)) {
        let ticks = 0;
        while (i + ticks < s.length && s[i + ticks] === '`') ticks++;
        const delim = '`'.repeat(ticks);
        let end = i + ticks;
        let found = -1;
        while (end < s.length) {
          const pos = s.indexOf(delim, end);
          if (pos === -1) break;
          if (s[pos - 1] !== '`' && s[pos + ticks] !== '`') { found = pos; break; }
          end = pos + 1;
        }
        if (found !== -1) {
          if (plainBuf) { out += fn(plainBuf); plainBuf = ''; }
          out += s.slice(i, found + ticks);
          i = found + ticks;
          continue;
        }
        plainBuf += delim;
        i += ticks;
        continue;
      }
      plainBuf += s[i++];
    }
    if (plainBuf) out += fn(plainBuf);
    return out;
  }

  function stripControlTokensOnly(text) {
    const input = String(text || '');
    if (!input) return '';
    return splitFencedCodeSegments(input).map(seg => {
      if (seg.isCode) return seg.text;
      return transformOutsideInlineCode(seg.text, s => s
        .replace(/<Cite\b[^>]*\/>/gi, '')
        .replace(/<SuggestAutomation\b[^>]*\/>/gi, '')
        .replace(/<DisplayAutomation\b[^>]*\/>/gi, ''));
    }).join('\n');
  }

  const WIDGET_PRINT_CSS =
    '.lossy-widget-root{margin:4mm 0;break-inside:avoid}' +
    '.lossy-widget-grid{display:grid;gap:3.5mm;margin:3mm 0;break-inside:avoid}' +
    '.lossy-widget-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}' +
    '.lossy-widget-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}' +
    '.lossy-widget-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}' +
    '.lossy-widget-item,.lossy-widget-stack{display:flex;flex-direction:column;gap:2mm}' +
    '.lossy-widget-flex{flex:1;min-width:0}' +
    '.lossy-widget-card{border:1px solid #d4e0d9;border-radius:3mm;background:#f8fbf9;padding:3.5mm 4mm;display:flex;flex-direction:column;gap:2.4mm;break-inside:avoid}' +
    '.lossy-widget-row{display:flex;align-items:center;gap:2.8mm;flex-wrap:wrap}' +
    '.lossy-widget-spacer{flex:1}' +
    '.lossy-widget-divider{border:0;border-top:1px solid #d4e0d9;margin:2mm 0}' +
    '.lossy-widget-title{font-weight:700;font-size:1.02em;color:#142821}' +
    '.lossy-widget-title.is-lg{font-size:1.2em}' +
    '.lossy-widget-title.is-2xl{font-size:1.5em;line-height:1.15}' +
    '.lossy-widget-kpi{display:flex;flex-direction:column;gap:.8mm}' +
    '.lossy-widget-metric{display:flex;flex-direction:column;gap:1.2mm;width:100%}' +
    '.lossy-widget-bar-head{display:flex;justify-content:space-between;align-items:baseline;font-size:.86em;color:#3d554b}' +
    '.lossy-widget-pct{font-family:Consolas,monospace;font-weight:600;color:#19593e}' +
    '.lossy-widget-track{width:100%;border-radius:999px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.lossy-widget-fill{height:100%;border-radius:999px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.lossy-widget-slider{margin:1mm 0}' +
    '.lossy-widget-svg-wrap{margin:2mm 0;overflow:hidden}' +
    '.lossy-widget-svg{display:block;width:100%;height:auto;max-width:100%;color:#182d27}' +
    '.lossy-widget-favicon{display:inline-grid;place-items:center;width:7mm;height:7mm;border-radius:2mm;background:#e4f1ea;color:#194f3b;font-weight:700;font-size:.82em;flex-shrink:0}' +
    '.lossy-widget-kv{display:flex;flex-direction:column;gap:.6mm}' +
    '.lossy-widget-caption{font-size:.84em;font-weight:600;color:#3d554b}' +
    '.lossy-widget-value,.lossy-widget-note{font-size:.86em;color:#233b32;margin:0}' +
    '.lossy-widget-value.is-muted,.lossy-widget-note.is-muted{color:#6a7f76;font-style:italic}' +
    '.lossy-widget-note.is-strong{font-weight:600}' +
    '.lossy-widget-badge{display:inline-block;padding:.6mm 2mm;border-radius:999px;background:#e4f1ea;color:#1b523d;font-size:.8em;font-weight:600}';

  return {
    hasVisualWidgets,
    expandDilDirectives,
    safeEvalExpr,
    parseWidgetAst,
    findTopLevelWidgetRanges,
    stripControlTokensOnly,
    renderWidgetsToMarkdown,
    renderWidgetsToPlainText,
    renderWidgetsToHtml,
    renderWidgetBlockToHtml,
    WIDGET_PRINT_CSS
  };
});
