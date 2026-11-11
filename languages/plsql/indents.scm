; Auto-indentation ranges.
;
; Each @indent range runs from the captured node's start to its end,
; unless @start / @end move the boundaries. When a range ends, the closing
; line is aligned with the line where the range started.

; ---------------------------------------------------------------------------
; Brackets
; ---------------------------------------------------------------------------

(_
  "("
  ")" @end) @indent

; ---------------------------------------------------------------------------
; Subprogram headers: IS/AS ... declarations ... BEGIN
; ---------------------------------------------------------------------------

(function_definition
  [(kw_is) (kw_as)] @start
  (body) @end) @indent

(procedure_definition
  [(kw_is) (kw_as)] @start
  (body) @end) @indent

(create_function
  [(kw_is) (kw_as)] @start
  (body) @end) @indent

(create_procedure
  [(kw_is) (kw_as)] @start
  (body) @end) @indent

; ---------------------------------------------------------------------------
; Package / type specs and bodies: IS/AS ... declarations ... END
; ---------------------------------------------------------------------------

(create_package
  [(kw_is) (kw_as)] @start
  (end_obj_named) @end) @indent

(create_package_body
  [(kw_is) (kw_as)] @start
  (end_obj_named) @end) @indent

(create_type_body
  [(kw_is) (kw_as)] @start
  (end_obj_named) @end) @indent

; ---------------------------------------------------------------------------
; PL/SQL blocks: DECLARE ... BEGIN ... [EXCEPTION ...] END
; ---------------------------------------------------------------------------

(plsql_block
  (kw_declare) @start
  (kw_begin) @end) @indent

(plsql_block
  (kw_begin) @start
  (end_obj_named) @end) @indent

(plsql_block
  (kw_begin) @start
  (exception_block) @end) @indent

; BEGIN ... [EXCEPTION ...] END of subprograms
(body
  (kw_begin) @start
  (end_obj_named) @end) @indent

(body
  (kw_begin) @start
  (exception_block) @end) @indent

; EXCEPTION ... handlers
(exception_block
  (kw_exception) @start) @indent

(exception_handler
  (kw_then) @start) @indent

; ---------------------------------------------------------------------------
; IF ... THEN ... [ELSIF ... THEN] [ELSE] ... END IF
; ---------------------------------------------------------------------------

(if_statement
  (kw_then) @start
  (kw_elsif) @end) @indent

(if_statement
  (kw_then) @start
  (kw_else) @end) @indent

(if_statement
  (kw_then) @start
  (end_if) @end) @indent

(if_statement
  (kw_elsif) @start
  (kw_elsif) @end) @indent

(if_statement
  (kw_elsif) @start
  (kw_else) @end) @indent

(if_statement
  (kw_elsif) @start
  (end_if) @end) @indent

(if_statement
  (kw_else) @start
  (end_if) @end) @indent

; ---------------------------------------------------------------------------
; CASE ... WHEN ... THEN ... [ELSE] ... END CASE
; ---------------------------------------------------------------------------

(case_statement
  (kw_case) @start
  (kw_end) @end) @indent

; Each branch body ends at the next WHEN / ELSE / END. The anchors matter:
; Zed merges ranges that share a start and keeps the furthest end, so an
; unanchored pattern would stretch every THEN range to END CASE and later
; WHENs would never outdent.
(case_statement
  (kw_then) @start
  .
  [(statement) (comment_sl) (comment_ml)]+
  .
  [(kw_when) (kw_else) (kw_end)] @end) @indent

; One-line branches (`WHEN x THEN y;` directly followed by `ELSE`): the
; `else` outdent regex would pull ELSE one level left of its WHEN. A range
; starting on that last WHEN row cancels it (regex outdent + syntax indent
; = keep the previous row's indent).
(case_statement
  (kw_when) @start
  .
  (_)
  .
  (kw_then)
  .
  (statement)
  .
  (kw_else)
  (kw_end) @end) @indent

(case_statement
  (kw_else) @start
  (kw_end) @end) @indent

; CASE expressions
(expression_base_case_simple
  (kw_case) @start
  (kw_end) @end) @indent

(expression_base_case_search
  (kw_case) @start
  (kw_end) @end) @indent

; Same one-line-branch fix as for CASE statements.
(expression_base_case_simple
  (kw_when) @start
  .
  (_)
  .
  (kw_then)
  .
  (_)
  .
  (kw_else)
  (kw_end) @end) @indent

(expression_base_case_search
  (kw_when) @start
  .
  (_)
  .
  (kw_then)
  .
  (_)
  .
  (kw_else)
  (kw_end) @end) @indent

; ---------------------------------------------------------------------------
; Loops: FOR/WHILE/LOOP ... END LOOP
; ---------------------------------------------------------------------------

; Start at LOOP rather than at FOR / WHILE so multi-line headers
; (`FOR r IN (` ... `) LOOP`) still indent the loop body.
(for_loop_statement
  (kw_loop) @start
  (kw_end) @end) @indent

(while_loop_statement
  (kw_loop) @start
  (kw_end) @end) @indent

(basic_loop_statement
  (kw_loop) @start
  (kw_end) @end) @indent

; ---------------------------------------------------------------------------
; Cursors: CURSOR c IS <multi-line query>
; ---------------------------------------------------------------------------

(cursor_definition
  (kw_is) @start) @indent

; ---------------------------------------------------------------------------
; FORALL i IN ... <single DML statement on the following lines>
; ---------------------------------------------------------------------------

(forall_statement) @indent
