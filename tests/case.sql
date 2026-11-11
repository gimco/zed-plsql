-- CASE statements and expressions, one-line and multi-line branches.
BEGIN
  CASE
    WHEN a = 1 THEN
      v := 1;
      -- comment
      v := 2;
    WHEN a = 2 THEN
      v := 2;
    WHEN a = 3 THEN
      -- leading comment
      v := 3;
    ELSE
      v := 3;
  END CASE;
  CASE a
    WHEN 1 THEN
      IF b THEN
        NULL;
      END IF;
    WHEN 2 THEN
      NULL;
  END CASE;
END;
BEGIN
  CASE a
    WHEN 1 THEN v := 1;
    WHEN 2 THEN v := 2;
    ELSE v := 3;
  END CASE;
  v := CASE a
    WHEN 1 THEN 'x'
    WHEN 2 THEN 'y'
    ELSE 'z'
  END;
  v := CASE
    WHEN a = 1 THEN
      'x'
    ELSE
      'z'
  END;
  CASE a
    WHEN 1 THEN
      v := 1;
    ELSE
      v := 3;
  END CASE;
END;
