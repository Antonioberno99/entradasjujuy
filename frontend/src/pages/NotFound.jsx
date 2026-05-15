// ============================================================
// EntradasJujuy — 404 Page
// ============================================================

import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '32px',
    }}>
      <div className="animate-fade-in-up">
        <div style={{ fontSize: 80, marginBottom: 16 }}>🎫</div>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-6xl)',
          fontWeight: 900,
          letterSpacing: '-2px',
          marginBottom: 8,
        }}>
          <span className="text-gradient">404</span>
        </h1>
        <p style={{
          fontSize: 'var(--text-lg)',
          color: 'var(--text-secondary)',
          marginBottom: 32,
          maxWidth: 400,
        }}>
          Esta página no existe. Quizás el evento que buscás ya terminó o la URL es incorrecta.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/" className="btn btn-primary">Ir al inicio</Link>
          <Link to="/eventos" className="btn btn-secondary">Ver eventos</Link>
        </div>
      </div>
    </div>
  );
}
