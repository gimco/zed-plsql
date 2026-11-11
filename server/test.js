// Tests for plsql-lsp.js. Run with: node --test server/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { Workspace, tokenize } = require('./plsql-lsp.js');

const SPEC = `create or replace package emp_api as
  -- Maximum salary allowed.
  c_max constant number := 1000;
  type t_ids is table of number;

  /* Returns the display name
     of an employee. */
  function get_name(p_id in number, p_upper boolean default false) return varchar2;
  procedure raise_salary(p_id number, p_amount number);
  procedure raise_salary(p_name varchar2, p_amount number);
end emp_api;
/
`;

const BODY = `create or replace package body emp_api as
  g_calls number := 0;

  function helper(p_id number) return number;

  function get_name(p_id in number, p_upper boolean default false) return varchar2 is
    l_name varchar2(100);
    cursor c_emp(cp_id number) is
      select name from employees where id = cp_id;
  begin
    g_calls := g_calls + helper(p_id);
    for r in c_emp(p_id) loop
      l_name := r.name;
    end loop;
    if p_upper then
      l_name := upper(l_name);
    end if;
    return case when l_name is null then 'x' else l_name end;
  exception
    when no_data_found then
      return null;
  end get_name;

  procedure raise_salary(p_id number, p_amount number) is
  begin
    if p_amount > c_max then
      raise_application_error(-20001, 'too much; really');
    end if;
    <<retry>>
    declare
      l_name varchar2(10) := get_name(p_id => p_id);
    begin
      update employees set salary = salary + p_amount where id = p_id;
      dbms_output.put_line(l_name || q'[it's done]');
    end;
  end raise_salary;

  procedure raise_salary(p_name varchar2, p_amount number) is
  begin
    null;
  end;

  function helper(p_id number) return number is
  begin
    return p_id;
  end helper;
end emp_api;
/
`;

const CLIENT = `create table employees (
  id number primary key,
  name varchar2(100)
);

create or replace procedure report(p_id number) is
  l_ids emp_api.t_ids;
begin
  dbms_output.put_line(emp_api.get_name(p_id, p_upper => true));
  scott.emp_api.raise_salary(p_id, emp_api.c_max);
  for i in 1 .. 3 loop
    report(i);
  end loop;
end report;
/

prompt it's a SQL*Plus line
begin
  report(1);
end;
/
`;

const URIS = { spec: 'file:///ws/emp_api.pks', body: 'file:///ws/emp_api.pkb', client: 'file:///ws/client.sql' };
const TEXTS = { spec: SPEC, body: BODY, client: CLIENT };

function workspace() {
  const ws = new Workspace();
  for (const k of Object.keys(URIS)) ws.open(URIS[k], TEXTS[k]);
  return ws;
}

// Position of the `nth` (1-based) occurrence of `needle` in a file,
// `offset` characters into the match.
function at(file, needle, nth = 1, offset = 0) {
  const text = TEXTS[file];
  let i = -1;
  for (let k = 0; k < nth; k++) {
    i = text.indexOf(needle, i + 1);
    assert.notEqual(i, -1, `"${needle}" #${nth} not found in ${file}`);
  }
  const before = text.slice(0, i + offset);
  const line = before.split('\n').length - 1;
  return { line, character: before.length - before.lastIndexOf('\n') - 1 };
}

// "file:line" (1-based) of each location, sorted.
function where(locations) {
  const name = (uri) => Object.keys(URIS).find((k) => URIS[k] === uri) || uri;
  return locations.map((l) => `${name(l.uri)}:${l.range.start.line + 1}`).sort();
}

function lineOf(file, needle, nth = 1) {
  return `${file}:${at(file, needle, nth).line + 1}`;
}

test('tokenizer handles strings, q-quotes, comments and prompt lines', () => {
  const { tokens, comments } = tokenize(`a := 'it''s'; -- c1\nb := q'[x'y]'; /* c2\n */\nprompt don't\n"Q" := n'z';`);
  assert.deepEqual(tokens.map((t) => t.text),
    ['a', ':=', "'it''s'", ';', 'b', ':=', "q'[x'y]'", ';', '"Q"', ':=', "n'z'", ';']);
  assert.equal(comments.length, 3);
  assert.equal(tokens[8].lower, 'q');
  assert.equal(tokens[8].line, 4);
});

test('definition: qualified call goes to the body, declaration to the spec', () => {
  const ws = workspace();
  const pos = at('client', 'emp_api.get_name', 1, 9);
  assert.deepEqual(where(ws.definition(URIS.client, pos, 'definition')),
    [lineOf('body', 'function get_name')]);
  assert.deepEqual(where(ws.definition(URIS.client, pos, 'declaration')),
    [lineOf('spec', 'function get_name')]);
});

test('definition: package name goes to the spec', () => {
  const ws = workspace();
  assert.deepEqual(where(ws.definition(URIS.client, at('client', 'emp_api.get_name'), 'definition')),
    [lineOf('spec', 'package emp_api')]);
});

test('definition: schema-qualified names and overloads', () => {
  const ws = workspace();
  const pos = at('client', 'scott.emp_api.raise_salary', 1, 15);
  assert.deepEqual(where(ws.definition(URIS.client, pos, 'definition')),
    [lineOf('body', 'procedure raise_salary', 1), lineOf('body', 'procedure raise_salary', 2)]);
});

test('definition: spec and body jump to each other', () => {
  const ws = workspace();
  assert.deepEqual(
    where(ws.definition(URIS.spec, at('spec', 'function get_name', 1, 10), 'definition')),
    [lineOf('body', 'function get_name')]);
  assert.deepEqual(
    where(ws.definition(URIS.body, at('body', 'function get_name', 1, 10), 'definition')),
    [lineOf('spec', 'function get_name')]);
  // forward declaration <-> definition inside the body
  assert.deepEqual(
    where(ws.definition(URIS.body, at('body', 'helper(p_id)'), 'definition')),
    [lineOf('body', 'function helper', 2)]);
});

test('definition: locals, parameters, cursors, loop variables, spec members', () => {
  const ws = workspace();
  const def = (needle, nth, offset) => where(ws.definition(URIS.body, at('body', needle, nth, offset), 'definition'));
  assert.deepEqual(def('l_name := r.name'), [lineOf('body', 'l_name varchar2(100)')]);
  assert.deepEqual(def('r.name'), [lineOf('body', 'for r in')]);
  assert.deepEqual(def('c_emp(p_id)'), [lineOf('body', 'cursor c_emp')]);
  assert.deepEqual(def('= cp_id', 1, 2), [lineOf('body', 'cursor c_emp')]);
  assert.deepEqual(def('if p_upper'  , 1, 3), [lineOf('body', 'function get_name')]);
  assert.deepEqual(def('g_calls + helper'), [lineOf('body', 'g_calls number')]);
  assert.deepEqual(def('> c_max', 1, 2), [lineOf('spec', 'c_max constant')]);
  // inner block shadows nothing here: l_name of the DECLARE block
  assert.deepEqual(def('put_line(l_name', 1, 9), [lineOf('body', 'l_name varchar2(10)')]);
  // record fields, columns and built-ins do not resolve
  assert.deepEqual(def('r.name', 1, 2), []);
  assert.deepEqual(def('no_data_found'), []);
});

test('definition: named argument resolves to the parameter', () => {
  const ws = workspace();
  assert.deepEqual(
    where(ws.definition(URIS.client, at('client', 'p_upper =>'), 'declaration')),
    [lineOf('body', 'function get_name'), lineOf('spec', 'function get_name')].sort());
  // `p_id => p_id`: left is get_name's parameter, right is the local one
  assert.deepEqual(
    where(ws.definition(URIS.body, at('body', 'p_id => p_id', 1, 8), 'definition')),
    [lineOf('body', 'procedure raise_salary')]);
});

test('definition: types and tables', () => {
  const ws = workspace();
  assert.deepEqual(where(ws.definition(URIS.client, at('client', 'emp_api.t_ids', 1, 8), 'definition')),
    [lineOf('spec', 'type t_ids')]);
  assert.deepEqual(where(ws.definition(URIS.body, at('body', 'from employees', 1, 5), 'definition')),
    [lineOf('client', 'create table employees')]);
});

test('references: package function across files', () => {
  const ws = workspace();
  const refs = where(ws.references(URIS.spec, at('spec', 'function get_name', 1, 10), true));
  assert.deepEqual(refs, [
    lineOf('body', 'function get_name'),
    lineOf('body', 'end get_name'),
    lineOf('body', 'get_name(p_id => p_id)'),
    lineOf('client', 'emp_api.get_name'),
    lineOf('spec', 'function get_name'),
  ].sort());
  const uses = where(ws.references(URIS.spec, at('spec', 'function get_name', 1, 10), false));
  assert.equal(uses.length, 3);
});

test('references: locals stay in their scope', () => {
  const ws = workspace();
  // l_name of get_name: declaration + 5 uses, none from the DECLARE block
  const refs = ws.references(URIS.body, at('body', 'l_name varchar2(100)'), true);
  assert.equal(refs.length, 6);
  const inner = ws.references(URIS.body, at('body', 'l_name varchar2(10)'), true);
  assert.equal(inner.length, 2);
});

test('references: standalone procedure, including recursion and the END name', () => {
  const ws = workspace();
  const refs = ws.references(URIS.client, at('client', 'procedure report', 1, 11), true);
  assert.equal(refs.length, 4);
});

test('references: unresolved names match by name', () => {
  const ws = workspace();
  const refs = where(ws.references(URIS.body, at('body', 'dbms_output'), true));
  assert.deepEqual(refs, [lineOf('body', 'dbms_output'), lineOf('client', 'dbms_output')].sort());
});

test('hover shows the signature and the doc comment', () => {
  const ws = workspace();
  const h = ws.hover(URIS.client, at('client', 'emp_api.get_name', 1, 9)).contents.value;
  assert.match(h, /function get_name\(p_id in number, p_upper boolean default false\) return varchar2/);
  assert.match(h, /Returns the display name\nof an employee\./);
  assert.match(h, /\*function in `emp_api`\*/);
  const c = ws.hover(URIS.body, at('body', '> c_max', 1, 2)).contents.value;
  assert.match(c, /c_max constant number := 1000/);
  assert.match(c, /Maximum salary allowed\./);
  assert.equal(ws.hover(URIS.body, at('body', 'no_data_found')), null);
});

test('document symbols are nested', () => {
  const ws = workspace();
  const [pkg] = ws.documentSymbols(URIS.body);
  assert.equal(pkg.name, 'emp_api');
  assert.deepEqual(pkg.children.map((c) => c.name),
    ['g_calls', 'helper', 'get_name', 'raise_salary', 'raise_salary', 'helper']);
  const getName = pkg.children[2];
  assert.deepEqual(getName.children.map((c) => c.name), ['l_name', 'c_emp']);
  assert.deepEqual(ws.documentSymbols(URIS.client).map((s) => `${s.detail} ${s.name}`),
    ['table employees', 'procedure report']);
});

test('workspace symbols: fuzzy, definitions preferred over declarations', () => {
  const ws = workspace();
  const names = ws.workspaceSymbols('gtnm').map((s) => `${s.containerName}.${s.name}`);
  assert.deepEqual(names, ['emp_api.get_name']);
  assert.ok(ws.workspaceSymbols('').length > 8);
});

test('completion: package members after a dot, scope otherwise', () => {
  const ws = workspace();
  const dot = ws.completion(URIS.client, at('client', 'emp_api.c_max', 1, 8)).map((i) => i.label).sort();
  assert.deepEqual(dot, ['c_max', 'g_calls', 'get_name', 'helper', 'raise_salary', 't_ids']);
  const scoped = ws.completion(URIS.body, at('body', 'l_name := upper', 1, 3)).map((i) => i.label);
  for (const want of ['l_name', 'c_emp', 'p_id', 'p_upper', 'g_calls', 'c_max', 'emp_api', 'report', 'employees']) {
    assert.ok(scoped.includes(want), `missing ${want}`);
  }
  assert.ok(!scoped.includes('r'), 'loop variable out of scope');
});

test('parser survives the constructs in tests/*.sql', () => {
  const dir = path.join(__dirname, '..', 'tests');
  const ws = new Workspace();
  const expected = {
    'package_body.sql': 'package body',
    'package_spec.sql': 'package',
    'trigger.sql': 'trigger',
    'object_type.sql': 'type',
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const uri = pathToFileURL(path.join(dir, f)).href;
    const doc = ws.open(uri, fs.readFileSync(path.join(dir, f), 'utf8'));
    // every scope must be closed inside the file and nested in its parent
    const check = (s) => {
      assert.ok(s.startIdx <= s.endIdx || doc.tokens.length === 0, `${f}: empty scope`);
      for (const c of s.children) {
        assert.ok(c.startIdx >= s.startIdx && c.endIdx <= s.endIdx, `${f}: scope escapes its parent`);
        check(c);
      }
    };
    check(doc.root);
    if (expected[f]) {
      assert.ok(doc.root.symbols.some((s) => s.kind === expected[f]), `${f}: no ${expected[f]}`);
    }
    // nothing after a top-level object may be swallowed by it
    const tops = doc.root.symbols;
    for (let i = 1; i < tops.length; i++) {
      assert.ok(tops[i - 1].endIdx < tops[i].startIdx, `${f}: ${tops[i - 1].name} swallows ${tops[i].name}`);
    }
  }
});

test('closed files are indexed from disk and re-read on demand', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'plsql-lsp-'));
  try {
    const uris = {};
    for (const k of Object.keys(TEXTS)) {
      const file = path.join(dir, path.basename(URIS[k]));
      fs.writeFileSync(file, TEXTS[k]);
      uris[k] = pathToFileURL(file).href;
    }
    const ws = new Workspace();
    for (const k of Object.keys(uris)) ws.loadFromDisk(uris[k]);
    assert.equal(ws.docs.get(uris.body).tokens, null);
    const refs = ws.references(uris.client, at('client', 'emp_api.get_name', 1, 9), true);
    assert.equal(refs.length, 5);
    // an edit in the editor wins over the disk content
    ws.open(uris.spec, SPEC.replace('get_name', 'get_title'));
    const declaration = () =>
      ws.definition(uris.client, at('client', 'emp_api.get_name', 1, 9), 'declaration')[0].uri;
    assert.equal(declaration(), uris.body); // no declaration left: falls back to the body
    ws.close(uris.spec);
    assert.equal(declaration(), uris.spec);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('speaks LSP over stdio', async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'plsql-lsp-'));
  const child = spawn(process.execPath, [path.join(__dirname, 'plsql-lsp.js'), '--stdio']);
  try {
    for (const k of Object.keys(TEXTS)) fs.writeFileSync(path.join(dir, path.basename(URIS[k])), TEXTS[k]);
    const client = pathToFileURL(path.join(dir, 'client.sql')).href;
    const pending = new Map();
    const logs = [];
    let buf = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const head = buf.indexOf('\r\n\r\n');
        if (head < 0) return;
        const len = Number(/Content-Length: (\d+)/.exec(buf.toString('ascii', 0, head))[1]);
        if (buf.length < head + 4 + len) return;
        const msg = JSON.parse(buf.toString('utf8', head + 4, head + 4 + len));
        buf = buf.subarray(head + 4 + len);
        if (msg.method === 'window/logMessage') logs.push(msg.params.message);
        else if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      }
    });
    const write = (msg) => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }));
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    };
    let id = 0;
    const request = (method, params) => new Promise((resolve) => {
      pending.set(++id, resolve);
      write({ id, method, params });
    });

    const init = await request('initialize', { rootUri: pathToFileURL(dir).href, capabilities: {} });
    assert.equal(init.result.capabilities.definitionProvider, true);
    write({ method: 'initialized', params: {} });
    while (!logs.some((l) => l.includes('indexed 3 files'))) await new Promise((r) => setTimeout(r, 10));

    write({ method: 'textDocument/didOpen', params: { textDocument: { uri: client, text: CLIENT } } });
    const def = await request('textDocument/definition', {
      textDocument: { uri: client }, position: at('client', 'emp_api.get_name', 1, 9),
    });
    assert.equal(def.result.length, 1);
    assert.ok(def.result[0].uri.endsWith('/emp_api.pkb'));
    const unknown = await request('textDocument/formatting', {});
    assert.equal(unknown.error.code, -32601);
    assert.equal((await request('shutdown')).result, null);
    write({ method: 'exit' });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
