-- Package body: declarations, subprograms, loops, DML.
/* Must parse without ERROR nodes and survive scripts/validate.sh. */
CREATE OR REPLACE PACKAGE BODY my_pkg IS
  g_count CONSTANT NUMBER := 10;
  TYPE t_rec IS RECORD (
    id NUMBER,
    name VARCHAR2(30)
  );
  TYPE t_tab IS TABLE OF t_rec INDEX BY PLS_INTEGER;
  SUBTYPE t_name IS VARCHAR2(30);
  e_custom EXCEPTION;
  CURSOR c_emp(p_dept NUMBER) IS
    SELECT e.id, e.name
    FROM employees e
    WHERE e.dept_id = p_dept;

  FUNCTION get_name(p_id IN NUMBER) RETURN VARCHAR2 IS
    v_name VARCHAR2(30);
    v_row employees%ROWTYPE;
  BEGIN
    SELECT name INTO v_name FROM employees WHERE id = p_id;
    IF v_name IS NULL THEN
      v_name := 'x';
    ELSIF v_name = 'a' THEN
      v_name := 'it''s';
    ELSE
      NULL;
    END IF;
    RETURN v_name;
  EXCEPTION
    WHEN no_data_found THEN
      RETURN NULL;
    WHEN OTHERS THEN
      RAISE e_custom;
  END get_name;

  PROCEDURE run(p_x IN OUT NUMBER, p_y VARCHAR2 DEFAULT 'a') IS
    l_tab t_tab;
  BEGIN
    FOR i IN 1..10 LOOP
      BEGIN
        dbms_output.put_line('i=' || i);
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END LOOP;
    WHILE p_x < 5 LOOP
      p_x := p_x + 1.5;
    END LOOP;
    LOOP
      EXIT WHEN p_x > 10;
      p_x := p_x * 2;
    END LOOP;
    CASE p_y
      WHEN 'a' THEN
        NULL;
      ELSE
        NULL;
    END CASE;
    my_pkg.run(
      p_x => p_x,
      p_y => 'b'
    );
    IF l_tab.COUNT > 0 THEN
      UPDATE employees SET name = :b1 WHERE id = p_x;
    END IF;
    INSERT INTO t (a, b) VALUES (1, SYSDATE);
    DELETE FROM t WHERE a = 1;
    COMMIT;
  END run;
END my_pkg;
/
