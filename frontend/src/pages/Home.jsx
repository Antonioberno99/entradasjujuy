// ============================================================
// EntradasJujuy — Home Page
// ============================================================

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import EventCard from '../components/EventCard';
import { api } from '../api';
import './Home.css';

export default function Home() {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEventos()
      .then(res => setEventos(res.data || []))
      .catch(() => setEventos([]))
      .finally(() => setLoading(false));
  }, []);

  const eventosDestacados = eventos.slice(0, 6);

  return (
    <div className="home">
      {/* ── HERO ── */}
      <section className="hero" id="hero">
        <div className="hero__bg">
          <div className="hero__orb hero__orb--1" />
          <div className="hero__orb hero__orb--2" />
          <div className="hero__orb hero__orb--3" />
          <div className="hero__grid" />
        </div>

        <div className="container hero__content">
          <div className="hero__text">
            <div className="hero__badge badge badge-tierra animate-fade-in-up">
              🎫 Plataforma #1 de Jujuy
            </div>
            
            <h1 className="hero__title animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              Viví los mejores<br />
              <span className="text-gradient">eventos de Jujuy</span>
            </h1>
            
            <p className="hero__subtitle animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              Comprá tus entradas de forma segura y recibí tu código QR al instante. Sin filas, sin complicaciones.
            </p>

            <div className="hero__actions animate-fade-in-up" style={{ animationDelay: '300ms' }}>
              <Link to="/eventos" className="btn btn-primary btn-lg" id="hero-cta">
                Explorar eventos
              </Link>
              <a href="#como-funciona" className="btn btn-secondary btn-lg" id="hero-how">
                Cómo funciona
              </a>
            </div>

            <div className="hero__stats animate-fade-in-up" style={{ animationDelay: '400ms' }}>
              <div className="hero__stat">
                <span className="hero__stat-number">500+</span>
                <span className="hero__stat-label">Eventos</span>
              </div>
              <div className="hero__stat-divider" />
              <div className="hero__stat">
                <span className="hero__stat-number">50K+</span>
                <span className="hero__stat-label">Entradas vendidas</span>
              </div>
              <div className="hero__stat-divider" />
              <div className="hero__stat">
                <span className="hero__stat-number">100%</span>
                <span className="hero__stat-label">Seguro</span>
              </div>
            </div>
          </div>

          {/* Hero visual - floating ticket */}
          <div className="hero__visual animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <div className="hero__ticket">
              <div className="hero__ticket-header">
                <span className="hero__ticket-logo">
                  <span style={{ color: 'var(--color-tierra)' }}>E</span>
                  <span style={{ color: 'var(--color-cielo)' }}>J</span>
                </span>
                <span className="hero__ticket-badge">ENTRADA VÁLIDA</span>
              </div>
              <div className="hero__ticket-body">
                <div className="hero__ticket-event">Festival Jujeño 2025</div>
                <div className="hero__ticket-details">
                  <span>📅 15 de Agosto</span>
                  <span>🕐 21:00 hs</span>
                </div>
                <div className="hero__ticket-details">
                  <span>📍 Centro Cultural</span>
                  <span>🎫 VIP</span>
                </div>
              </div>
              <div className="hero__ticket-qr">
                <div className="hero__ticket-qr-placeholder" />
              </div>
              <div className="hero__ticket-footer">
                Mostrá este QR en la entrada
              </div>
              <div className="hero__ticket-cutout hero__ticket-cutout--left" />
              <div className="hero__ticket-cutout hero__ticket-cutout--right" />
            </div>
          </div>
        </div>

        <div className="hero__scroll"><div className="hero__scroll-line" /></div>
      </section>

      {/* ── EVENTOS DESTACADOS ── */}
      <section className="section featured" id="eventos-destacados">
        <div className="container">
          <div className="featured__header">
            <div>
              <h2 className="featured__title">Próximos <span className="text-gradient">eventos</span></h2>
              <p className="featured__subtitle">Descubrí lo que se viene en Jujuy</p>
            </div>
            <Link to="/eventos" className="btn btn-outline" id="ver-todos-cta">Ver todos →</Link>
          </div>

          {loading ? (
            <div className="featured__grid stagger">
              {[1, 2, 3].map(i => (
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
          ) : eventosDestacados.length > 0 ? (
            <div className="featured__grid stagger">
              {eventosDestacados.map((ev, i) => (
                <EventCard key={ev.id} evento={ev} index={i} />
              ))}
            </div>
          ) : (
            <div className="featured__empty">
              <div className="featured__empty-icon">🎭</div>
              <h3>Próximamente</h3>
              <p>Estamos preparando eventos increíbles para vos. ¡Volvé pronto!</p>
            </div>
          )}
        </div>
      </section>

      {/* ── CÓMO FUNCIONA ── */}
      <section className="section how-it-works" id="como-funciona">
        <div className="container">
          <div className="how__header">
            <h2 className="how__title">Comprar es <span className="text-gradient-blue">muy simple</span></h2>
            <p className="how__subtitle">En 3 pasos tenés tu entrada lista para presentar</p>
          </div>

          <div className="how__steps stagger">
            <div className="how__step animate-fade-in-up">
              <div className="how__step-number">1</div>
              <div className="how__step-icon">🔍</div>
              <h3 className="how__step-title">Elegí tu evento</h3>
              <p className="how__step-desc">Explorá los eventos disponibles y seleccioná el que más te guste</p>
            </div>
            <div className="how__step-connector"><div className="how__step-line" /></div>
            <div className="how__step animate-fade-in-up">
              <div className="how__step-number">2</div>
              <div className="how__step-icon">💳</div>
              <h3 className="how__step-title">Pagá seguro</h3>
              <p className="how__step-desc">Pagá con MercadoPago: tarjeta, transferencia o efectivo</p>
            </div>
            <div className="how__step-connector"><div className="how__step-line" /></div>
            <div className="how__step animate-fade-in-up">
              <div className="how__step-number">3</div>
              <div className="how__step-icon">📱</div>
              <h3 className="how__step-title">Recibí tu QR</h3>
              <p className="how__step-desc">Te llega el QR por email. Mostralo en la puerta y listo</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ORGANIZADORES ── */}
      <section className="section cta-section" id="cta-final">
        <div className="container">
          <div className="cta-box">
            <div className="cta-box__glow" />
            <h2 className="cta-box__title">¿Organizás eventos?</h2>
            <p className="cta-box__desc">Vendé tus entradas con EntradasJujuy. Cobrá con MercadoPago, validá con QR y gestioná todo desde un solo lugar.</p>
            <a href="mailto:contacto@entradasjujuy.com" className="btn btn-primary btn-lg" id="organizer-cta">Contactanos →</a>
          </div>
        </div>
      </section>
    </div>
  );
}
