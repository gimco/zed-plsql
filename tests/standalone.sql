-- Standalone subprograms, several objects per file, SQL*Plus terminators.
CREATE OR REPLACE FUNCTION f_top(p_id IN NUMBER) RETURN NUMBER
IS
  v NUMBER;
BEGIN
  SELECT COUNT(*) INTO v FROM employees WHERE dept_id = p_id;
  RETURN v;
EXCEPTION
  WHEN no_data_found THEN
    RETURN -1;
END f_top;
/

CREATE OR REPLACE PROCEDURE p_top AS
  v_msg VARCHAR2(100) := q'[it's quoted]';
BEGIN
  EXECUTE IMMEDIATE 'BEGIN NULL; END;' USING v_msg;
  IF (v_msg IS NULL) OR (LENGTH(v_msg) + 1 > 10 AND v_msg LIKE 'x%') THEN
    NULL;
  END IF;
END p_top;
/

BEGIN
  p_top;
END;
/
