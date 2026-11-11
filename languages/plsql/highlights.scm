; Syntax highlighting for Oracle PL/SQL.
; Grammar: https://github.com/andreasmaierde/tree-sitter-plsql
;
; Every keyword is its own `kw_*` node in this grammar, so keywords are
; listed explicitly. Later patterns take precedence over earlier ones.

; ---------------------------------------------------------------------------
; Identifiers
; ---------------------------------------------------------------------------

(identifier) @variable

; Quoted identifiers ("My Name") keep their quotes in the string style.
((identifier) @string.special
  (#match? @string.special "^\""))

; ---------------------------------------------------------------------------
; Comments
; ---------------------------------------------------------------------------

[
  (comment_sl)
  (comment_ml)
] @comment

; ---------------------------------------------------------------------------
; Literals
; ---------------------------------------------------------------------------

(literal_string) @string
(number) @number
(float) @number

; ---------------------------------------------------------------------------
; Declarations
; ---------------------------------------------------------------------------

; Functions and procedures
[
  (function_definition fnc_name: (identifier) @function)
  (function_declaration fnc_name: (identifier) @function)
  (element_spec_function_spec fnc_name: (identifier) @function)
  (create_function fnc_name: (identifier) @function)
  (alter_function obj_name: (identifier) @function)
  (procedure_definition prc_name: (identifier) @function)
  (procedure_declaration prc_name: (identifier) @function)
  (element_spec_procedure_spec prc_name: (identifier) @function)
  (create_procedure prc_name: (identifier) @function)
  (alter_procedure obj_name: (identifier) @function)
  (create_trigger trigger_name: (identifier) @function)
  (alter_trigger trigger_name: (identifier) @function)
]

; Constructors in type bodies
(element_spec_constructor_spec name: (identifier) @constructor)

; Packages, types and subtypes
[
  (create_package package_name: (identifier) @type)
  (create_package_body package_name: (identifier) @type)
  (alter_package obj_name: (identifier) @type)
  (plsql_type_source type_name: (identifier) @type)
  (create_type_body type_name: (identifier) @type)
  (alter_type type_name: (identifier) @type)
  (type_definition_record type_rec_name: (identifier) @type)
  (type_definition_collection type_collection_name: (identifier) @type)
  (type_definition_sub subtype_name: (identifier) @type)
  (type_definition_ref_cursor ref_cursor_name: (identifier) @type)
]

; Schema and database link qualifiers
[
  (_ schema_name: (identifier) @type)
]

; Table names and aliases (FROM <table> <alias>, UPDATE <table>, ...)
(table_list_element
  (referenced_element) @type
  alias: (identifier) @type)
(join_clause alias: (identifier) @type)
(sql_statement_delete alias: (identifier) @type)
(sql_statement_update alias: (identifier) @type)

; Qualifier in `parent.name` references (tables, packages, aliases)
(referenced_element ref_name_parent: (identifier) @type)

; Function calls: `f(...)`, `pkg.f(...)`
(ref_call
  (referenced_element ref_name: (identifier) @function))

; User-defined types in declarations: `v t_rec;`, `v emp%ROWTYPE;`
(datatype
  (referenced_element ref_name: (identifier) @type))

; Parameters, including named arguments in calls: `f(p_id => 1)`
[
  (parameter_declaration_element (identifier) @variable.parameter)
  (cursor_declaration_parameter (identifier) @variable.parameter)
  (parameter_name (identifier) @variable.parameter)
]

; Record fields
(field_definition (identifier) @property)

; Variables and constants
(item_declaration (identifier) @variable)
(item_declaration (identifier) @constant (kw_constant))

; Cursors
[
  (cursor_definition (identifier) @variable)
]

; Exceptions: declarations, `WHEN no_data_found THEN`, `RAISE e_custom`
(exception_declaration (identifier) @constant)
(exception_handler
  (referenced_element ref_name: (identifier) @constant))
(raise_statement
  (referenced_element ref_name: (identifier) @constant))

; Trailing names: `END my_proc;`, `END my_pkg;`
(body
  (end_obj_named (identifier) @function))
[
  (create_package (end_obj_named (identifier) @type))
  (create_package_body (end_obj_named (identifier) @type))
  (create_type_body (end_obj_named (identifier) @type))
]

; Bind / host variables: `:new`, `:b1`
[
  (host_variable)
  (indicator_variable)
] @variable.special
(host_variable (identifier) @variable.special)
(indicator_variable (identifier) @variable.special)

; Tables, views, sequences
[
  (create_table table_name: (identifier) @type)
  (create_view view_name: (identifier) @type)
  (create_sequence (referenced_element ref_name: (identifier) @type))
  (_ referenced_table: (identifier) @type)
]
[
  (_ column_name: (identifier) @property)
  (_ referenced_column: (identifier) @property)
]
(_ constraint_name: (identifier) @label)

; PRAGMA names
(pragma_declaration (identifier) @attribute)

; Labels: <<label>>, END LOOP label, EXIT label, CONTINUE label, GOTO label
(label (identifier) @label)
[
  (basic_loop_statement (kw_end) (kw_loop) . (identifier) @label)
  (for_loop_statement (kw_end) (kw_loop) . (identifier) @label)
  (while_loop_statement (kw_end) (kw_loop) . (identifier) @label)
  (exit_statement (kw_exit) . (identifier) @label)
  (continue_statement (kw_continue) . (identifier) @label)
  (goto_statement (identifier) @label)
]

; ---------------------------------------------------------------------------
; Keywords
; ---------------------------------------------------------------------------

[
  (kw_access) (kw_accessible) (kw_add) (kw_after)
  (kw_agent) (kw_aggregate) (kw_all) (kw_allow)
  (kw_alter) (kw_analytic) (kw_analyze) (kw_any)
  (kw_apply) (kw_array) (kw_as) (kw_asc)
  (kw_associate) (kw_at) (kw_attribute) (kw_audit)
  (kw_authid) (kw_autonomous_transaction) (kw_badfile) (kw_batch)
  (kw_before) (kw_begin) (kw_block) (kw_body)
  (kw_both) (kw_breadth) (kw_bulk) (kw_by)
  (kw_byte) (kw_c) (kw_cache) (kw_cascade)
  (kw_case) (kw_charsetfrom) (kw_charsetid) (kw_check)
  (kw_clone) (kw_close) (kw_collation) (kw_collect)
  (kw_columns) (kw_comment) (kw_commit) (kw_commtted)
  (kw_compile) (kw_compound) (kw_connect) (kw_constant)
  (kw_constraint) (kw_constructor) (kw_container) (kw_containers)
  (kw_context) (kw_continue) (kw_convert) (kw_create)
  (kw_cross) (kw_crossedition) (kw_current) (kw_cursor)
  (kw_cycle) (kw_data) (kw_database) (kw_db_role_change)
  (kw_ddl) (kw_debug) (kw_declare) (kw_default)
  (kw_definer) (kw_deleting) (kw_depth) (kw_desc)
  (kw_deterministic) (kw_directory) (kw_disable) (kw_disallow)
  (kw_disassociate) (kw_discardfile) (kw_distinct) (kw_drop)
  (kw_duration) (kw_each) (kw_editionable) (kw_element)
  (kw_else) (kw_elsif) (kw_empty) (kw_enable)
  (kw_end) (kw_error) (kw_errors) (kw_escape)
  (kw_evalname) (kw_except) (kw_exception) (kw_exception_init)
  (kw_exceptions) (kw_execute) (kw_exit) (kw_external)
  (kw_fact) (kw_fetch) (kw_filter) (kw_final)
  (kw_following) (kw_follows) (kw_for) (kw_forall)
  (kw_force) (kw_foreign) (kw_format) (kw_forward)
  (kw_from) (kw_full) (kw_function) (kw_goto)
  (kw_grant) (kw_group) (kw_having) (kw_hierarchies)
  (kw_if) (kw_immediate) (kw_immutable) (kw_in)
  (kw_including) (kw_increment) (kw_index) (kw_indicator)
  (kw_indices) (kw_inline) (kw_inner) (kw_insert)
  (kw_inserting) (kw_instantiable) (kw_instead) (kw_intersect)
  (kw_into) (kw_invalidate) (kw_is) (kw_isolation)
  (kw_java) (kw_join) (kw_json) (kw_keep)
  (kw_key) (kw_language) (kw_lateral) (kw_lax)
  (kw_leading) (kw_left) (kw_length) (kw_level)
  (kw_library) (kw_local) (kw_location) (kw_lock)
  (kw_locked) (kw_log) (kw_logfile) (kw_logging)
  (kw_logoff) (kw_logon) (kw_loop) (kw_map)
  (kw_matched) (kw_maxlen) (kw_maxvalue) (kw_measure)
  (kw_measures) (kw_member) (kw_merge) (kw_metadata)
  (kw_minus) (kw_minvalue) (kw_mode) (kw_modify)
  (kw_multiset) (kw_mutable) (kw_name) (kw_national)
  (kw_nested) (kw_new) (kw_noaudit) (kw_nocache)
  (kw_nocopy) (kw_nocycle) (kw_nologging) (kw_none)
  (kw_noneditionable) (kw_noorder) (kw_nowait) (kw_nulls)
  (kw_object) (kw_of) (kw_offset) (kw_oid)
  (kw_old) (kw_on) (kw_only) (kw_open)
  (kw_option) (kw_order) (kw_ordinality) (kw_others)
  (kw_out) (kw_outer) (kw_over) (kw_overflow)
  (kw_overriding) (kw_package) (kw_pairs) (kw_parallel_enable)
  (kw_parameters) (kw_parent) (kw_partition) (kw_passing)
  (kw_path) (kw_percent) (kw_persistable) (kw_pipe)
  (kw_pipelined) (kw_pluggable) (kw_pragma) (kw_precedes)
  (kw_preceding) (kw_precision) (kw_primary) (kw_procedure)
  (kw_raise) (kw_range) (kw_read) (kw_record)
  (kw_ref) (kw_reference) (kw_references) (kw_referencing)
  (kw_reject) (kw_relies_on) (kw_rename) (kw_repeat)
  (kw_replace) (kw_reset) (kw_result) (kw_result_cache)
  (kw_return) (kw_returning) (kw_reuse) (kw_reverse)
  (kw_revoke) (kw_right) (kw_rollback) (kw_row)
  (kw_rows) (kw_sample) (kw_save) (kw_savepoint)
  (kw_scalars) (kw_schema) (kw_search) (kw_seed)
  (kw_segment) (kw_select) (kw_sequence) (kw_serializable)
  (kw_servererror) (kw_set) (kw_settings) (kw_shards)
  (kw_shutdown) (kw_siblings) (kw_skip) (kw_specification)
  (kw_start) (kw_startup) (kw_statement) (kw_static)
  (kw_statistics) (kw_strict) (kw_struct) (kw_subpartition)
  (kw_substitutable) (kw_subtype) (kw_suspend) (kw_table)
  (kw_tablespace) (kw_tdo) (kw_then) (kw_ties)
  (kw_to) (kw_trailing) (kw_transaction) (kw_trigger)
  (kw_truncate) (kw_type) (kw_unbounded) (kw_under)
  (kw_union) (kw_unique) (kw_unlimited) (kw_unplug)
  (kw_update) (kw_updating) (kw_uritype) (kw_use)
  (kw_using) (kw_using_nls_comp) (kw_validate) (kw_value)
  (kw_values) (kw_varray) (kw_varying) (kw_view)
  (kw_wait) (kw_when) (kw_where) (kw_while)
  (kw_with) (kw_within) (kw_without) (kw_work)
  (kw_write) (kw_zone)
] @keyword

; Built-in data types (also %TYPE / %ROWTYPE)
[
  (kw_anydata) (kw_anydataset) (kw_anytype) (kw_bfile)
  (kw_binary_double) (kw_binary_float) (kw_binary_integer) (kw_blob)
  (kw_boolean) (kw_char) (kw_character) (kw_clob)
  (kw_datatype_rowtype) (kw_datatype_type) (kw_date) (kw_day)
  (kw_decimal) (kw_double) (kw_float) (kw_hour)
  (kw_int) (kw_integer) (kw_interval) (kw_json_array_t)
  (kw_json_element_t) (kw_json_key_list) (kw_json_object_t) (kw_json_scalar_t)
  (kw_long) (kw_minute) (kw_month) (kw_natural)
  (kw_nchar) (kw_nclob) (kw_number) (kw_numeric)
  (kw_nvarchar2) (kw_pls_integer) (kw_raw) (kw_real)
  (kw_refcursor) (kw_rowid) (kw_sdo_geometry) (kw_sdo_georaster)
  (kw_sdo_topo_geometry) (kw_second) (kw_smallint) (kw_string)
  (kw_time) (kw_timestamp) (kw_urowid) (kw_varchar)
  (kw_varchar2) (kw_xmltype) (kw_year)
] @type.builtin

; Booleans and NULL
[
  (kw_true)
  (kw_false)
] @boolean

(kw_null) @constant.builtin
(kw_dup_val_on_index) @constant.builtin

; Built-in functions that the grammar treats as keywords
[
  (kw_avg) (kw_cast) (kw_connect_by_root) (kw_dense_rank)
  (kw_extract) (kw_json_table) (kw_listagg) (kw_max)
  (kw_min) (kw_mod) (kw_raise_application_error) (kw_rank)
  (kw_row_number) (kw_sum) (kw_treat) (kw_xmlagg)
  (kw_xmlattributes) (kw_xmlelement) (kw_xmlforest) (kw_xmltable)
] @function.builtin

; Built-in variables
[
  (kw_self)
  (kw_sql)
  (kw_bulk_exceptions)
  (kw_bulk_rowcount)
  (kw_current_user)
] @variable.special

; SYS schema
(kw_sys) @type

; Boolean / comparison operators spelled as words
[
  (kw_and)
  (kw_or)
  (kw_not)
  (kw_like)
  (kw_between)
] @operator

; IS / IN are operators only inside expressions (`x IS NULL`, `x IN (...)`);
; elsewhere (`PROCEDURE p IS`, `FOR i IN`, `p IN NUMBER`) they stay keywords.
(expression
  [
    (kw_is)
    (kw_in)
  ] @operator)

; ... and OR is a keyword in `CREATE OR REPLACE`.
(create_obj (kw_or) @keyword)

; `SELECT *`
(kw_asterisk) @operator

; Cursor attributes: %FOUND, %ISOPEN, %NOTFOUND, %ROWCOUNT
[
  (kw_found)
  (kw_isopen)
  (kw_notfound)
  (kw_rowcount)
] @property

; Collection methods: .COUNT, .DELETE, .EXISTS, .EXTEND, .FIRST, .LAST,
; .LIMIT, .NEXT, .PRIOR, .TRIM
(referenced_element_point_method_call
  [
    (kw_count) (kw_delete) (kw_exists) (kw_extend) (kw_first)
    (kw_last) (kw_limit) (kw_next) (kw_prior) (kw_trim)
  ] @function.method)

; ---------------------------------------------------------------------------
; Operators and punctuation
; ---------------------------------------------------------------------------

[
  ":=" "=>" "||" "!=" "<>" "~=" "^=" "<=" ">=" "**" ".."
  "=" "<" ">" "+" "-" "*" "/" "%"
] @operator

[
  "("
  ")"
] @punctuation.bracket

[
  ","
  ";"
  "."
  ":"
] @punctuation.delimiter

(label "<<" @punctuation.special ">>" @punctuation.special)

; COUNT(*) and friends (after the keyword list: later patterns win)
(aggregate_function_call (kw_count) @function.builtin)
