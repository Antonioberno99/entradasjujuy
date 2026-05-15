// ============================================================
// EntradasJujuy — Event Card Component
// ============================================================

import { Link } from 'react-router-dom';
import { formatPrice, formatDateShort, formatTime, getCategoryIcon, getEventGradient } from '../utils';
import './EventCard.css';

export default function EventCard({ evento, index = 0 }) {
  const date = formatDateShort(evento.fecha);
  const tiposEntrada = evento.tipos_entrada || [];
  const precioMin = tiposEntrada.length
    ? Math.min(...tiposEntrada.map(t => parseFloat(t.precio_total || t.precio_base)))
    : 0;
  const disponibles = tiposEntrada.reduce((sum, t) => sum + (t.disponibles || 0), 0);

  return (
    <Link
      to={`/eventos/${evento.id}`}
      className="event-card card animate-fade-in-up"
      id={`event-card-${evento.id}`}
    >
      {/* Image / Gradient */}
      <div className="event-card__image" style={{
        background: evento.imagen_url
          ? `url(${evento.imagen_url}) center/cover`
          : getEventGradient(index)
      }}>
        <div className="event-card__image-overlay" />
        
        {/* Category badge */}
        {evento.categoria && (
          <span className="event-card__category badge badge-tierra">
            {getCategoryIcon(evento.categoria)} {evento.categoria}
          </span>
        )}

        {/* Date badge */}
        <div className="event-card__date">
          <span className="event-card__date-day">{date.day}</span>
          <span className="event-card__date-month">{date.month}</span>
        </div>

        {/* Decorative QR pattern */}
        {!evento.imagen_url && (
          <div className="event-card__deco">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" opacity="0.06">
              <rect x="5" y="5" width="25" height="25" rx="3" stroke="currentColor" strokeWidth="2"/>
              <rect x="50" y="5" width="25" height="25" rx="3" stroke="currentColor" strokeWidth="2"/>
              <rect x="5" y="50" width="25" height="25" rx="3" stroke="currentColor" strokeWidth="2"/>
              <rect x="13" y="13" width="10" height="10" rx="1" fill="currentColor"/>
              <rect x="58" y="13" width="10" height="10" rx="1" fill="currentColor"/>
              <rect x="13" y="58" width="10" height="10" rx="1" fill="currentColor"/>
              <rect x="50" y="55" width="5" height="5" fill="currentColor"/>
              <rect x="60" y="55" width="5" height="5" fill="currentColor"/>
              <rect x="70" y="55" width="5" height="5" fill="currentColor"/>
              <rect x="55" y="65" width="5" height="5" fill="currentColor"/>
              <rect x="65" y="65" width="5" height="5" fill="currentColor"/>
              <rect x="50" y="70" width="5" height="5" fill="currentColor"/>
              <rect x="60" y="70" width="5" height="5" fill="currentColor"/>
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="event-card__content">
        <h3 className="event-card__title">{evento.nombre}</h3>
        
        <div className="event-card__meta">
          <span className="event-card__meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            {formatTime(evento.hora)}
          </span>
          <span className="event-card__meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {evento.lugar || evento.ciudad || 'Jujuy'}
          </span>
        </div>

        <div className="event-card__footer">
          <div className="event-card__price">
            {precioMin > 0 ? (
              <>
                <span className="event-card__price-label">Desde</span>
                <span className="event-card__price-amount">{formatPrice(precioMin)}</span>
              </>
            ) : (
              <span className="event-card__price-amount">Gratis</span>
            )}
          </div>
          
          <div className={`event-card__stock ${disponibles < 20 ? 'event-card__stock--low' : ''}`}>
            {disponibles > 0 ? (
              disponibles < 20 ? `¡Últimas ${disponibles}!` : 'Disponible'
            ) : 'Agotado'}
          </div>
        </div>
      </div>
    </Link>
  );
}
