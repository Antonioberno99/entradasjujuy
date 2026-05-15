CREATE TABLE IF NOT EXISTS artistas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID REFERENCES usuarios(id),
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(100),
  descripcion TEXT,
  ciudad VARCHAR(100),
  precio_desde VARCHAR(100),
  whatsapp VARCHAR(80),
  instagram VARCHAR(120),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artistas_activo ON artistas(activo);
CREATE INDEX IF NOT EXISTS idx_artistas_usuario ON artistas(usuario_id);

CREATE TABLE IF NOT EXISTS servicios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID REFERENCES usuarios(id),
  nombre VARCHAR(200) NOT NULL,
  categoria VARCHAR(100),
  descripcion TEXT,
  ciudad VARCHAR(100),
  precio_desde VARCHAR(100),
  whatsapp VARCHAR(80),
  instagram VARCHAR(120),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servicios_activo ON servicios(activo);
CREATE INDEX IF NOT EXISTS idx_servicios_usuario ON servicios(usuario_id);
