-- Object type specification and body.
CREATE OR REPLACE TYPE t_shape AS OBJECT (
  id NUMBER,
  name VARCHAR2(30),
  MEMBER FUNCTION area RETURN NUMBER,
  MEMBER PROCEDURE show(p_prefix VARCHAR2),
  STATIC FUNCTION make RETURN NUMBER
);
/

CREATE OR REPLACE TYPE BODY t_shape AS
  MEMBER FUNCTION area RETURN NUMBER IS
  BEGIN
    RETURN 1;
  END area;

  MEMBER PROCEDURE show(p_prefix VARCHAR2) IS
    v_text VARCHAR2(100);
  BEGIN
    v_text := p_prefix || name;
  END show;

  STATIC FUNCTION make RETURN NUMBER IS
  BEGIN
    RETURN 0;
  END make;
END t_shape;
/
