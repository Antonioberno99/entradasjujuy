// ============================================================
// EntradasJujuy - Resultado de compra
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import './CompraResultado.css';

export default function CompraResultado() {
  const { estado } = useParams();
  const [params] = useSearchParams();
  const [orden, setOrden] = useState(null);
  const [loading, setLoading] = useState(Boolean(ordenId));
  const [error, setError] = useState('');

  const ordenId = params.get('external_reference') || params.get('orden_id');
  const paymentId = params.get('payment_id') || params.get('collection_id');

  const copy = useMemo(() => {
    if (estado === 'exito') {
      return {
        badge: 'Pago aprobado',
        title: 'Compra confirmada',
        text: 'Estamos preparando tus entradas. Si el pago ya fue aprobado, vas a ver el estado confirmado aca.',
        tone: 'success',
      };
    }
    if (estado === 'pendiente') {
      return {
        badge: 'Pago pendiente',
        title: 'Tu pago esta en revision',
        text: 'MercadoPago todavia no confirmo la operacion. Podes volver a consultar la orden en unos minutos.',
        tone: 'pending',
      };
    }
    return {
      badge: 'Pago no completado',
      title: 'No pudimos confirmar la compra',
      text: 'La operacion fue cancelada o rechazada. Podes volver al evento e intentar nuevamente.',
      tone: 'error',
    };
  }, [estado]);

  useEffect(() => {
    if (!ordenId) return;

    const verify = async () => {
      setError('');
      setLoading(true);
      try {
        if (paymentId) {
          await api.verificarCompra({ orden_id: ordenId, payment_id: paymentId });
        }
        const res = await api.getOrden(ordenId);
        setOrden(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [ordenId, paymentId]);

  return (
    <div className="compra-page">
      <section className="compra-page__panel animate-fade-in-up">
        <span className={`compra-page__badge ${copy.tone}`}>{copy.badge}</span>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>

        {loading && <div className="compra-page__status">Consultando estado de la orden...</div>}
        {error && <div className="compra-page__error">{error}</div>}

        {orden && (
          <div className="compra-page__summary">
            <div>
              <span>Orden</span>
              <strong>{orden.id}</strong>
            </div>
            <div>
              <span>Estado</span>
              <strong>{orden.estado}</strong>
            </div>
            {orden.entradas?.length > 0 && (
              <div>
                <span>Entradas generadas</span>
                <strong>{orden.entradas.length}</strong>
              </div>
            )}
          </div>
        )}

        {!ordenId && (
          <div className="compra-page__status">
            MercadoPago no envio el identificador de la orden en la URL.
          </div>
        )}

        <div className="compra-page__actions">
          <Link className="btn btn-primary" to="/eventos">Ver eventos</Link>
          <Link className="btn btn-secondary" to="/">Inicio</Link>
        </div>
      </section>
    </div>
  );
}
