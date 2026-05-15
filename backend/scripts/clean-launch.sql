BEGIN;

TRUNCATE TABLE
  entradas,
  orden_items,
  ordenes,
  tipos_entrada,
  eventos,
  artistas,
  servicios
RESTART IDENTITY CASCADE;

COMMIT;
