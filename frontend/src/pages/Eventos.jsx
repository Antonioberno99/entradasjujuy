// ============================================================
// EntradasJujuy — Eventos (Catálogo)
// ============================================================

import { useState, useEffect } from 'react';
import EventCard from '../components/EventCard';
import { api } from '../api';
import './Eventos.css';

export default function Eventos() {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('todos');

  useEffect(() => {
    api.getEventos()
      .then(res => setEventos(res.data || []))
      .catch(() => setEventos([]))
      .finally(() => setLoading(false));
  }, []);

  // Get unique categories
  const categorias = [...new Set(eventos.map(e => e.categoria).filter(Boolean))];

  const eventosFiltrados = filtro === 'todos'
    ? eventos
    : eventos.filter(e => e.categoria === filtro);

  return (
    <div className="eventos-page">
      {/* Header */}
      <section className="eventos-page__header">
        <div className="container">
          <h1 className="eventos-page__title animate-fade-in-up">
            Todos los <span className="text-gradient">eventos</span>
          </h1>
          <p className="eventos-page__subtitle animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            Encontrá el evento perfecto para vos
          </p>

          {/* Filters */}
          {categorias.length > 0 && (
            <div className="eventos-page__filters animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <button
                className={`eventos-page__filter ${filtro === 'todos' ? 'active' : ''}`}
                onClick={() => setFiltro('todos')}
              >
                Todos
              </button>
              {categorias.map(cat => (
                <button
                  key={cat}
                  className={`eventos-page__filter ${filtro === cat ? 'active' : ''}`}
                  onClick={() => setFiltro(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Grid */}
      <section className="section">
        <div className="container">
          {loading ? (
            <div className="eventos-page__grid stagger">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="card animate-fade-in-up" style={{ overflow: 'hidden' }}>
                  <div className="skeleton" style={{ height: 200 }} />
                  <div style={{ padding: 16 }}>
                    <div className="skeleton" style={{ height: 20, width: '80%', marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 16 }} />
                    <div className="skeleton" style={{ height: 14, width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : eventosFiltrados.length > 0 ? (
            <div className="eventos-page__grid stagger">
              {eventosFiltrados.map((ev, i) => (
                <EventCard key={ev.id} evento={ev} index={i} />
              ))}
            </div>
          ) : (
            <div className="eventos-page__empty">
              <div className="eventos-page__empty-icon">🎭</div>
              <h3>No hay eventos disponibles</h3>
              <p>
                {filtro !== 'todos'
                  ? `No encontramos eventos de "${filtro}". Probá con otra categoría.`
                  : 'Estamos preparando eventos increíbles. ¡Volvé pronto!'
                }
              </p>
              {filtro !== 'todos' && (
                <button className="btn btn-outline" onClick={() => setFiltro('todos')} style={{ marginTop: 16 }}>
                  Ver todos los eventos
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
