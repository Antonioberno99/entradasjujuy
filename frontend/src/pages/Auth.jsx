// ============================================================
// EntradasJujuy - Auth
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import './Auth.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function saveSession(payload) {
  localStorage.setItem('ej_token', payload.token);
  localStorage.setItem('ej_user', JSON.stringify(payload.user));
  window.dispatchEvent(new Event('ej-auth-change'));
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function Auth() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialMode = params.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ nombre: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);

  const title = mode === 'register' ? 'Crear cuenta' : 'Iniciar sesion';
  const subtitle = mode === 'register'
    ? 'Administra tus eventos y futuras compras desde EntradasJujuy.'
    : 'Entra a tu cuenta para continuar.';

  const canSubmit = useMemo(() => {
    if (mode === 'register') return Boolean(form.nombre && form.email && form.password.length >= 8);
    return Boolean(form.email && form.password);
  }, [form, mode]);

  useEffect(() => {
    setParams({ mode }, { replace: true });
  }, [mode, setParams]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return;

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async ({ credential }) => {
            setError('');
            setLoading(true);
            try {
              const res = await api.loginWithGoogle(credential);
              saveSession(res);
              navigate('/eventos');
            } catch (err) {
              setError(err.message);
            } finally {
              setLoading(false);
            }
          },
        });
        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: mode === 'register' ? 'signup_with' : 'signin_with',
          width: googleButtonRef.current.offsetWidth || 320,
        });
      })
      .catch(() => setError('No pudimos cargar Google Login. Proba nuevamente.'));

    return () => { cancelled = true; };
  }, [mode, navigate]);

  const update = (field) => (event) => {
    setForm(prev => ({ ...prev, [field]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;

    if (!form.email || !form.password || (mode === 'register' && !form.nombre)) {
      setError(mode === 'register'
        ? 'Completa nombre, email y password.'
        : 'Completa email y password.'
      );
      return;
    }

    if (mode === 'register' && form.password.length < 8) {
      setError('El password debe tener al menos 8 caracteres.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = mode === 'register'
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password });
      saveSession(res);
      navigate('/eventos');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="container auth-hero__inner">
          <div className="auth-hero__copy animate-fade-in-up">
            <span className="badge badge-cielo">Cuenta EntradasJujuy</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          <div className="auth-panel animate-fade-in-up" style={{ animationDelay: '120ms' }}>
            <div className="auth-tabs" role="tablist" aria-label="Autenticacion">
              <button
                type="button"
                className={mode === 'login' ? 'active' : ''}
                onClick={() => setMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'active' : ''}
                onClick={() => setMode('register')}
              >
                Registro
              </button>
            </div>

            <div className="auth-google">
              {GOOGLE_CLIENT_ID ? (
                <div ref={googleButtonRef} className="auth-google__button" />
              ) : (
                <button className="auth-google__fallback" type="button" disabled>
                  Google Login pendiente de configuracion
                </button>
              )}
            </div>

            <div className="auth-divider"><span>o con email</span></div>

            <form className="auth-form" onSubmit={submit}>
              {mode === 'register' && (
                <div className="input-group">
                  <label className="input-label" htmlFor="auth-nombre">Nombre completo</label>
                  <input id="auth-nombre" className="input" value={form.nombre} onChange={update('nombre')} autoComplete="name" />
                </div>
              )}

              <div className="input-group">
                <label className="input-label" htmlFor="auth-email">Email</label>
                <input id="auth-email" className="input" type="email" value={form.email} onChange={update('email')} autoComplete="email" />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  className="input"
                  type="password"
                  value={form.password}
                  onChange={update('password')}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                {mode === 'register' && <span className="auth-hint">Minimo 8 caracteres.</span>}
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button
                className={`btn btn-primary auth-submit ${!canSubmit ? 'auth-submit--needs-input' : ''}`}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Procesando...' : title}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
