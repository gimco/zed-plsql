; Code outline / structure.
; @context keywords are shown next to the name ("PACKAGE BODY my_pkg").

; Packages
(create_package
  (kw_package) @context
  package_name: (identifier) @name) @item

(create_package_body
  (kw_package) @context
  (kw_body) @context
  package_name: (identifier) @name) @item

; Functions and procedures
(function_definition
  (kw_function) @context
  fnc_name: (identifier) @name) @item

(function_declaration
  (kw_function) @context
  fnc_name: (identifier) @name) @item

(procedure_definition
  (kw_procedure) @context
  prc_name: (identifier) @name) @item

(procedure_declaration
  (kw_procedure) @context
  prc_name: (identifier) @name) @item

(create_function
  (kw_function) @context
  fnc_name: (identifier) @name) @item

(create_procedure
  (kw_procedure) @context
  prc_name: (identifier) @name) @item

; Types
(create_type
  (kw_type) @context
  (plsql_type_source
    type_name: (identifier) @name)) @item

(create_type_body
  (kw_type) @context
  (kw_body) @context
  type_name: (identifier) @name) @item

(type_definition_record
  (kw_type) @context
  type_rec_name: (identifier) @name) @item

(type_definition_collection
  (kw_type) @context
  type_collection_name: (identifier) @name) @item

(type_definition_ref_cursor
  (kw_type) @context
  ref_cursor_name: (identifier) @name) @item

(type_definition_sub
  (kw_subtype) @context
  subtype_name: (identifier) @name) @item

; Triggers
(create_trigger
  (kw_trigger) @context
  trigger_name: (identifier) @name) @item

; Cursors
(cursor_definition
  (kw_cursor) @context
  .
  (identifier) @name) @item

; Tables, views, sequences
(create_table
  (kw_table) @context
  table_name: (identifier) @name) @item

(create_view
  (kw_view) @context
  view_name: (identifier) @name) @item

(create_sequence
  (kw_sequence) @context
  (referenced_element) @name) @item
