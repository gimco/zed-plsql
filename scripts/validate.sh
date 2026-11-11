#!/usr/bin/env bash
# Validate the queries against the grammar pinned in extension.toml.
#
#   scripts/validate.sh
#
# Requires git, python3 (>= 3.11), a C compiler and the tree-sitter CLI
# (tested with 0.27). A `file://` grammar is used in place; a remote one is
# cloned into .cache/.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
queries="$root/languages/plsql"

repo="$(sed -n '/^\[grammars\.plsql\]/,$ s/^repository = "\(.*\)"/\1/p' "$root/extension.toml")"
rev="$(sed -n 's/^rev = "\(.*\)"/\1/p' "$root/extension.toml")"

case "$repo" in
  file://*)
    # Local grammar: validate against its working tree, and make sure Zed
    # (which checks out `rev`) will see the same thing.
    grammar="${repo#file://}"
    if [ "$(git -C "$grammar" rev-parse HEAD)" != "$rev" ]; then
      echo "WARNING: extension.toml rev is not the grammar's HEAD ($(git -C "$grammar" rev-parse --short HEAD))"
    fi
    if [ -n "$(git -C "$grammar" status --porcelain --untracked-files=no)" ]; then
      echo "WARNING: grammar has uncommitted changes; Zed only sees committed ones"
    fi
    if [ "$grammar/grammar.js" -nt "$grammar/src/parser.c" ]; then
      echo "WARNING: grammar.js is newer than src/parser.c; run 'tree-sitter generate --abi 14'"
    fi
    ;;
  *)
    grammar="$root/.cache/tree-sitter-plsql"
    if [ ! -d "$grammar/.git" ]; then
      git clone --quiet "$repo" "$grammar"
    fi
    if [ "$(git -C "$grammar" rev-parse HEAD)" != "$rev" ]; then
      git -C "$grammar" remote set-url origin "$repo"
      git -C "$grammar" fetch --quiet origin
      git -C "$grammar" checkout --quiet "$rev"
    fi
    ;;
esac

# tree-sitter picks up (and compiles on demand) the grammar in the current
# directory.
cd "$grammar"

status=0
samples=("$root"/tests/*.sql)

# 1. Samples must parse cleanly (they avoid the known upstream gaps).
for sample in "${samples[@]}"; do
  errors="$(tree-sitter parse "$sample" 2>/dev/null | grep -E '^ *\((ERROR|MISSING)' || true)"
  if [ -n "$errors" ]; then
    echo "FAIL parse: $sample has ERROR/MISSING nodes"
    echo "$errors" | head -n 3
    status=1
  fi
done

# 2. Every query must compile and run.
for query in "$queries"/*.scm; do
  if ! out="$(tree-sitter query "$query" "${samples[@]}" 2>&1 >/dev/null)"; then
    echo "FAIL query: $query"
    echo "$out" | grep -v -i 'warning\|init-config\|configuration\|grammars' | sed '/^$/d'
    status=1
  fi
done

# 3. Replaying Zed's auto-indent must reproduce the samples' indentation.
if ! tree-sitter query "$queries/indents.scm" "${samples[@]}" 2>/dev/null |
  python3 "$root/scripts/check_indent.py" "$queries/config.toml"; then
  echo "FAIL indent"
  status=1
fi

# 4. Language server tests.
if command -v node >/dev/null; then
  if ! out="$(node --test "$root/server/test.js" 2>&1)"; then
    echo "FAIL server tests"
    echo "$out" | grep -A 12 '^✖ failing tests' | head -n 40
    status=1
  fi
else
  echo "warning: node not found, language server tests skipped"
fi

[ "$status" -eq 0 ] && echo "OK: ${#samples[@]} samples, $(ls "$queries"/*.scm | wc -l) queries"
exit "$status"
