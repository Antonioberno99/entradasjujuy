// ============================================================
// EntradasJujuy - Header Component
// ============================================================

import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Header.css';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('ej_user')); }
  catch { return null; }
}

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(getStoredUser);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onAuthChange = () => setUser(getStoredUser());
    window.addEventListener('ej-auth-change', onAuthChange);
    window.addEventListener('storage', onAuthChange);
    return () => {
      window.removeEventListener('ej-auth-change', onAuthChange);
      window.removeEventListener('storage', onAuthChange);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const logout = () => {
    localStorage.removeItem('ej_token');
    localStorage.removeItem('ej_user');
    setUser(null);
    closeMenu();
  };

  return (
    <header className={`header ${scrolled ? 'header--scrolled' : ''}`} id="main-header">
      <div className="header__inner container">
        <Link to="/" className="header__logo" id="header-logo" onClick={closeMenu}>
          <span className="header__logo-icon">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="currentColor" className="logo-bg"/>
              <path d="M8 8h6v4h-6zm0 6h4v4h-4zm0 6h6v4h-6zm8-12h4v4h-4zm4 4h4v4h-4zm-4 4h4v4h-4zm4 4h4v4h-4z" fill="var(--color-tierra)" opacity="0.9"/>
            </svg>
          </span>
          <span className="header__logo-text">
            <span className="header__logo-entradas">Entradas</span>
            <span className="header__logo-jujuy">Jujuy</span>
          </span>
        </Link>

        <nav className="header__nav" id="main-nav">
          <Link to="/" className={`header__link ${location.pathname === '/' ? 'active' : ''}`}>
            Inicio
          </Link>
          <Link to="/eventos" className={`header__link ${location.pathname.startsWith('/eventos') ? 'active' : ''}`}>
            Eventos
          </Link>
          <a href="#como-funciona" className="header__link">
            Como funciona
          </a>
        </nav>

        <div className="header__actions">
          {user ? (
            <>
              <span className="header__user">{user.nombre?.split(' ')[0]}</span>
              <button className="btn btn-secondary btn-sm" type="button" onClick={logout}>Salir</button>
            </>
          ) : (
            <Link to="/auth" className="btn btn-secondary btn-sm">Login</Link>
          )}
          <Link to="/eventos" className="btn btn-primary btn-sm" id="header-cta">Comprar entradas</Link>
        </div>

        <button
          className={`header__hamburger ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
          id="header-hamburger"
        >
          <span /><span /><span />
        </button>
      </div>

      <div className={`header__mobile-menu ${menuOpen ? 'open' : ''}`} id="mobile-menu">
        <nav className="header__mobile-nav">
          <Link to="/" className="header__mobile-link" onClick={closeMenu}>Inicio</Link>
          <Link to="/eventos" className="header__mobile-link" onClick={closeMenu}>Eventos</Link>
          <a href="#como-funciona" className="header__mobile-link" onClick={closeMenu}>Como funciona</a>
          {user ? (
            <button className="header__mobile-link" type="button" onClick={logout}>Salir</button>
          ) : (
            <Link to="/auth" className="header__mobile-link" onClick={closeMenu}>Login</Link>
          )}
          <Link to="/eventos" className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} onClick={closeMenu}>
            Comprar entradas
          </Link>
        </nav>
      </div>
    </header>
  );
}
