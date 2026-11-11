; Text objects for Vim mode

; Functions and procedures
[
  (function_definition)
  (function_declaration)
  (element_spec_function_spec)
  (create_function)
  (procedure_definition)
  (procedure_declaration)
  (element_spec_procedure_spec)
  (create_procedure)
] @function.around

[
  (function_definition (body) @function.inside)
  (create_function (body) @function.inside)
  (procedure_definition (body) @function.inside)
  (create_procedure (body) @function.inside)
]

; Classes (packages, types, triggers)
[
  (create_package)
  (create_package_body)
  (create_type)
  (create_type_body)
  (create_trigger)
  (alter_package)
  (alter_type)
  (alter_trigger)
] @class.around

; Everything between IS/AS and the closing END of a package or type body
[
  (create_package
    [(kw_is) (kw_as)]
    .
    (_)+ @class.inside
    .
    (end_obj_named))
  (create_package_body
    [(kw_is) (kw_as)]
    .
    (_)+ @class.inside
    .
    (end_obj_named))
  (create_type_body
    [(kw_is) (kw_as)]
    .
    (_)+ @class.inside
    .
    (end_obj_named))
]

; Comments
(comment_sl)+ @comment.around
(comment_ml) @comment.around
