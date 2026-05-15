// ============================================================
// EntradasJujuy — API Client
// ============================================================

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const res = await fetch(url, config);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }

  return data;
}

export const api = {
  // Auth
  register: (body) => request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  login: (body) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  loginWithGoogle: (credential) => request('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  }),

  // Eventos
  getEventos: () => request('/api/eventos'),
  getEvento: (id) => request(`/api/eventos/${id}`),

  // Compra
  iniciarCompra: (body) => request('/api/compra/iniciar', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  verificarCompra: (body) => request('/api/compra/verificar', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  // Orden
  getOrden: (id) => request(`/api/orden/${id}`),
};
