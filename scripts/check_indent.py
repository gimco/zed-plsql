#!/usr/bin/env python3
"""Replay Zed's auto-indent rules over PL/SQL files.

Reads the output of `tree-sitter query languages/plsql/indents.scm FILE...`
on stdin, rebuilds the @indent ranges the way Zed does, then applies the
rules of `suggest_autoindents` (crates/language/src/buffer.rs) row by row.
The suggested indent must equal the file's own indent on every non-blank
row; mismatches are printed and the exit code is 1.

A row can opt out with a trailing `-- indent-ignore` comment.

Usage: tree-sitter query indents.scm a.sql b.sql | check_indent.py config.toml
"""
import re
import sys
import tomllib

CAPTURE = re.compile(
    r"capture: (?:\d+ - )?(\w+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)"
)


def parse_matches(stream):
    """Yield (path, [match]) where a match is a list of (name, start, end)."""
    path, matches = None, []
    for line in stream:
        line = line.rstrip("\n")
        if not line.startswith(" "):
            if path is not None:
                yield path, matches
            path, matches = line, []
        elif line.lstrip().startswith("pattern:"):
            matches.append([])
        else:
            m = CAPTURE.search(line)
            if m and matches:
                name, sr, sc, er, ec = m.groups()
                matches[-1].append((name, (int(sr), int(sc)), (int(er), int(ec))))
    if path is not None:
        yield path, matches


def indent_ranges(matches):
    """Same merging as Zed: ranges sharing a start keep the furthest end."""
    ranges = {}
    for captures in matches:
        start = end = None
        for name, node_start, node_end in captures:
            if name == "indent":
                start = start or node_start
                end = end or node_end
            elif name == "start":
                start = node_end
            elif name == "end":
                end = node_start
        if start is None or end is None or start[0] == end[0]:
            continue
        ranges[start] = max(ranges.get(start, end), end)
    return sorted(ranges.items())


def check(path, matches, increase, decrease, tab_size):
    lines = open(path, encoding="utf-8").read().split("\n")
    ranges = indent_ranges(matches)
    indent_of = lambda row: len(lines[row]) - len(lines[row].lstrip(" "))
    failures = 0
    prev_row = None
    for row, line in enumerate(lines):
        if not line.strip():
            continue
        if prev_row is None:
            prev_row = row
            continue
        row_start = (row, indent_of(row))
        prev_start = (prev_row, indent_of(prev_row))

        outdent_from_prev = bool(decrease and decrease.search(line))
        indent_from_prev = bool(increase and increase.search(lines[prev_row]))
        outdent_to_row = None
        for start, end in ranges:
            if start[0] >= row:
                break
            if start[0] == prev_row and end > row_start:
                indent_from_prev = True
            if prev_start < end <= row_start:
                if outdent_to_row is None or start[0] < outdent_to_row:
                    outdent_to_row = start[0]

        if outdent_to_row == prev_row or (outdent_from_prev and indent_from_prev):
            expected = indent_of(prev_row)
        elif indent_from_prev:
            expected = indent_of(prev_row) + tab_size
        elif outdent_to_row is not None and outdent_to_row < prev_row:
            expected = indent_of(outdent_to_row)
        elif outdent_from_prev:
            expected = max(indent_of(prev_row) - tab_size, 0)
        else:
            expected = indent_of(prev_row)

        if expected != indent_of(row) and "indent-ignore" not in line:
            failures += 1
            print(f"{path}:{row + 1}: indent {indent_of(row)}, Zed suggests {expected}: {line.strip()}")
        prev_row = row
    return failures


def main():
    with open(sys.argv[1], "rb") as f:
        config = tomllib.load(f)
    compile_ = lambda key: re.compile(config[key]) if key in config else None
    increase = compile_("increase_indent_pattern")
    decrease = compile_("decrease_indent_pattern")
    failures = sum(
        check(path, matches, increase, decrease, config.get("tab_size", 4))
        for path, matches in parse_matches(sys.stdin)
    )
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
