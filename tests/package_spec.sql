-- Package specification.
CREATE OR REPLACE PACKAGE my_pkg AS
  c_max CONSTANT PLS_INTEGER := 100;
  CURSOR c_all RETURN employees%ROWTYPE;
  FUNCTION get_name(p_id IN NUMBER) RETURN VARCHAR2;
  PROCEDURE run(
    p_x IN OUT NUMBER,
    p_y IN VARCHAR2 DEFAULT 'a'
  );
END my_pkg;
/
