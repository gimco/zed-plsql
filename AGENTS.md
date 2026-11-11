# AGENTS.md

Oracle PL/SQL language extension for the Zed editor. Two independent parts:

- **Language definition** — pure data (`languages/plsql/`). Zed compiles the
  tree-sitter grammar when the extension installs.
- **Language server** — `server/plsql-lsp.js`, started by a tiny Rust shim
  (`src/lib.rs`). See "Language server" below.

The grammar is a third-party repository pinned in `extension.toml` (see
"The grammar" below).

## Repo layout

```
extension.toml                  # manifest + pinned tree-sitter grammar (rev)
languages/plsql/
  config.toml                   # language metadata, comment toggles, indent regexes
  highlights.scm                # syntax highlighting
  indents.scm                   # auto-indent ranges (@indent/@start/@end)
  outline.scm                   # code outline (@name/@item)
  brackets.scm                  # bracket matching (@open/@close)
  textobjects.scm               # Vim text objects (af/if, ac/ic, gc)
server/
  plsql-lsp.js                  # language server (single file, no dependencies)
  test.js                       # its tests: node --test server/test.js
src/lib.rs  Cargo.toml          # Rust shim: writes out and launches the server
scripts/
  validate.sh                   # run all checks (grammar, queries, indent, server)
  check_indent.py               # replays Zed's suggest_autoindents
tests/*.sql                     # samples: must parse cleanly and keep their indent
LICENSE  README.md
```

## The grammar

https://github.com/kalmykov-evgeny/tree-sitter-plsql (MIT), pinned by commit
in `extension.toml`. It is a fork of andreasmaierde/tree-sitter-plsql with
much wider SQL coverage and an external scanner for keywords. Bump `rev`
deliberately, never to a branch name, and re-run `scripts/validate.sh`:
node names do change between revisions.

Things to know about it:

- `src/parser.c` is ~42 MB (about 46,000 parse states). Zed needs around a
  minute to compile it and the resulting wasm is ~12 MB.
- Its README warns that the parser misbehaves above ~48,000 states, so
  there is little room for grammar changes. Prefer reporting gaps upstream.
- The tree-sitter CLI caches the compiled parser by language name in
  `~/.cache/tree-sitter/lib/plsql.so`. When switching between two checkouts
  of a `plsql` grammar, delete that file or results come from the wrong one.

`/home/gimco/Projects/tree-sitter-plsql` is a local clone with both lines of
work: branch `main` (our earlier fixes on top of andreasmaierde) and branch
`kalmykov` (this grammar). To develop the grammar locally again, point
`extension.toml` at it with a `file://` URL; `validate.sh` then uses that
working tree in place and warns when `rev`, the working tree and
`src/parser.c` are out of step. Zed only ever sees committed revisions, and
a `file://` URL cannot be published.

## Validating changes

Run `scripts/validate.sh` after every query or `config.toml` change. It
locates the grammar from `extension.toml` (a `file://` grammar is used in
place; a remote one is cloned into `.cache/` at the pinned rev) and then
checks that:

1. every `tests/*.sql` sample parses without ERROR/MISSING nodes,
2. every `.scm` query compiles and runs against the samples,
3. replaying Zed's auto-indent (`scripts/check_indent.py`) reproduces each
   sample's own indentation on every non-blank row,
4. the language server tests pass (`node --test server/test.js`).

When you fix or add behaviour, add the case to a sample in `tests/` first
and watch it fail. Samples must avoid the grammar gaps listed below; a row
whose indent is a deliberate style exception can end in `-- indent-ignore`.

To look at raw captures or the tree, run the CLI from the grammar directory
(it picks up the grammar there; tested with tree-sitter 0.27):

```bash
cd ../tree-sitter-plsql
tree-sitter parse ../zed-plsql/tests/block.sql
tree-sitter query ../zed-plsql/languages/plsql/highlights.scm ../zed-plsql/tests/block.sql --captures
```

A query with an impossible pattern (e.g. `(function_declaration (body)`)
because that node has no `body` child) fails with "Impossible pattern" —
cross-check node shape against `src/node-types.json` in the grammar.

## Grammar facts (tree-sitter-plsql)

- **Every keyword is its own node** (`kw_select`, `kw_begin`, …). There is no
  generic "keyword" node, so `highlights.scm` lists them in groups. Node names
  come from `src/node-types.json`; regenerate groups from there when the
  grammar changes. The generator drops keywords no rule references, so a
  grammar change can both add and remove `kw_*` nodes.
- Keywords are matched as whole words (`word` plus an external scanner):
  `end_date` or `loop_count` are plain identifiers. A few built-ins are
  keywords of their own (`kw_raise_application_error`, `kw_row_number`,
  `kw_sum`, …); `highlights.scm` captures them as `@function.builtin`.
- Anonymous tokens (operators, `(`, `;`, `"`) are matched as string literals:
  `":=" @operator`.
- Named identifier fields worth targeting: `fnc_name`, `prc_name`,
  `package_name`, `type_name`, `trigger_name`, `subtype_name`,
  `type_rec_name`, `type_collection_name`, `ref_cursor_name`,
  `ref_name_parent`, `ref_name`, `table_name`, `view_name`, `column_name`,
  `constraint_name`, `schema_name`.
- `body` exists only on definitions (`function_definition`,
  `procedure_definition`, `create_function`, …). Declarations
  (`function_declaration`, `procedure_declaration`) have **no** `body`.
- Subprogram declarations live between `kw_is`/`kw_as` and `body`;
  package/type bodies between `kw_is`/`kw_as` and `end_obj_named`.
- `exception_block` holds `kw_exception` + `exception_handler`s; the handler
  bodies follow `kw_then` inside `exception_handler`.

### Known grammar gaps (expect ERROR nodes)

- DCL and less common DDL (`GRANT`, `REVOKE`, `COMMENT ON`).
- SQL*Plus commands (`SET SERVEROUTPUT ON`, `PROMPT`).
- `RETURN t%ROWTYPE` in cursor / `REF CURSOR` declarations (a plain type
  name works).
- `ALTER ... COMPILE` with some option combinations.
- `LISTAGG(DISTINCT ...)`, `@dblink` (deliberate upstream).

Quoted identifiers are a single token (no separate `"` nodes), loop/EXIT
labels have no field (match them positionally), and `plsql_block` ends in
`end_obj_named` like `body`.

## Query conventions

- **Later patterns win.** Put generic captures first
  (`(identifier) @variable`), specific ones after (declarations, calls).
  Zed stacks captures and resolves from the end of the stack.
- Use standard capture names (`@keyword`, `@function`, `@type`, `@string`,
  `@number`, `@comment`, `@operator`, `@boolean`, `@constant.builtin`,
  `@property`, `@variable.parameter`, `@label`, `@punctuation.*`). Dotted
  names fall back to their prefix in themes (`@type.builtin` → `@type`).
- Fallback chains are rightmost-first: `(node) @type @namespace` tries
  `@namespace`, then `@type`.
- `textobjects.scm` / `outline.scm`: only match child patterns that exist in
  `node-types.json` (see "Impossible pattern" above).

## Indentation rules (read before touching indents.scm or the regexes)

Zed combines syntax ranges (`indents.scm`) with line regexes
(`config.toml`); the resolution order is in
`crates/language/src/buffer.rs` (`suggest_autoindents`), effectively:

1. regex outdent + syntax indent → keep previous row's indent
2. syntax range starts at previous row (or regex increase) → indent
3. syntax range just ended → align with that range's start row
4. regex decrease → outdent one level
5. otherwise → keep previous row's indent

Invariants this project relies on — do not regress them:

- `increase_indent_pattern` must **not** fire on `END LOOP` / `END CASE`
  (that is why `loop` only counts on lines starting with `for`/`while`,
  or a bare `loop`).
- `decrease_indent_pattern` must **not** contain `when` or `begin`: both
  lines already get a correct syntax-based indent, and a regex outdent
  triggers rule 1 above and flattens them (handler `WHEN`s must be one
  level below `EXCEPTION`, nested `BEGIN` one level below its `LOOP`).
- Zed compiles these regexes with Rust's `regex` crate: **no lookahead or
  lookbehind** (`(?!…)`, `(?<=…)` blow up at load time).
- Zed merges `@indent` ranges that share a start point and keeps the
  furthest end. Several patterns with the same `@start` therefore collapse
  into one long range. That is harmless for `IF` (the `elsif`/`else`
  regex does the outdent) but not for `CASE`: `when` cannot be in the
  regex, so the THEN ranges in `indents.scm` are anchored (`.`) to end at
  the *next* `WHEN`/`ELSE`/`END`. Keep those anchors, and keep comments in
  the anchored alternation (extras break `.` adjacency).
- Loop ranges start at `LOOP`, not at `FOR`/`WHILE`: a range only indents
  the row right after the row it starts on, and headers can span lines.
- Indent style target (2 spaces, Oracle-docs-like):

  ```sql
  PROCEDURE p IS
    v NUMBER;
  BEGIN
    IF x THEN
      NULL;
    ELSE
      NULL;
    END IF;
  EXCEPTION
    WHEN others THEN
      NULL;
  END p;
  ```

  `BEGIN`/`ELSE`/`ELSIF`/`EXCEPTION`/`END` align with their opener;
  `WHEN` sits one level below `EXCEPTION`; `CASE` bodies one level below
  their `WHEN`.

- `scripts/check_indent.py` re-verifies all of this: it rebuilds the
  `@indent` ranges from `indents.scm` and replays `suggest_autoindents`'s
  rules per row. It models a fully parsed file; indentation while typing
  incomplete code is only covered by the regexes.

## Language server (`server/plsql-lsp.js`)

Provides definition / declaration / implementation, references, document
highlight, hover, document and workspace symbols, and completion.

- **One file, zero dependencies, CommonJS.** `src/lib.rs` embeds it with
  `include_str!`, writes it to the extension work directory and runs it with
  `zed::node_binary_path()`. Do not add npm dependencies or split the file:
  there is no install step. After editing it, the dev extension must be
  rebuilt in Zed (the file is baked into `extension.wasm`).
- **It does not use the tree-sitter grammar.** A tolerant hand-written
  scanner (`tokenize` + `Parser`) finds declarations and scopes, so files the
  grammar cannot parse are still indexed. Grammar fixes and server fixes are
  unrelated.
- `Parser` builds a scope tree (`file` → package/type body → subprogram →
  `DECLARE` block / `FOR` loop). Every parse loop must always advance
  `this.p`; on broken code a rule returns early at `CREATE`/`BEGIN`/`END`
  and lets the caller resync rather than swallowing the rest of the file.
- Names are case-insensitive (`lower`). Resolution (`Workspace.resolve`)
  walks scopes outwards, then the global index of top-level objects. A
  package body also sees its spec. `a.b` looks `b` up in the member scopes of
  `a`; an unknown first part is treated as a schema name. There is no type
  information: record fields, columns and built-ins resolve to nothing.
- `counterparts(sym)` groups spec and body, forward declaration and
  definition, and overloads. Definition and references work on that group.
- Closed files keep only symbols and scopes; tokens and text are dropped
  (`strip`) and re-read on demand (`full`). Anything stored on a symbol must
  go through `intern()` so it does not pin the file's text in memory.
- Positions are UTF-16 code units, which is what JavaScript string indices
  are; do not convert.
- Add a test to `server/test.js` for every behaviour change. The `at()`
  helper locates a position by the text around it.
- To try a modified server without rebuilding the extension, point Zed at
  it: `"lsp": {"plsql-lsp": {"binary": {"path": "node", "arguments":
  ["/abs/path/server/plsql-lsp.js"]}}}`.

Server logs: `dev: open language server logs` in Zed.

## Releasing

Zed publishing prerequisites (enforced in review):

- Extension id kebab-case, no `zed`/`extension` in it (`plsql` is fine).
- README and all user-facing text in English.
- `LICENSE` present (MIT) and consistent with `extension.toml` authors.
- Rust code only for the language-server shim (`src/lib.rs`); keep it
  minimal. `zed_extension_api` must be a version the targeted Zed supports.
- Grammar pinned to a commit SHA of a **public** repository (no `file://`),
  extension tested in Zed at that commit.

Remember to fill in real `authors` / `repository` in `extension.toml` and the
copyright line in `LICENSE` before publishing.
