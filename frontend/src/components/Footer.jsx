// ============================================================
// EntradasJujuy — Footer Component
// ============================================================

import { Link } from 'react-router-dom';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer" id="main-footer">
      <div className="footer__glow" />
      
      <div className="container">
        {/* Top section */}
        <div className="footer__top">
          <div className="footer__brand">
            <Link to="/" className="footer__logo">
              <span className="footer__logo-entradas">Entradas</span>
              <span className="footer__logo-jujuy">Jujuy</span>
            </Link>
            <p className="footer__tagline">
              La plataforma de entradas para los mejores eventos de Jujuy. 
              Comprá seguro, recibí tu QR al instante.
            </p>
          </div>

          <div className="footer__links-grid">
            <div className="footer__links-col">
              <h4 className="footer__links-title">Navegación</h4>
              <Link to="/" className="footer__link">Inicio</Link>
              <Link to="/eventos" className="footer__link">Eventos</Link>
            </div>
            
            <div className="footer__links-col">
              <h4 className="footer__links-title">Soporte</h4>
              <a href="mailto:contacto@entradasjujuy.com" className="footer__link">Contacto</a>
              <a href="#" className="footer__link">Preguntas frecuentes</a>
              <a href="#" className="footer__link">Términos y condiciones</a>
            </div>

            <div className="footer__links-col">
              <h4 className="footer__links-title">Organizadores</h4>
              <a href="#" className="footer__link">Publicá tu evento</a>
              <a href="#" className="footer__link">Panel de control</a>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="footer__divider" />

        {/* Bottom */}
        <div className="footer__bottom">
          <p className="footer__copy">
            © {new Date().getFullYear()} EntradasJujuy. Todos los derechos reservados.
          </p>
          <div className="footer__badges">
            <span className="footer__badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Pagos seguros
            </span>
            <span className="footer__badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Entradas verificadas
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
