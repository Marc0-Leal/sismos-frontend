// Cliente del API gateway.
//
// Toda la comunicación pasa por el gateway (una sola URL base).
// En dev el default es localhost:4000; en producción se define VITE_API_URL
// apuntando al gateway desplegado en Render.

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/** Carga inicial: sismos recientes desde el quakes-service (vía gateway). */
export async function fetchEarthquakes({ minMag, maxMag, hours, limit = 500 } = {}) {
  const params = new URLSearchParams();
  if (minMag != null) params.set('minMag', String(minMag));
  if (maxMag != null) params.set('maxMag', String(maxMag));
  if (hours != null) params.set('hours', String(hours));
  params.set('limit', String(limit));

  const res = await fetch(`${API_BASE}/api/quakes/earthquakes?${params}`);
  if (!res.ok) throw new Error(`Gateway respondió ${res.status}`);
  const data = await res.json();
  return data.earthquakes ?? [];
}

/**
 * Suscripción en tiempo real (SSE) a sismos nuevos.
 * @param {(quake: any) => void} onEarthquake
 * @param {(state: 'open'|'error') => void} [onState]
 * @returns {() => void} función para cerrar la conexión
 */
export function subscribeToEarthquakes(onEarthquake, onState) {
  const es = new EventSource(`${API_BASE}/api/stream`);

  es.addEventListener('connected', () => onState?.('open'));
  es.addEventListener('earthquake', (ev) => {
    try {
      onEarthquake(JSON.parse(ev.data));
    } catch {
      /* ignora payloads malformados */
    }
  });
  es.onerror = () => onState?.('error');

  return () => es.close();
}
