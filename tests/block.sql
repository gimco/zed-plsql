-- Anonymous block: nested subprograms, cursors, loops, handlers.
DECLARE
  v_total NUMBER := 0;
  CURSOR c_emp IS
    SELECT id, name
    FROM dual
    WHERE dept_id = 10;
  CURSOR c_dept(p_dept NUMBER) IS
    SELECT id
    FROM employees
    WHERE dept_id = p_dept;
  FUNCTION twice(p NUMBER) RETURN NUMBER IS
  BEGIN
    RETURN p * 2;
  END twice;
BEGIN
  FOR r IN c_dept(
    10
  ) LOOP
    v_total := v_total + r.id;
  END LOOP;
  FOR r IN c_emp LOOP
    IF r.id > 10 THEN
      CONTINUE;
    END IF;
    CASE
      WHEN r.id = 1 THEN
        v_total := 1;
      WHEN r.id = 2 THEN
        v_total := 2;
      ELSE
        v_total := 3;
    END CASE;
  END LOOP;
  WHILE v_total < 10 LOOP
    v_total := v_total + 1;
  END LOOP;
  v_total := CASE
    WHEN v_total > 5 THEN 1
    ELSE 0
  END;
  OPEN c_emp;
  FETCH c_emp INTO v_total;
  CLOSE c_emp;
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_inner := 1;
  END;
EXCEPTION
  WHEN no_data_found OR too_many_rows THEN
    NULL;
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
