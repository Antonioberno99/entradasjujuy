// ============================================================
// EntradasJujuy — Detalle de Evento
// ============================================================

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatPrice, formatDate, formatTime, getCategoryIcon, getEventGradient } from '../utils';
import './EventoDetalle.css';

export default function EventoDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [evento, setEvento] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selection state
  const [cantidades, setCantidades] = useState({});
  const [comprador, setComprador] = useState({ nombre: '', email: '', dni: '' });
  const [step, setStep] = useState('seleccion'); // 'seleccion' | 'datos' | 'procesando'
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    api.getEvento(id)
      .then(res => {
        setEvento(res.data);
        const initial = {};
        (res.data.tipos_entrada || []).forEach(t => { initial[t.id] = 0; });
        setCantidades(initial);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const tiposEntrada = evento?.tipos_entrada || [];
  const totalItems = Object.values(cantidades).reduce((s, v) => s + v, 0);
  const totalPrecio = tiposEntrada.reduce((sum, t) => {
    return sum + (cantidades[t.id] || 0) * parseFloat(t.precio_total || t.precio_base);
  }, 0);

  const updateCantidad = (tipoId, delta) => {
    setCantidades(prev => {
      const tipo = tiposEntrada.find(t => t.id === tipoId);
      const current = prev[tipoId] || 0;
      const next = Math.max(0, Math.min(current + delta, tipo?.disponibles || 10));
      return { ...prev, [tipoId]: next };
    });
  };

  const handleComprar = async () => {
    if (!comprador.nombre || !comprador.email) {
      setSubmitError('Completá nombre y email');
      return;
    }
    setSubmitError('');
    setStep('procesando');

    try {
      const items = Object.entries(cantidades)
        .filter(([, qty]) => qty > 0)
        .map(([tipo_entrada_id, cantidad]) => ({ tipo_entrada_id, cantidad }));

      const res = await api.iniciarCompra({
        evento_id: evento.id,
        items,
        comprador,
      });

      // Redirect to MercadoPago
      if (res.mp_sandbox_init_point) {
        window.location.href = res.mp_sandbox_init_point;
      } else if (res.mp_init_point) {
        window.location.href = res.mp_init_point;
      }
    } catch (err) {
      setSubmitError(err.message);
      setStep('datos');
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="evento-detalle">
        <div className="evento-detalle__hero-skeleton">
          <div className="skeleton" style={{ height: '100%' }} />
        </div>
        <div className="container" style={{ paddingTop: 32 }}>
          <div className="skeleton" style={{ height: 40, width: '60%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 20, width: '40%', marginBottom: 32 }} />
          <div className="skeleton" style={{ height: 200, marginBottom: 16 }} />
        </div>
      </div>
    );
  }

  if (error || !evento) {
    return (
      <div className="evento-detalle">
        <div className="container" style={{ paddingTop: 'calc(var(--header-height) + 64px)', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>😕</div>
          <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>Evento no encontrado</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>{error || 'Este evento no existe o fue eliminado.'}</p>
          <button className="btn btn-primary" onClick={() => navigate('/eventos')}>Ver todos los eventos</button>
        </div>
      </div>
    );
  }

  return (
    <div className="evento-detalle">
      {/* Hero */}
      <div className="evento-detalle__hero" style={{
        background: evento.imagen_url
          ? `url(${evento.imagen_url}) center/cover`
          : getEventGradient(0)
      }}>
        <div className="evento-detalle__hero-overlay" />
        <div className="container evento-detalle__hero-content">
          {evento.categoria && (
            <span className="badge badge-tierra animate-fade-in-up">{getCategoryIcon(evento.categoria)} {evento.categoria}</span>
          )}
          <h1 className="evento-detalle__title animate-fade-in-up" style={{ animationDelay: '100ms' }}>{evento.nombre}</h1>
          <div className="evento-detalle__meta animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <span className="evento-detalle__meta-item">📅 {formatDate(evento.fecha)}</span>
            <span className="evento-detalle__meta-item">🕐 {formatTime(evento.hora)}</span>
            <span className="evento-detalle__meta-item">📍 {evento.lugar || evento.ciudad || 'Jujuy'}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container">
        <div className="evento-detalle__layout">
          {/* Left - Info */}
          <div className="evento-detalle__info">
            {evento.descripcion && (
              <div className="evento-detalle__section animate-fade-in-up">
                <h2 className="evento-detalle__section-title">Sobre el evento</h2>
                <p className="evento-detalle__desc">{evento.descripcion}</p>
              </div>
            )}

            <div className="evento-detalle__section animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              <h2 className="evento-detalle__section-title">Detalles</h2>
              <div className="evento-detalle__details-grid">
                <div className="evento-detalle__detail">
                  <span className="evento-detalle__detail-icon">📅</span>
                  <div>
                    <span className="evento-detalle__detail-label">Fecha</span>
                    <span className="evento-detalle__detail-value">{formatDate(evento.fecha)}</span>
                  </div>
                </div>
                <div className="evento-detalle__detail">
                  <span className="evento-detalle__detail-icon">🕐</span>
                  <div>
                    <span className="evento-detalle__detail-label">Hora</span>
                    <span className="evento-detalle__detail-value">{formatTime(evento.hora)}</span>
                  </div>
                </div>
                <div className="evento-detalle__detail">
                  <span className="evento-detalle__detail-icon">📍</span>
                  <div>
                    <span className="evento-detalle__detail-label">Lugar</span>
                    <span className="evento-detalle__detail-value">{evento.lugar || 'Por confirmar'}</span>
                  </div>
                </div>
                {evento.ciudad && (
                  <div className="evento-detalle__detail">
                    <span className="evento-detalle__detail-icon">🏙️</span>
                    <div>
                      <span className="evento-detalle__detail-label">Ciudad</span>
                      <span className="evento-detalle__detail-value">{evento.ciudad}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right - Ticket selector */}
          <div className="evento-detalle__sidebar animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <div className="ticket-selector" id="ticket-selector">
              {step === 'seleccion' && (
                <>
                  <h3 className="ticket-selector__title">Elegí tus entradas</h3>
                  
                  <div className="ticket-selector__types">
                    {tiposEntrada.map(tipo => (
                      <div key={tipo.id} className="ticket-type" id={`ticket-type-${tipo.id}`}>
                        <div className="ticket-type__info">
                          <span className="ticket-type__name">{tipo.nombre}</span>
                          <span className="ticket-type__price">{formatPrice(parseFloat(tipo.precio_total || tipo.precio_base))}</span>
                          <span className="ticket-type__stock">
                            {tipo.disponibles > 0 ? `${tipo.disponibles} disponibles` : 'Agotado'}
                          </span>
                        </div>
                        <div className="ticket-type__controls">
                          <button
                            className="ticket-type__btn"
                            onClick={() => updateCantidad(tipo.id, -1)}
                            disabled={(cantidades[tipo.id] || 0) === 0}
                          >−</button>
                          <span className="ticket-type__qty">{cantidades[tipo.id] || 0}</span>
                          <button
                            className="ticket-type__btn"
                            onClick={() => updateCantidad(tipo.id, 1)}
                            disabled={tipo.disponibles === 0 || (cantidades[tipo.id] || 0) >= tipo.disponibles}
                          >+</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalItems > 0 && (
                    <div className="ticket-selector__summary animate-slide-down">
                      <div className="ticket-selector__total">
                        <span>Total</span>
                        <span className="ticket-selector__total-amount">{formatPrice(totalPrecio)}</span>
                      </div>
                      <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setStep('datos')} id="continue-btn">
                        Continuar →
                      </button>
                    </div>
                  )}
                </>
              )}

              {step === 'datos' && (
                <div className="animate-slide-down">
                  <button className="ticket-selector__back" onClick={() => setStep('seleccion')}>← Volver</button>
                  <h3 className="ticket-selector__title">Tus datos</h3>
                  
                  <div className="ticket-selector__form">
                    <div className="input-group">
                      <label className="input-label" htmlFor="nombre">Nombre completo *</label>
                      <input id="nombre" className="input" placeholder="Tu nombre" value={comprador.nombre}
                        onChange={e => setComprador({ ...comprador, nombre: e.target.value })} />
                    </div>
                    <div className="input-group">
                      <label className="input-label" htmlFor="email">Email *</label>
                      <input id="email" className="input" type="email" placeholder="tu@email.com" value={comprador.email}
                        onChange={e => setComprador({ ...comprador, email: e.target.value })} />
                    </div>
                    <div className="input-group">
                      <label className="input-label" htmlFor="dni">DNI (opcional)</label>
                      <input id="dni" className="input" placeholder="12345678" value={comprador.dni}
                        onChange={e => setComprador({ ...comprador, dni: e.target.value })} />
                    </div>
                  </div>

                  {submitError && <div className="ticket-selector__error">{submitError}</div>}

                  <div className="ticket-selector__summary">
                    <div className="ticket-selector__total">
                      <span>{totalItems} entrada{totalItems > 1 ? 's' : ''}</span>
                      <span className="ticket-selector__total-amount">{formatPrice(totalPrecio)}</span>
                    </div>
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleComprar} id="buy-btn">
                      💳 Pagar con MercadoPago
                    </button>
                    <p className="ticket-selector__secure">🔒 Pago seguro con MercadoPago</p>
                  </div>
                </div>
              )}

              {step === 'procesando' && (
                <div className="ticket-selector__loading animate-fade-in">
                  <div className="ticket-selector__spinner" />
                  <p>Conectando con MercadoPago...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
