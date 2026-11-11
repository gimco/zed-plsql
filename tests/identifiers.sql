-- Identifiers that start with a keyword, PRAGMA, FORALL, empty calls.
DECLARE
  PRAGMA AUTONOMOUS_TRANSACTION;
  e_custom EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_custom, -20001);
  end_date DATE;
  is_valid BOOLEAN;
  type_id NUMBER;
  in_value NUMBER;
  loop_count NUMBER;
BEGIN
  end_date := SYSDATE;
  is_valid := TRUE;
  type_id := in_value + loop_count;
  IF is_valid THEN
    raise_application_error(-20001, 'x');
  END IF;
  FORALL i IN 1..10
    INSERT INTO t (a) VALUES (in_value);
  loop_count := f() + pkg.g();
END;
/
