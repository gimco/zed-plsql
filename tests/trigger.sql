-- Triggers: several DML events, :new / :old references.
CREATE OR REPLACE TRIGGER trg_emp
BEFORE INSERT OR UPDATE OF name, dept_id OR DELETE ON employees
FOR EACH ROW
BEGIN
  IF :new.id IS NULL THEN
    :new.id := :old.id + 1;
  END IF;
END trg_emp;
/
