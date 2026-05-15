-- ============================================================
-- EntradasJujuy — Schema PostgreSQL
-- Ejecutar en orden
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USUARIOS (organizadores) ─────────────────────────────────
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre        VARCHAR(200) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  rol           VARCHAR(20) DEFAULT 'organizador',  -- 'organizador' | 'admin'
  auth_provider VARCHAR(20) DEFAULT 'password',     -- 'password' | 'google'
  google_id     TEXT UNIQUE,
  avatar_url    TEXT,
  email_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  email_verification_token_hash TEXT,
  email_verification_expires_at TIMESTAMPTZ,
  mp_user_id     TEXT,
  mp_access_token TEXT,
  mp_refresh_token TEXT,
  mp_public_key TEXT,
  mp_scope      TEXT,
  mp_token_expires_at TIMESTAMPTZ,
  mp_connected_at TIMESTAMPTZ,
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── EVENTOS ──────────────────────────────────────────────────
CREATE TABLE eventos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizador_id      UUID REFERENCES usuarios(id),
  nombre              VARCHAR(300) NOT NULL,
  descripcion         TEXT,
  categoria           VARCHAR(100),
  fecha               DATE NOT NULL,
  hora                TIME NOT NULL,
  lugar               VARCHAR(300),
  ciudad              VARCHAR(100),
  capacidad_total     INT NOT NULL,
  capacidad_disponible INT NOT NULL,
  imagen_url          TEXT,
  activo              BOOLEAN DEFAULT false,  -- false hasta que el org publique
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── TIPOS DE ENTRADA (general, platea, VIP, etc.) ────────────
CREATE TABLE tipos_entrada (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evento_id        UUID REFERENCES eventos(id) ON DELETE CASCADE,
  nombre           VARCHAR(100) NOT NULL,    -- "General", "VIP", "Platea"
  descripcion      TEXT,
  precio_base      NUMERIC(10,2) NOT NULL,   -- precio del organizador
  fee_organizador  NUMERIC(10,2) DEFAULT 0,  -- cargo adicional del org
  -- precio_total = precio_base + fee_organizador (lo paga el comprador)
  -- comision_ej  = precio_total * 0.10        (se queda EntradasJujuy)
  -- org_recibe   = precio_total - comision_ej
  capacidad        INT NOT NULL,
  disponibles      INT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── ÓRDENES ──────────────────────────────────────────────────
CREATE TABLE ordenes (
  id                UUID PRIMARY KEY,         -- generado en el backend, no auto
  evento_id         UUID REFERENCES eventos(id),
  comprador_email   VARCHAR(200) NOT NULL,
  comprador_nombre  VARCHAR(200) NOT NULL,
  comprador_dni     VARCHAR(20),
  estado            VARCHAR(20) DEFAULT 'pendiente',
  -- 'pendiente' | 'pagada' | 'cancelada' | 'reembolsada'
  mp_payment_id     TEXT,                     -- ID del pago en MP
  fecha_pago        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── ITEMS DE LA ORDEN ────────────────────────────────────────
CREATE TABLE orden_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_id         UUID REFERENCES ordenes(id) ON DELETE CASCADE,
  tipo_entrada_id  UUID REFERENCES tipos_entrada(id),
  cantidad         INT NOT NULL,
  precio_unitario  NUMERIC(10,2) NOT NULL,   -- precio_base al momento de compra
  fee_unitario     NUMERIC(10,2) NOT NULL    -- fee al momento de compra
);

-- ── ENTRADAS (una por ticket físico) ─────────────────────────
CREATE TABLE entradas (
  id               UUID PRIMARY KEY,
  orden_id         UUID REFERENCES ordenes(id),
  tipo_entrada_id  UUID REFERENCES tipos_entrada(id),
  token_qr         TEXT UNIQUE NOT NULL,     -- JWT firmado que va en el QR
  estado           VARCHAR(20) DEFAULT 'valida',
  -- 'valida' | 'usada' | 'cancelada'
  numero           INT NOT NULL,             -- 1 de 3, 2 de 3, etc.
  fecha_uso        TIMESTAMPTZ,              -- cuándo se escaneó
  escaneada_por    UUID,                     -- qué usuario validó (futuro)
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── ÍNDICES ──────────────────────────────────────────────────
CREATE INDEX idx_eventos_fecha    ON eventos(fecha);
CREATE INDEX idx_eventos_activo   ON eventos(activo);
CREATE INDEX idx_entradas_token   ON entradas(token_qr);
CREATE INDEX idx_entradas_estado  ON entradas(estado);
CREATE INDEX idx_ordenes_email    ON ordenes(comprador_email);
CREATE INDEX idx_ordenes_estado   ON ordenes(estado);
CREATE INDEX idx_usuarios_mp_user_id ON usuarios(mp_user_id);

CREATE TABLE IF NOT EXISTS mp_oauth_states (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_user_id ON mp_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_expires_at ON mp_oauth_states(expires_at);

-- ── VISTA: resumen por evento ─────────────────────────────────
CREATE VIEW resumen_eventos AS
SELECT
  e.id,
  e.nombre,
  e.fecha,
  COUNT(DISTINCT o.id) FILTER (WHERE o.estado = 'pagada')    AS ordenes_pagadas,
  COUNT(en.id)         FILTER (WHERE en.estado = 'valida')    AS entradas_validas,
  COUNT(en.id)         FILTER (WHERE en.estado = 'usada')     AS entradas_usadas,
  SUM((oi.precio_unitario + oi.fee_unitario) * oi.cantidad)
    FILTER (WHERE o.estado = 'pagada')                        AS total_recaudado,
  SUM((oi.precio_unitario + oi.fee_unitario) * oi.cantidad * 0.10)
    FILTER (WHERE o.estado = 'pagada')                        AS comision_ej
FROM eventos e
LEFT JOIN ordenes o       ON o.evento_id = e.id
LEFT JOIN orden_items oi  ON oi.orden_id = o.id
LEFT JOIN entradas en     ON en.orden_id = o.id
GROUP BY e.id, e.nombre, e.fecha;
