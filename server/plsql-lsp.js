#!/usr/bin/env node
// PL/SQL language server: go to definition, references, hover, symbols and
// completion. Zero dependencies; speaks LSP over stdio.
//
// It does not use the tree-sitter grammar. A tolerant hand-written scanner
// finds declarations and scopes, so files the grammar cannot parse (plain
// DDL, SQL*Plus scripts) are still indexed. Names are resolved by scope and
// by name only: no types, no overload resolution, no database access.
'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const EXTENSIONS = new Set([
  'sql', 'pls', 'pks', 'pkb', 'pkh', 'pck', 'fnc', 'prc', 'trg', 'tps',
  'tpb', 'typ', 'ddl',
]);
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build']);
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_FILES = 50000;
const MAX_FULL_DOCS = 200; // closed files kept tokenized in memory

// ---------------------------------------------------------------- strings

// Substrings keep their parent string alive in V8. Names that outlive a
// document's text are copied once and shared.
const interned = new Map();
function intern(s) {
  let v = interned.get(s);
  if (v === undefined) {
    v = Buffer.from(s, 'utf8').toString('utf8');
    interned.set(v, v);
  }
  return v;
}

// -------------------------------------------------------------- tokenizer

const Q_CLOSE = { '[': ']', '(': ')', '{': '}', '<': '>' };
const PUNCT2 = new Set([':=', '=>', '..', '||', '<<', '>>', '<=', '>=', '<>', '!=', '**']);

function tokenize(text) {
  const tokens = [];
  const comments = [];
  const n = text.length;
  const idRe = /[A-Za-z_$#À-￿][\w$#À-￿]*/y;
  const numRe = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let i = 0;
  let line = 0;
  let ls = 0; // offset of the current line's start

  const newlines = (from, to) => {
    for (let j = from; j < to; j++) {
      if (text.charCodeAt(j) === 10) { line++; ls = j + 1; }
    }
  };
  const push = (t, start, end) => {
    const sl = line;
    const sc = start - ls;
    if (t === 'str') newlines(start, end);
    const tx = text.slice(start, end);
    tokens.push({
      t, text: tx,
      lower: t === 'id' ? tx.toLowerCase() : t === 'qid' ? tx.slice(1, -1).toLowerCase() : tx,
      start, end, line: sl, col: sc, endLine: line, endCol: end - ls,
    });
    i = end;
  };
  const stringEnd = (q) => {
    let j = q + 1;
    for (;;) {
      const k = text.indexOf("'", j);
      if (k < 0) return n;
      if (text[k + 1] === "'") { j = k + 2; continue; }
      return k + 1;
    }
  };
  const qStringEnd = (d) => {
    const close = Q_CLOSE[text[d]] || text[d];
    const e = text.indexOf(close + "'", d + 1);
    return e < 0 ? n : e + 2;
  };

  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; ls = ++i; continue; }
    if (c <= ' ') { i++; continue; }
    const c1 = text[i + 1];
    if (c === '-' && c1 === '-') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      comments.push({ start: i, end: e, line, endLine: line });
      i = e;
      continue;
    }
    if (c === '/' && c1 === '*') {
      let e = text.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      const sl = line;
      newlines(i, e);
      comments.push({ start: i, end: e, line: sl, endLine: line });
      i = e;
      continue;
    }
    if (c === "'") { push('str', i, stringEnd(i)); continue; }
    if (c1 === "'" && (c === 'q' || c === 'Q') && i + 2 < n) { push('str', i, qStringEnd(i + 2)); continue; }
    if (c1 === "'" && (c === 'n' || c === 'N')) { push('str', i, stringEnd(i + 1)); continue; }
    if ((c === 'n' || c === 'N') && (c1 === 'q' || c1 === 'Q') && text[i + 2] === "'" && i + 3 < n) {
      push('str', i, qStringEnd(i + 3));
      continue;
    }
    if (c === '"') {
      const e = text.indexOf('"', i + 1);
      push('qid', i, e < 0 ? n : e + 1);
      continue;
    }
    idRe.lastIndex = i;
    if (idRe.test(text)) {
      const end = idRe.lastIndex;
      // SQL*Plus PROMPT / REM lines are free text (apostrophes included).
      if (end - i <= 6 && text.slice(ls, i).trim() === '') {
        const w = text.slice(i, end).toLowerCase();
        const last = tokens.length ? tokens[tokens.length - 1].text : null;
        const top = last === null || last === '/' || (w === 'prompt' && last === ';');
        if (top && (w === 'prompt' || w === 'rem' || w === 'remark')) {
          let e = text.indexOf('\n', i);
          if (e < 0) e = n;
          if (!/^\s*(:=|\.|\(|;|%)/.test(text.slice(end, e))) {
            comments.push({ start: i, end: e, line, endLine: line });
            i = e;
            continue;
          }
        }
      }
      push('id', i, end);
      continue;
    }
    numRe.lastIndex = i;
    if (numRe.test(text)) { push('num', i, numRe.lastIndex); continue; }
    push('p', i, PUNCT2.has(c + c1) ? i + 2 : i + 1);
  }
  return { tokens, comments };
}

// ----------------------------------------------------------------- parser

const CREATE_MODIFIERS = new Set([
  'or', 'replace', 'editionable', 'noneditionable', 'force', 'no', 'global',
  'private', 'temporary', 'unique', 'bitmap', 'public', 'shared', 'sharded',
  'duplicated', 'immutable', 'blockchain', 'json', 'relational', 'duality',
]);
const SIMPLE_OBJECTS = new Set(['table', 'view', 'sequence', 'synonym', 'index']);
const MEMBER_MODIFIERS = new Set([
  'member', 'static', 'map', 'order', 'constructor', 'overriding', 'final',
  'instantiable', 'not',
]);
const BROKEN_HEADER = new Set(['begin', 'end', 'function', 'procedure', 'create']);

class Parser {
  constructor(doc, tokens) {
    this.doc = doc;
    this.t = tokens;
    this.n = tokens.length;
    this.p = 0;
    this.symbols = [];
    this.root = this.scope('file', null, null, 0);
  }

  // -- helpers
  scope(kind, sym, parent, startIdx) {
    const s = {
      kind, sym, parent, startIdx, endIdx: Math.max(this.n - 1, 0),
      symbols: [], children: [], doc: this.doc,
    };
    if (parent) parent.children.push(s);
    if (sym) sym.body = s;
    return s;
  }
  add(scope, kind, nameIdx, startIdx) {
    const k = this.t[nameIdx];
    const sym = {
      name: intern(k.t === 'qid' ? k.text.slice(1, -1) : k.text),
      lower: intern(k.lower),
      kind, nameIdx, startIdx, endIdx: nameIdx, headerEndIdx: -1,
      scope, body: null, hasBody: false, doc: this.doc,
    };
    scope.symbols.push(sym);
    this.symbols.push(sym);
    return sym;
  }
  is(o, ...words) {
    const k = this.t[this.p + o];
    return !!k && k.t === 'id' && words.includes(k.lower);
  }
  isP(o, s) {
    const k = this.t[this.p + o];
    return !!k && k.t === 'p' && k.text === s;
  }
  isName(i) {
    const k = this.t[i];
    return !!k && (k.t === 'id' || k.t === 'qid');
  }
  // Reads `a.b.c`; returns the index of the last part, or -1.
  readName() {
    if (!this.isName(this.p)) return -1;
    let i = this.p++;
    while (this.isP(0, '.') && this.isName(this.p + 1)) { i = this.p + 1; this.p += 2; }
    return i;
  }
  // Consumes up to and including the next `;` outside parentheses.
  // Returns the index of the last consumed token.
  skipToSemi() {
    let depth = 0;
    while (this.p < this.n) {
      const k = this.t[this.p++];
      if (k.t !== 'p') continue;
      if (k.text === '(') depth++;
      else if (k.text === ')') depth--;
      else if (k.text === ';' && depth <= 0) break;
    }
    return this.p - 1;
  }
  close(sym, scope) {
    const end = Math.max(this.p - 1, sym ? sym.startIdx : 0);
    if (sym) sym.endIdx = end;
    if (scope) scope.endIdx = end;
  }
  // After a consumed END: optional name(s) and `;`.
  endTail() {
    let j = this.p;
    while (j < this.p + 4 && this.isName(j)) j++;
    const k = this.t[j];
    if (k && k.t === 'p' && k.text === ';') this.p = j + 1;
  }

  // -- top level
  parse() {
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t !== 'id') { this.p++; continue; }
      const prev = this.t[this.p - 1];
      const fresh = !prev || (prev.t === 'p' && (prev.text === ';' || prev.text === '/'));
      switch (k.lower) {
        case 'create': this.parseCreate(); break;
        case 'declare': case 'begin': this.parseBlock(this.root); break;
        case 'package': case 'function': case 'procedure': case 'trigger': case 'type':
          if (fresh) this.parseObject(this.p); else this.p++;
          break;
        default: this.p++;
      }
    }
    return this;
  }

  parseCreate() {
    const start = this.p++;
    while (this.is(0, ...CREATE_MODIFIERS)) this.p++;
    this.parseObject(start);
  }

  // At the object keyword (PACKAGE, FUNCTION, ...). `start` is where the
  // statement began (the CREATE token if there was one).
  parseObject(start) {
    const k = this.t[this.p];
    if (!k || k.t !== 'id') return;
    const word = k.lower;
    if (word === 'function' || word === 'procedure') {
      this.parseSubprogram(this.root, start);
    } else if (word === 'package' || word === 'type') {
      this.p++;
      const body = this.is(0, 'body');
      if (body) this.p++;
      const nameIdx = this.readName();
      if (nameIdx < 0) return;
      const sym = this.add(this.root, body ? word + ' body' : word, nameIdx, start);
      const sc = this.scope(sym.kind, sym, this.root, start);
      if (word === 'type' && !body) this.parseTypeSpec(sym, sc);
      else this.parseContainer(sym, sc);
    } else if (word === 'trigger') {
      this.p++;
      const nameIdx = this.readName();
      if (nameIdx < 0) return;
      const sym = this.add(this.root, 'trigger', nameIdx, start);
      this.parseTrigger(sym, this.scope('trigger', sym, this.root, start));
    } else if (word === 'materialized' && this.is(1, 'view')) {
      this.p += 2;
      this.parseSimple('materialized view', start);
    } else if (SIMPLE_OBJECTS.has(word)) {
      this.p++;
      this.parseSimple(word, start);
    } else {
      this.p++;
    }
  }

  parseSimple(kind, start) {
    if (this.is(0, 'if') && this.is(1, 'not') && this.is(2, 'exists')) this.p += 3;
    const nameIdx = this.readName();
    if (nameIdx < 0) return;
    const sym = this.add(this.root, kind, nameIdx, start);
    sym.headerEndIdx = nameIdx;
    this.skipToSemi();
    this.close(sym, null);
  }

  // Package spec/body or type body: IS|AS declarations [BEGIN ...] END.
  parseContainer(sym, sc) {
    while (this.p < this.n && !this.is(0, 'is', 'as')) {
      if (this.isP(0, ';') || this.is(0, 'create', 'begin')) { this.close(sym, sc); return; }
      this.p++;
    }
    sym.headerEndIdx = this.p - 1;
    this.p++;
    sym.hasBody = true;
    this.parseDeclarations(sc, false);
    this.finishBody(sc);
    this.close(sym, sc);
  }

  // After a declaration section: BEGIN statements END, or just END.
  finishBody(sc) {
    if (this.is(0, 'begin')) { this.p++; this.parseStatements(sc, ['begin']); }
    else if (this.is(0, 'end')) { this.p++; this.endTail(); }
  }

  // CREATE TYPE name AS OBJECT ( attrs, MEMBER FUNCTION ..., ... );
  parseTypeSpec(sym, sc) {
    sym.headerEndIdx = sym.nameIdx;
    let depth = 0;
    let cur = null;
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t === 'p') {
        if (k.text === '(') depth++;
        else if (k.text === ')') { depth--; if (depth === 0 && cur) { cur.endIdx = this.p - 1; cur = null; } }
        else if (k.text === ',' && depth === 1 && cur) { cur.endIdx = this.p - 1; cur = null; }
        else if (k.text === ';' && depth <= 0) { this.p++; break; }
      } else if (k.t === 'id' && depth === 1 && (k.lower === 'function' || k.lower === 'procedure') &&
                 this.isName(this.p + 1)) {
        cur = this.add(sc, k.lower, this.p + 1, this.p);
        cur.headerEndIdx = -2; // header runs to the end of the declaration
      }
      this.p++;
    }
    this.close(sym, sc);
  }

  parseTrigger(sym, sc) {
    sym.headerEndIdx = sym.nameIdx;
    let depth = 0;
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t === 'p') {
        if (k.text === '(') depth++;
        else if (k.text === ')') depth--;
        else if (k.text === ';' && depth <= 0) { this.p++; break; }
      } else if (k.t === 'id' && depth <= 0) {
        if (k.lower === 'declare' || k.lower === 'begin') { this.parseBlock(sc); break; }
        if (k.lower === 'compound' && this.is(1, 'trigger')) {
          this.p += 2;
          this.parseDeclarations(sc, true);
          this.finishBody(sc);
          break;
        }
        if (k.lower === 'create') break;
      }
      this.p++;
    }
    this.close(sym, sc);
  }

  // FUNCTION|PROCEDURE name [(params)] ... ; | IS|AS decls BEGIN ... END;
  parseSubprogram(scope, start) {
    const kind = this.t[this.p].lower;
    this.p++;
    const nameIdx = this.readName();
    if (nameIdx < 0) return;
    const sym = this.add(scope, kind, nameIdx, start);
    const sc = this.scope(kind, sym, scope, start);
    if (this.isP(0, '(')) this.parseParams(sc);
    let depth = 0;
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t === 'p') {
        if (k.text === '(') depth++;
        else if (k.text === ')') depth--;
        else if (k.text === ';' && depth <= 0) {
          sym.headerEndIdx = this.p - 1;
          this.p++;
          break;
        }
      } else if (k.t === 'id' && depth <= 0) {
        if (k.lower === 'is' || k.lower === 'as') {
          // constructor: RETURN SELF AS RESULT
          if (k.lower === 'as' && this.is(-1, 'self') && this.is(1, 'result')) { this.p++; continue; }
          sym.headerEndIdx = this.p - 1;
          this.p++;
          if (this.is(0, 'language', 'external')) { this.skipToSemi(); break; }
          sym.hasBody = true;
          this.parseDeclarations(sc, false);
          this.finishBody(sc);
          break;
        }
        if (BROKEN_HEADER.has(k.lower)) { sym.headerEndIdx = this.p - 1; break; }
      }
      this.p++;
    }
    this.close(sym, sc);
  }

  // At `(`. Adds one parameter symbol per top-level comma-separated item.
  parseParams(sc) {
    this.p++;
    let depth = 1;
    let expect = true;
    let cur = null;
    while (this.p < this.n && depth > 0) {
      const k = this.t[this.p];
      if (k.t === 'p') {
        if (k.text === '(') depth++;
        else if (k.text === ')') { depth--; if (depth === 0 && cur) cur.endIdx = this.p - 1; }
        else if (k.text === ',' && depth === 1) { if (cur) cur.endIdx = this.p - 1; cur = null; expect = true; }
        else if (k.text === ';') return;
      } else if (expect && depth === 1 && (k.t === 'id' || k.t === 'qid')) {
        cur = this.add(sc, 'parameter', this.p, this.p);
        expect = false;
      }
      this.p++;
    }
  }

  // Declaration section. Returns at BEGIN / END / EOF without consuming.
  parseDeclarations(scope, compound) {
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t === 'qid') { this.declareVariable(scope); continue; }
      if (k.t !== 'id') { this.p++; continue; }
      const w = k.lower;
      if (w === 'begin' || w === 'end' || w === 'create') return;
      if (w === 'function' || w === 'procedure') { this.parseSubprogram(scope, this.p); continue; }
      if (w === 'pragma') { this.skipToSemi(); continue; }
      if (MEMBER_MODIFIERS.has(w)) { this.p++; continue; }
      if (w[0] === '$') {
        // conditional compilation: skip the directive, keep the declarations
        if (w === '$if' || w === '$elsif') {
          while (this.p < this.n && !this.is(0, '$then')) this.p++;
        } else if (w === '$error') {
          while (this.p < this.n && !this.is(0, '$end')) this.p++;
        }
        this.p++;
        continue;
      }
      if (compound && (w === 'before' || w === 'after' || w === 'instead')) {
        while (this.p < this.n && !this.is(0, 'is', 'begin', 'end')) this.p++;
        if (this.is(0, 'is')) this.p++;
        this.parseDeclarations(scope, false);
        if (this.is(0, 'begin')) { this.p++; this.parseStatements(scope, ['begin']); }
        continue;
      }
      if ((w === 'type' || w === 'subtype') && this.isName(this.p + 1) && this.is(2, 'is')) {
        const sym = this.add(scope, w, this.p + 1, this.p);
        this.skipToSemi();
        this.close(sym, null);
        sym.endIdx--;
        continue;
      }
      if (w === 'cursor' && this.isName(this.p + 1)) {
        const start = this.p++;
        const sym = this.add(scope, 'cursor', this.p, start);
        const sc = this.scope('cursor', sym, scope, start);
        this.p++;
        if (this.isP(0, '(')) this.parseParams(sc);
        sym.headerEndIdx = this.p;
        this.skipToSemi();
        this.close(sym, sc);
        sym.endIdx--;
        continue;
      }
      this.declareVariable(scope);
    }
  }

  declareVariable(scope) {
    const start = this.p++;
    if (this.isP(0, ';') || this.isP(0, '/')) { this.p++; return; }
    const kind = this.is(0, 'exception') ? 'exception' : this.is(0, 'constant') ? 'constant' : 'variable';
    const sym = this.add(scope, kind, start, start);
    this.skipToSemi();
    this.close(sym, null);
    sym.endIdx--;
  }

  // At DECLARE or BEGIN.
  parseBlock(parent) {
    const sc = this.scope('block', null, parent, this.p);
    if (this.is(0, 'declare')) { this.p++; this.parseDeclarations(sc, false); }
    if (this.is(0, 'begin')) { this.p++; this.parseStatements(sc, ['begin']); }
    this.close(null, sc);
  }

  // Statements up to the END that closes `stack[0]`.
  parseStatements(scope, stack) {
    while (this.p < this.n) {
      const k = this.t[this.p];
      if (k.t === 'p') {
        if (k.text === '<<' && this.isName(this.p + 1) && this.isP(2, '>>')) {
          const sym = this.add(scope, 'label', this.p + 1, this.p);
          sym.endIdx = this.p + 2;
          this.p += 3;
        } else {
          this.p++;
        }
        continue;
      }
      if (k.t !== 'id') { this.p++; continue; }
      switch (k.lower) {
        case 'declare': this.parseBlock(scope); break;
        case 'begin': case 'if': case 'case': case 'loop':
          stack.push(k.lower);
          this.p++;
          break;
        case 'for':
          if (this.isName(this.p + 1) && this.is(2, 'in')) this.parseFor(scope);
          else this.p++;
          break;
        case 'forall':
          if (this.isName(this.p + 1) && this.is(2, 'in')) {
            const sc = this.scope('loop', null, scope, this.p);
            this.add(sc, 'loop variable', this.p + 1, this.p + 1);
            this.skipToSemi();
            this.close(null, sc);
          } else {
            this.p++;
          }
          break;
        case 'end': {
          this.p++;
          const top = stack[stack.length - 1];
          if (this.is(0, 'if', 'loop', 'case')) {
            const loop = this.is(0, 'loop');
            this.p++;
            stack.pop();
            if (loop && this.isName(this.p) && this.isP(1, ';')) this.p++;
          } else if (top === 'case') {
            stack.pop(); // CASE expression
          } else {
            stack.pop();
            this.endTail();
            if (stack.length === 0) return;
            break;
          }
          if (stack.length === 0) { if (this.isP(0, ';')) this.p++; return; }
          break;
        }
        case 'create': return; // unterminated block; let the top level resync
        default: this.p++;
      }
    }
  }

  // FOR x IN ... LOOP ... END LOOP;
  parseFor(scope) {
    const sc = this.scope('loop', null, scope, this.p);
    this.add(sc, 'loop variable', this.p + 1, this.p + 1);
    this.p += 3;
    while (this.p < this.n && !this.is(0, 'loop')) {
      if (this.isP(0, ';') || this.is(0, 'end', 'begin', 'create')) { this.close(null, sc); return; }
      this.p++;
    }
    this.p++;
    this.parseStatements(sc, ['loop']);
    this.close(null, sc);
  }
}

// -------------------------------------------------------------- documents

// A document is "full" while it holds text/tokens/comments. Closed files
// are reduced to their symbols and scopes and re-tokenized on demand.
function parseInto(doc, text) {
  const { tokens, comments } = tokenize(text);
  const parser = new Parser(doc, tokens).parse();
  const last = tokens.length - 1;
  doc.declByIdx = new Map();
  doc.words = new Set();
  for (const k of tokens) if (k.t === 'id' || k.t === 'qid') doc.words.add(intern(k.lower));
  for (const s of parser.symbols) {
    const name = tokens[s.nameIdx];
    const a = tokens[s.startIdx];
    const b = tokens[Math.min(Math.max(s.endIdx, s.nameIdx), last)];
    const h = s.headerEndIdx === -2 ? b : s.headerEndIdx >= 0 ? tokens[Math.min(s.headerEndIdx, last)] : null;
    s.sel = range(name.line, name.col, name.endLine, name.endCol);
    s.range = range(a.line, a.col, b.endLine, b.endCol);
    s.startOff = a.start;
    s.endOff = b.end;
    s.headerEndOff = h ? h.end : -1;
    doc.declByIdx.set(s.nameIdx, s);
  }
  doc.root = parser.root;
  doc.symbols = parser.symbols;
  doc.tokenCount = tokens.length;
  doc.text = text;
  doc.tokens = tokens;
  doc.comments = comments;
  doc.byName = null;
}

function range(sl, sc, el, ec) {
  return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}
function tokenRange(k) {
  return range(k.line, k.col, k.endLine, k.endCol);
}
function isName(k) {
  return !!k && (k.t === 'id' || k.t === 'qid');
}
function family(kind) {
  return kind === 'package body' ? 'package' : kind === 'type body' ? 'type' : kind;
}
function isSubprogram(s) {
  return s.kind === 'function' || s.kind === 'procedure';
}
function isImpl(s) {
  return isSubprogram(s) ? s.hasBody : s.kind === 'package body' || s.kind === 'type body';
}
function uniq(list) {
  return list.length < 2 ? list : [...new Set(list)];
}
function normalizeUri(uri) {
  if (!uri.startsWith('file:')) return uri;
  try { return pathToFileURL(fileURLToPath(uri)).href; } catch { return uri; }
}

// -------------------------------------------------------------- workspace

class Workspace {
  constructor() {
    this.docs = new Map();
    this.cache = new Set(); // closed docs currently full, oldest first
    this.dirty = true;
    this.global = new Map();
  }

  // -- document management
  open(uri, text) {
    uri = normalizeUri(uri);
    let doc = this.docs.get(uri);
    if (!doc) { doc = { uri, open: true }; this.docs.set(uri, doc); }
    doc.open = true;
    this.cache.delete(doc);
    parseInto(doc, text);
    this.dirty = true;
    return doc;
  }
  close(uri) {
    uri = normalizeUri(uri);
    const doc = this.docs.get(uri);
    if (!doc) return;
    doc.open = false;
    if (!this.loadFromDisk(uri)) { this.docs.delete(uri); this.dirty = true; }
  }
  // (Re)indexes a file from disk unless the editor owns it.
  loadFromDisk(uri) {
    uri = normalizeUri(uri);
    let doc = this.docs.get(uri);
    if (doc && doc.open) return true;
    const text = readFile(uri);
    if (text === null) {
      if (doc) { this.docs.delete(uri); this.cache.delete(doc); this.dirty = true; }
      return false;
    }
    if (!doc) { doc = { uri, open: false }; this.docs.set(uri, doc); }
    parseInto(doc, text);
    this.strip(doc);
    this.dirty = true;
    return true;
  }
  remove(uri) {
    uri = normalizeUri(uri);
    const doc = this.docs.get(uri);
    if (!doc || doc.open) return;
    this.docs.delete(uri);
    this.cache.delete(doc);
    this.dirty = true;
  }
  strip(doc) {
    doc.text = doc.tokens = doc.comments = doc.byName = null;
    this.cache.delete(doc);
  }
  // Makes sure tokens and text are loaded. False if the file is gone.
  full(doc) {
    if (doc.tokens) return true;
    const text = readFile(doc.uri);
    if (text === null) return false;
    const { tokens, comments } = tokenize(text);
    if (tokens.length !== doc.tokenCount) {
      parseInto(doc, text); // changed on disk behind our back
      this.dirty = true;
    } else {
      doc.text = text;
      doc.tokens = tokens;
      doc.comments = comments;
    }
    this.cache.add(doc);
    return true;
  }
  trim() {
    for (const doc of this.cache) {
      if (this.cache.size <= MAX_FULL_DOCS) break;
      this.strip(doc);
    }
  }
  get(uri) {
    const doc = this.docs.get(normalizeUri(uri));
    return doc && this.full(doc) ? doc : null;
  }

  // -- lookup
  globalLookup(lower) {
    if (this.dirty) {
      this.global = new Map();
      for (const doc of this.docs.values()) {
        for (const s of doc.root.symbols) {
          const list = this.global.get(s.lower);
          if (list) list.push(s); else this.global.set(s.lower, [s]);
        }
      }
      this.dirty = false;
    }
    return this.global.get(lower) || [];
  }

  scopeAt(doc, idx) {
    let s = doc.root;
    outer: for (;;) {
      for (const c of s.children) {
        if (c.startIdx <= idx && idx <= c.endIdx) { s = c; continue outer; }
      }
      return s;
    }
  }

  // Scopes whose symbols can be reached as `sym.member`.
  memberScopes(sym) {
    const fam = family(sym.kind);
    if ((fam === 'package' || fam === 'type') && sym.scope.kind === 'file') {
      return this.globalLookup(sym.lower)
        .filter((s) => family(s.kind) === fam && s.body)
        .map((s) => s.body);
    }
    if (sym.body) return this.counterparts(sym).filter((s) => s.body).map((s) => s.body);
    return [];
  }

  // The same entity declared elsewhere: spec and body, forward declaration
  // and definition, overloads.
  counterparts(sym) {
    const scope = sym.scope;
    if (scope.kind === 'file') {
      const fam = family(sym.kind);
      return this.globalLookup(sym.lower).filter((s) => family(s.kind) === fam);
    }
    const owner = scope.sym;
    if (owner && owner.scope.kind === 'file' && owner.body === scope) {
      const out = [];
      for (const sc of this.memberScopes(owner)) {
        for (const s of sc.symbols) if (s.lower === sym.lower && s.kind === sym.kind) out.push(s);
      }
      return out.includes(sym) ? out : out.concat(sym);
    }
    return scope.symbols.filter((s) => s.lower === sym.lower && s.kind === sym.kind);
  }

  // True for symbols visible outside their file.
  isShared(sym) {
    const scope = sym.scope;
    if (scope.kind === 'file') return true;
    const owner = scope.sym;
    if (!owner) return false;
    if (owner.scope.kind === 'file' && owner.body === scope && owner.kind !== 'trigger' &&
        !isSubprogram(owner)) return true;
    return sym.kind === 'parameter' && this.isShared(owner); // named arguments
  }

  lookup(scope, lower) {
    for (let s = scope; s.parent; s = s.parent) {
      let found = s.symbols.filter((x) => x.lower === lower);
      const owner = s.sym;
      if (owner && (owner.kind === 'package body' || owner.kind === 'type body')) {
        for (const sc of this.memberScopes(owner)) {
          if (sc !== s) found = found.concat(sc.symbols.filter((x) => x.lower === lower));
        }
      }
      if (found.length) return found;
    }
    return this.globalLookup(lower);
  }

  // Symbols the identifier token at `idx` refers to.
  resolve(doc, idx, guard = 0) {
    const t = doc.tokens;
    const k = t[idx];
    if (!isName(k)) return [];
    const decl = doc.declByIdx.get(idx);
    if (decl) return [decl];
    const isP = (i, s) => t[i] && t[i].t === 'p' && t[i].text === s;
    if (isP(idx - 1, '%') || isP(idx - 1, '@')) return [];
    const parts = [idx];
    for (let i = idx; isP(i - 1, '.') && isName(t[i - 2]);) { i -= 2; parts.unshift(i); }
    if (isP(parts[0] - 1, ':')) return []; // bind variable, :new.col
    if (parts.length === 1) {
      if (isP(idx + 1, '=>')) return guard < 3 ? this.namedArgument(doc, idx, guard + 1) : [];
      return this.lookup(this.scopeAt(doc, idx), k.lower);
    }
    const names = parts.map((i) => t[i].lower);
    const walk = (syms, from) => {
      for (let j = from; j < names.length && syms.length; j++) {
        const next = [];
        for (const s of syms) {
          for (const sc of this.memberScopes(s)) {
            for (const m of sc.symbols) if (m.lower === names[j]) next.push(m);
          }
        }
        syms = next;
      }
      return uniq(syms);
    };
    const first = this.lookup(this.scopeAt(doc, parts[0]), names[0]);
    if (first.length) return walk(first, 1);
    return walk(this.globalLookup(names[1]), 2); // schema.object[.member]
  }

  // `name => value`: the parameter of the subprogram being called.
  namedArgument(doc, idx, guard) {
    const t = doc.tokens;
    let depth = 0;
    for (let j = idx - 1; j >= 0 && j > idx - 500; j--) {
      const k = t[j];
      if (k.t !== 'p') continue;
      if (k.text === ';') break;
      if (k.text === ')') depth++;
      else if (k.text === '(') {
        if (depth > 0) { depth--; continue; }
        const out = [];
        for (const callee of this.resolve(doc, j - 1, guard)) {
          for (const c of this.counterparts(callee)) {
            if (!c.body) continue;
            for (const s of c.body.symbols) {
              if (s.kind === 'parameter' && s.lower === t[idx].lower) out.push(s);
            }
          }
        }
        return uniq(out);
      }
    }
    return [];
  }

  tokenAt(doc, pos) {
    const t = doc.tokens;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) { // first token starting after pos
      const mid = (lo + hi) >> 1;
      const k = t[mid];
      if (k.line < pos.line || (k.line === pos.line && k.col <= pos.character)) lo = mid + 1;
      else hi = mid;
    }
    const contains = (i) => {
      const k = t[i];
      if (!k) return false;
      const after = k.line < pos.line || (k.line === pos.line && k.col <= pos.character);
      const before = k.endLine > pos.line || (k.endLine === pos.line && k.endCol >= pos.character);
      return after && before;
    };
    // The cursor may sit right after a word: prefer a name over punctuation.
    if (contains(lo - 1) && isName(t[lo - 1])) return lo - 1;
    if (contains(lo - 2) && isName(t[lo - 2])) return lo - 2;
    return contains(lo - 1) ? lo - 1 : -1;
  }

  location(sym) {
    return { uri: sym.doc.uri, range: sym.sel };
  }

  // -- features
  definition(uri, pos, mode) {
    const doc = this.get(uri);
    if (!doc) return [];
    const idx = this.tokenAt(doc, pos);
    const found = this.resolve(doc, idx);
    if (!found.length) return [];
    const group = uniq(found.concat(...found.map((s) => this.counterparts(s))));
    const self = doc.declByIdx.get(idx);
    let out;
    if (mode === 'declaration') out = group.filter((s) => !isImpl(s));
    else if (mode === 'implementation') out = group.filter(isImpl);
    else if (self) out = group.filter((s) => s !== self && isImpl(s) !== isImpl(self));
    else if (group.some(isSubprogram)) out = group.filter(isImpl);
    else out = group.filter((s) => !isImpl(s));
    if (!out.length) out = self ? [self] : group;
    return out.map((s) => this.location(s));
  }

  // Occurrences as { doc, idx } pairs.
  occurrences(doc, idx, sameFileOnly) {
    const k = doc.tokens[idx];
    if (!isName(k)) return [];
    const found = this.resolve(doc, idx);
    const group = new Set(found.concat(...found.map((s) => this.counterparts(s))));
    const shared = !found.length || found.some((s) => this.isShared(s));
    const docs = sameFileOnly || !shared ? [doc] : [...this.docs.values()];
    const out = [];
    for (const d of docs) {
      if (!d.words.has(k.lower) || !this.full(d)) continue;
      for (const i of this.indexByName(d, k.lower)) {
        const r = this.resolve(d, i);
        // Unresolved names (tables, columns, built-ins) match by name.
        if (found.length ? r.some((s) => group.has(s)) : !r.length) out.push({ doc: d, idx: i });
      }
    }
    return out;
  }

  indexByName(doc, lower) {
    if (!doc.byName) {
      doc.byName = new Map();
      doc.tokens.forEach((k, i) => {
        if (k.t !== 'id' && k.t !== 'qid') return;
        const list = doc.byName.get(k.lower);
        if (list) list.push(i); else doc.byName.set(k.lower, [i]);
      });
    }
    return doc.byName.get(lower) || [];
  }

  references(uri, pos, includeDeclaration) {
    const doc = this.get(uri);
    if (!doc) return [];
    return this.occurrences(doc, this.tokenAt(doc, pos), false)
      .filter((o) => includeDeclaration || !o.doc.declByIdx.has(o.idx))
      .map((o) => ({ uri: o.doc.uri, range: tokenRange(o.doc.tokens[o.idx]) }));
  }

  highlights(uri, pos) {
    const doc = this.get(uri);
    if (!doc) return [];
    return this.occurrences(doc, this.tokenAt(doc, pos), true)
      .map((o) => ({ range: tokenRange(doc.tokens[o.idx]), kind: 1 }));
  }

  container(sym) {
    const owner = sym.scope.sym;
    return owner ? owner.name : '';
  }

  signature(sym) {
    const doc = sym.doc;
    if (!this.full(doc)) return `${sym.kind} ${sym.name}`;
    const fam = family(sym.kind);
    if (fam === 'package' || fam === 'type' && sym.scope.kind === 'file' || sym.kind === 'trigger' ||
        sym.headerEndOff < 0 && sym.scope.kind === 'file') {
      return `${sym.kind} ${sym.name}`;
    }
    const end = sym.headerEndOff >= 0 ? sym.headerEndOff : sym.endOff;
    const lineStart = doc.text.lastIndexOf('\n', sym.startOff) + 1;
    const indent = doc.text.slice(lineStart, sym.startOff);
    let lines = doc.text.slice(sym.startOff, end).split(/\r?\n/);
    if (/^\s*$/.test(indent)) {
      lines = lines.map((l, i) => (i && l.startsWith(indent) ? l.slice(indent.length) : l));
    }
    if (lines.length > 25) lines = lines.slice(0, 25).concat('...');
    let text = lines.join('\n');
    if (sym.kind === 'parameter' || sym.kind === 'loop variable') text = `(${sym.kind}) ${text}`;
    return text;
  }

  // Comment block that ends on the line right above the declaration.
  docComment(sym) {
    const doc = sym.doc;
    if (!this.full(doc)) return '';
    const cs = doc.comments;
    let line = sym.range.start.line;
    const picked = [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (c.start > sym.startOff) continue;
      if (c.endLine !== line - 1) break;
      const before = doc.text.slice(doc.text.lastIndexOf('\n', c.start) + 1, c.start);
      if (before.trim() !== '') break; // trailing comment of a code line
      picked.unshift(doc.text.slice(c.start, c.end));
      line = c.line;
    }
    return picked.join('\n')
      .replace(/^\s*\/\*+|\*+\/\s*$/g, '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(--+|\*)\s?/, '').trim())
      .join('\n')
      .trim();
  }

  hover(uri, pos) {
    const doc = this.get(uri);
    if (!doc) return null;
    const idx = this.tokenAt(doc, pos);
    const found = this.resolve(doc, idx);
    if (!found.length) return null;
    // Prefer declarations (spec) for the text; they carry the comments.
    const group = uniq(found.concat(...found.map((s) => this.counterparts(s))));
    const spec = group.filter((s) => !isImpl(s));
    const seen = new Set();
    const blocks = [];
    for (const s of spec.length ? spec : group) {
      const sig = this.signature(s);
      const key = sig.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const where = this.container(s);
      let md = '```plsql\n' + sig + '\n```';
      const comment = this.docComment(s) ||
        group.map((c) => (c === s ? '' : this.docComment(c))).find(Boolean) || '';
      if (comment) md += '\n\n' + comment;
      md += `\n\n*${s.kind}${where ? ' in `' + where + '`' : ''}*`;
      blocks.push(md);
      if (blocks.length === 5) break;
    }
    return {
      contents: { kind: 'markdown', value: blocks.join('\n\n---\n\n') },
      range: tokenRange(doc.tokens[idx]),
    };
  }

  documentSymbols(uri) {
    const doc = this.get(uri);
    if (!doc) return [];
    const build = (scope) => scope.symbols
      .filter((s) => s.kind !== 'parameter' && s.kind !== 'loop variable' && s.kind !== 'label')
      .map((s) => ({
        name: s.name,
        detail: s.kind,
        kind: SYMBOL_KIND[s.kind] || 13,
        range: s.range,
        selectionRange: s.sel,
        children: s.body ? build(s.body) : [],
      }));
    return build(doc.root);
  }

  workspaceSymbols(query) {
    const q = query.toLowerCase();
    const matches = (name) => {
      let j = 0;
      for (let i = 0; i < name.length && j < q.length; i++) if (name[i] === q[j]) j++;
      return j === q.length;
    };
    const out = [];
    const take = (s) => {
      if (out.length >= 500 || !matches(s.lower)) return;
      // A declaration whose definition is also indexed is noise.
      if (isSubprogram(s) && !s.hasBody && this.counterparts(s).some((c) => c.hasBody)) return;
      out.push({
        name: s.name,
        kind: SYMBOL_KIND[s.kind] || 13,
        location: { uri: s.doc.uri, range: s.sel },
        containerName: this.container(s) || s.kind,
      });
    };
    for (const doc of this.docs.values()) {
      for (const s of doc.root.symbols) {
        take(s);
        const fam = family(s.kind);
        if (s.body && (fam === 'package' || fam === 'type')) s.body.symbols.forEach(take);
      }
    }
    return out;
  }

  completion(uri, pos) {
    const doc = this.get(uri);
    if (!doc) return [];
    const t = doc.tokens;
    // Last token that starts before the cursor.
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const k = t[mid];
      if (k.line < pos.line || (k.line === pos.line && k.col < pos.character)) lo = mid + 1;
      else hi = mid;
    }
    let i = lo - 1;
    if (i < 0) return [];
    if (t[i].t === 'str' || t[i].t === 'num') return [];
    const touching = t[i].endLine === pos.line && t[i].endCol >= pos.character;
    if (isName(t[i]) && touching) i--; // the word being typed
    const items = new Map();
    const addAll = (syms) => {
      for (const s of syms) {
        if (s.kind === 'label' || items.has(s.lower)) continue;
        items.set(s.lower, {
          label: s.name,
          kind: COMPLETION_KIND[s.kind] || 6,
          detail: s.kind + (this.container(s) ? ` in ${this.container(s)}` : ''),
        });
      }
    };
    if (i >= 0 && t[i].t === 'p' && t[i].text === '.') {
      if (!isName(t[i - 1])) return [];
      for (const s of this.resolve(doc, i - 1)) {
        for (const sc of this.memberScopes(s)) addAll(sc.symbols.filter((m) => m.kind !== 'parameter'));
      }
      return [...items.values()];
    }
    const at = Math.max(i, 0);
    for (let s = this.scopeAt(doc, at); s.parent; s = s.parent) {
      addAll(s.symbols);
      const owner = s.sym;
      if (owner && (owner.kind === 'package body' || owner.kind === 'type body')) {
        for (const sc of this.memberScopes(owner)) addAll(sc.symbols);
      }
    }
    this.globalLookup(''); // make sure the index is fresh
    for (const list of this.global.values()) addAll(list);
    return [...items.values()];
  }
}

// LSP SymbolKind / CompletionItemKind
const SYMBOL_KIND = {
  package: 4, 'package body': 4, function: 12, procedure: 12, trigger: 24,
  type: 23, 'type body': 23, subtype: 23, cursor: 13, variable: 13,
  constant: 14, exception: 24, table: 23, view: 23, 'materialized view': 23,
  sequence: 13, synonym: 13, index: 13,
};
const COMPLETION_KIND = {
  package: 9, 'package body': 9, function: 3, procedure: 3, trigger: 23,
  type: 22, 'type body': 22, subtype: 22, cursor: 6, variable: 6,
  constant: 21, exception: 23, parameter: 6, 'loop variable': 6, table: 22,
  view: 22, 'materialized view': 22, sequence: 6, synonym: 6, index: 6,
};

function readFile(uri) {
  if (!uri.startsWith('file:')) return null;
  try {
    const file = fileURLToPath(uri);
    if (fs.statSync(file).size > MAX_FILE_SIZE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isSource(file) {
  return EXTENSIONS.has(path.extname(file).slice(1).toLowerCase());
}

function listSources(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) listSources(full, out); }
    else if (e.isFile() && isSource(e.name)) out.push(full);
  }
}

// ----------------------------------------------------------------- server

function serve() {
  const ws = new Workspace();
  let roots = [];
  let canWatch = false;
  let nextId = 1;
  let shutdown = false;

  const send = (msg) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  };
  const log = (message) => send({ method: 'window/logMessage', params: { type: 3, message } });

  const indexWorkspace = () => {
    const files = [];
    for (const r of roots) listSources(r, files);
    const started = Date.now();
    let i = 0;
    const step = () => {
      const until = Date.now() + 40;
      while (i < files.length && Date.now() < until) ws.loadFromDisk(pathToFileURL(files[i++]).href);
      if (i < files.length) setImmediate(step);
      else log(`plsql-lsp: indexed ${files.length} files in ${Date.now() - started} ms`);
    };
    step();
  };

  const requests = {
    initialize(params) {
      const folders = params.workspaceFolders || [];
      const uris = folders.length ? folders.map((f) => f.uri) : params.rootUri ? [params.rootUri] : [];
      roots = uris.filter((u) => u.startsWith('file:')).map((u) => fileURLToPath(u));
      const w = params.capabilities && params.capabilities.workspace;
      canWatch = !!(w && w.didChangeWatchedFiles && w.didChangeWatchedFiles.dynamicRegistration);
      return {
        capabilities: {
          textDocumentSync: { openClose: true, change: 1, save: true },
          definitionProvider: true,
          declarationProvider: true,
          implementationProvider: true,
          referencesProvider: true,
          documentHighlightProvider: true,
          hoverProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          completionProvider: { triggerCharacters: ['.'] },
        },
        serverInfo: { name: 'plsql-lsp', version: '0.1.0' },
      };
    },
    shutdown() { shutdown = true; return null; },
    'textDocument/definition': (p) => ws.definition(p.textDocument.uri, p.position, 'definition'),
    'textDocument/declaration': (p) => ws.definition(p.textDocument.uri, p.position, 'declaration'),
    'textDocument/implementation': (p) => ws.definition(p.textDocument.uri, p.position, 'implementation'),
    'textDocument/references': (p) =>
      ws.references(p.textDocument.uri, p.position, !p.context || p.context.includeDeclaration !== false),
    'textDocument/documentHighlight': (p) => ws.highlights(p.textDocument.uri, p.position),
    'textDocument/hover': (p) => ws.hover(p.textDocument.uri, p.position),
    'textDocument/documentSymbol': (p) => ws.documentSymbols(p.textDocument.uri),
    'workspace/symbol': (p) => ws.workspaceSymbols(p.query || ''),
    'textDocument/completion': (p) => ws.completion(p.textDocument.uri, p.position),
  };

  const notifications = {
    initialized() {
      if (canWatch) {
        const glob = `**/*.{${[...EXTENSIONS].join(',')}}`;
        send({
          id: `reg-${nextId++}`,
          method: 'client/registerCapability',
          params: {
            registrations: [{
              id: 'plsql-watch',
              method: 'workspace/didChangeWatchedFiles',
              registerOptions: { watchers: [{ globPattern: glob }] },
            }],
          },
        });
      }
      indexWorkspace();
    },
    exit() { process.exit(shutdown ? 0 : 1); },
    'textDocument/didOpen': (p) => ws.open(p.textDocument.uri, p.textDocument.text),
    'textDocument/didChange': (p) => {
      const last = p.contentChanges[p.contentChanges.length - 1];
      if (last && typeof last.text === 'string') ws.open(p.textDocument.uri, last.text);
    },
    'textDocument/didClose': (p) => ws.close(p.textDocument.uri),
    'textDocument/didSave': () => {},
    'workspace/didChangeWatchedFiles': (p) => {
      for (const c of p.changes || []) {
        if (c.type === 3) ws.remove(c.uri);
        else ws.loadFromDisk(c.uri);
      }
    },
  };

  const handle = (msg) => {
    if (msg.method === undefined) return; // a response to one of our requests
    if (msg.id === undefined) {
      const fn = notifications[msg.method];
      if (fn) { try { fn(msg.params || {}); } catch (e) { log(`plsql-lsp: ${msg.method}: ${e.stack}`); } }
      return;
    }
    const fn = requests[msg.method];
    if (!fn) {
      send({ id: msg.id, error: { code: -32601, message: `Unhandled method ${msg.method}` } });
      return;
    }
    try {
      const result = fn(msg.params || {});
      send({ id: msg.id, result: result === undefined ? null : result });
    } catch (e) {
      send({ id: msg.id, error: { code: -32603, message: String(e && e.stack || e) } });
    }
    ws.trim();
  };

  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    for (;;) {
      const head = buffer.indexOf('\r\n\r\n');
      if (head < 0) return;
      const m = /content-length: *(\d+)/i.exec(buffer.toString('ascii', 0, head));
      if (!m) { buffer = buffer.subarray(head + 4); continue; }
      const end = head + 4 + Number(m[1]);
      if (buffer.length < end) return;
      const body = buffer.toString('utf8', head + 4, end);
      buffer = buffer.subarray(end);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(shutdown ? 0 : 1));
}

if (require.main === module) serve();
else module.exports = { Workspace, tokenize };
