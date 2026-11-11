# PL/SQL for Zed

Oracle PL/SQL language support for the [Zed](https://zed.dev) editor:
syntax highlighting, auto-indentation, code outline, bracket matching, Vim
text objects and code navigation (go to definition, find references, hover,
symbol search, completion). Highlighting is powered by a fork of the
[tree-sitter-plsql](https://github.com/andreasmaierde/tree-sitter-plsql)
grammar; navigation by a small bundled language server.

## Features

- **Syntax highlighting** for PL/SQL and embedded SQL: packages, types,
  functions, procedures, triggers, cursors, exceptions, SQL DML/queries,
  `%TYPE` / `%ROWTYPE`, cursor attributes (`%FOUND`, `%ISOPEN`, `%NOTFOUND`,
  `%ROWCOUNT`), collection methods (`.COUNT`, `.FIRST`, …), bind variables
  (`:b1`), named arguments, record fields, labels, strings, numbers and
  comments.
- **Auto-indentation** for `DECLARE`/`BEGIN`/`EXCEPTION`/`END` blocks,
  `IF`/`ELSIF`/`ELSE`, `CASE`/`WHEN` (statements and expressions), `LOOP`
  variants, multi-line cursor queries and subprogram declaration sections,
  with regex fallbacks for incomplete code.
- **Code outline** (`editor: toggle outline`) listing packages, functions,
  procedures, types, subtypes, triggers and cursors, each with its kind
  (`PACKAGE BODY my_pkg`, `FUNCTION get_name`, …).
- **Comment toggling** for `--` line comments and `/* ... */` block comments.
- **Bracket matching** for `()`, double-quoted identifiers, `<<labels>>` and
  keyword pairs (`BEGIN`/`END`, `IF`/`END IF`, `CASE`/`END CASE`,
  `LOOP`/`END LOOP`).
- **Vim text objects**: `af`/`if` (functions and procedures), `ac`/`ic`
  (packages, types, triggers), `gc` (comments).
- **Code navigation** across the project, without a database connection:
  - *Go to definition* (`F12`) for packages, package members, standalone
    subprograms, types, cursors, variables, parameters (also in
    `name => value` arguments), loop variables and tables/views created in
    the project. On a call it opens the body; on a body or a spec it jumps
    to the other one. *Go to declaration* always opens the spec.
  - *Find all references* (`Shift-F12`) and highlighting of the symbol under
    the cursor.
  - *Hover* with the declaration and the comment written above it.
  - *Project symbols* (`project symbols: toggle`) with fuzzy matching.
  - *Completion* of package members after `pkg.`, and of the names visible
    at the cursor.

## File associations

| Extension | Typical use                    |
| --------- | ------------------------------ |
| `.sql`    | SQL / PL/SQL scripts           |
| `.pls`    | PL/SQL source                  |
| `.pks`    | Package specification          |
| `.pkb`    | Package body                   |
| `.pkh`    | Package header                 |
| `.pck`    | Package                        |
| `.fnc`    | Function                       |
| `.prc`    | Procedure                      |
| `.trg`    | Trigger                        |
| `.tps`    | Type specification             |
| `.tpb`    | Type body                      |
| `.typ`    | Type                           |
| `.plb`    | PL/SQL library / wrapped code  |
| `.ddl`    | DDL scripts                    |

The language also activates for Markdown fenced code blocks tagged
<code>```plsql</code> and for `-- vim: ft=plsql` modelines.

## Installation

### From the extension registry

Once published: open **Zed → Extensions**, search for **PL/SQL** and install.

### As a dev extension

1. Clone this repository.
2. In Zed, open the **Extensions** page and click **Install Dev Extension**,
   then select this directory.

Zed compiles the tree-sitter grammar automatically (it downloads the
[wasi-sdk](https://github.com/WebAssembly/wasi-sdk) on first use). Building
the dev extension also needs Rust installed through
[rustup](https://rustup.rs); extensions installed from the registry come
prebuilt.

## Configuration

Sensible defaults are provided (2-space indent, `-- ` line comments,
`/* ... */` block comments). As with any Zed language, you can override them
in your `settings.json`:

```json
{
  "languages": {
    "PL/SQL": {
      "tab_size": 3,
      "hard_tabs": true
    }
  }
}
```

## Known limitations

The grammar does not yet cover the full Oracle language. Constructs known to
produce error nodes:

- Plain SQL DDL and DCL outside PL/SQL: `CREATE TABLE`, `CREATE VIEW`,
  `GRANT`, …
- SQL*Plus commands (`SET SERVEROUTPUT ON`, `PROMPT`, …).
- Analytic functions (`ROW_NUMBER() OVER (PARTITION BY …)`).
- `DATE '2020-01-01'` / `TIMESTAMP '…'` literals and the `MOD` operator.

Keywords, strings and comments are still highlighted inside error nodes;
outline entries and syntax-aware indentation may be missing there.

Indentation is heuristic: it is exact for well-formed blocks, and falls back
to line-based rules while code is incomplete.

Code navigation resolves names by scope and by name only. It knows nothing
about types or the database, so:

- Record fields, object attributes, table columns and built-ins
  (`DBMS_OUTPUT`, `NO_DATA_FOUND`, …) have no definition to go to.
  *Find references* on them matches by name.
- Overloads are not told apart: all of them are offered.
- Only files inside the project are indexed (`.sql`, `.pks`, `.pkb`, … up to
  4 MB each). Objects that exist only in the database are unknown.
- There are no diagnostics, formatting or rename.

## Development

The `languages/plsql/` directory contains the language definition:

| File              | Purpose                             |
| ----------------- | ----------------------------------- |
| `config.toml`     | Language metadata and indent rules  |
| `highlights.scm`  | Syntax highlighting                 |
| `indents.scm`     | Auto-indentation ranges             |
| `outline.scm`     | Code outline / structure            |
| `brackets.scm`    | Bracket matching                    |
| `textobjects.scm` | Vim text objects                    |

The language server is `server/plsql-lsp.js`: one dependency-free JavaScript
file, run with the Node.js that ships with Zed. `src/lib.rs` is the small
Rust shim that starts it. Run its tests with `node --test server/test.js`.

`scripts/validate.sh` checks everything: it parses the samples in `tests/`
with the pinned grammar, compiles every query, replays Zed's auto-indent
rules over the samples and runs the language server tests (requires the
`tree-sitter` CLI, Python 3.11+ and Node.js 20+). See
[AGENTS.md](AGENTS.md) for the details.

## Credits

- Grammar: forked from [andreasmaierde/tree-sitter-plsql](https://github.com/andreasmaierde/tree-sitter-plsql) (MIT).

## License

MIT — see [LICENSE](LICENSE).
