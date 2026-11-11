-- Labeled loops, cursor FOR loops over inline queries, REF CURSOR types.
DECLARE
  TYPE t_cur IS REF CURSOR;
  TYPE t_emp_cur IS REF CURSOR RETURN employees%ROWTYPE;
  v_total NUMBER := 0;
BEGIN
  <<outer>>
  FOR i IN 1..3 LOOP
    <<inner>>
    LOOP
      EXIT outer WHEN i = 2;
      CONTINUE inner WHEN v_total < 0;
      EXIT;
    END LOOP inner;
  END LOOP outer;
  FOR r IN (SELECT e.*, d.name FROM employees e, departments d) LOOP
    v_total := v_total + r.id;
  END LOOP;
  FOR r IN (
    SELECT id
    FROM employees
    WHERE dept_id IN (SELECT id FROM departments)
  ) LOOP
    v_total := (v_total + r.id) * 2;
  END LOOP;
  GOTO done;
  <<done>>
  NULL;
END;
/
