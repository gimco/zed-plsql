-- Plain SQL DDL and richer SQL inside PL/SQL.
CREATE TABLE employees (
  id NUMBER PRIMARY KEY,
  name VARCHAR2(100) NOT NULL,
  dept_id NUMBER,
  hired DATE DEFAULT SYSDATE,
  CONSTRAINT fk_dept FOREIGN KEY (dept_id) REFERENCES departments (id)
);

CREATE SEQUENCE emp_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE VIEW v_emp AS
SELECT id, name FROM employees WHERE id > 0; -- indent-ignore

CREATE OR REPLACE PROCEDURE p_report IS
  v_date DATE := DATE '2020-01-01';
  v_n NUMBER;
BEGIN
  SELECT rn INTO v_n
  FROM (SELECT ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY id DESC) rn FROM employees)
  WHERE rn = 1;
  v_n := MOD(v_n, 2) + (v_n + 1) * 2;
  MERGE INTO employees e USING dual ON (e.id = 1)
  WHEN MATCHED THEN UPDATE SET e.name = 'x'
  WHEN NOT MATCHED THEN INSERT (id) VALUES (1);
END p_report;
/
