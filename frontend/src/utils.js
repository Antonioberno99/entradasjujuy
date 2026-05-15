// ============================================================
// EntradasJujuy — Helpers & Utilities
// ============================================================

/**
 * Format price in ARS
 */
export function formatPrice(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format date in Spanish
 */
export function formatDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Format short date
 */
export function formatDateShort(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return {
    day: date.toLocaleDateString('es-AR', { day: 'numeric' }),
    month: date.toLocaleDateString('es-AR', { month: 'short' }).toUpperCase().replace('.', ''),
    weekday: date.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', ''),
  };
}

/**
 * Format time
 */
export function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5) + ' hs';
}

/**
 * Category icons
 */
export function getCategoryIcon(cat) {
  const map = {
    'música': '🎵',
    'musica': '🎵',
    'teatro': '🎭',
    'deporte': '⚽',
    'deportes': '⚽',
    'festival': '🎪',
    'conferencia': '🎤',
    'gastronomía': '🍷',
    'gastronomia': '🍷',
    'arte': '🎨',
    'fiesta': '🎉',
  };
  return map[(cat || '').toLowerCase()] || '🎫';
}

/**
 * Generate a placeholder gradient for events without images
 */
export function getEventGradient(index) {
  const gradients = [
    'linear-gradient(135deg, #1a0f05 0%, #2d1810 50%, #1a0f05 100%)',
    'linear-gradient(135deg, #0a1520 0%, #152535 50%, #0a1520 100%)',
    'linear-gradient(135deg, #150a1a 0%, #251535 50%, #150a1a 100%)',
    'linear-gradient(135deg, #0a1a10 0%, #153525 50%, #0a1a10 100%)',
    'linear-gradient(135deg, #1a1505 0%, #352d15 50%, #1a1505 100%)',
    'linear-gradient(135deg, #1a0510 0%, #351525 50%, #1a0510 100%)',
  ];
  return gradients[index % gradients.length];
}
