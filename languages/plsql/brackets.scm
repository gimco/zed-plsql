("(" @open ")" @close)

(label "<<" @open ">>" @close)

; Keyword pairs: jump between a block opener and its END.
(body (kw_begin) @open (end_obj_named) @close)
(plsql_block (kw_begin) @open (end_obj_named) @close)
(if_statement (kw_if) @open (end_if) @close)
(case_statement (kw_case) @open (kw_end) @close)
(for_loop_statement (kw_loop) @open (kw_end) @close)
(while_loop_statement (kw_loop) @open (kw_end) @close)
(basic_loop_statement (kw_loop) @open (kw_end) @close)
