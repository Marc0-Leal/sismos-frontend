// Estilo visual de los sismos según su magnitud.
// Centralizado aquí para que el mapa y la leyenda usen los mismos criterios.

// Umbral de magnitud que separa "sismo" (por debajo) de "terremoto" (igual o
// por encima). Convención elegida por el usuario; cambiar aquí para ajustarla.
export const TERREMOTO_MIN = 6.0;

// Azul reservado para los eventos con riesgo de tsunami (tienen prioridad visual).
export const TSUNAMI_COLOR = '#3b82f6';

/** Color según magnitud (escala tipo semáforo sísmico). */
export function colorForMagnitude(mag) {
  if (mag == null) return '#9ca3af'; // gris: sin magnitud
  if (mag < 2) return '#22c55e'; // verde
  if (mag < 4) return '#eab308'; // amarillo
  if (mag < 6) return '#f97316'; // naranja
  return '#ef4444'; // rojo: fuerte
}

/**
 * Color de un sismo teniendo en cuenta el tsunami: si tiene riesgo, va en AZUL
 * (prioridad); si no, se colorea por magnitud.
 */
export function colorForQuake(q) {
  if (q && q.tsunami) return TSUNAMI_COLOR;
  return colorForMagnitude(q ? q.magnitude : null);
}

/** Categoría del evento para el filtro: 'sismo' | 'terremoto'. */
export function categoryOf(q) {
  return (q.magnitude ?? 0) >= TERREMOTO_MIN ? 'terremoto' : 'sismo';
}

/** Radio del marcador (px) según magnitud. */
export function radiusForMagnitude(mag) {
  if (mag == null) return 4;
  return Math.max(4, mag * 3);
}

/** Tramos para la leyenda. (i18n: clave de traducción opcional para la etiqueta) */
export const LEGEND = [
  { label: 'M < 2', color: '#22c55e' },
  { label: 'M 2 – 4', color: '#eab308' },
  { label: 'M 4 – 6', color: '#f97316' },
  { label: 'M ≥ 6', color: '#ef4444' },
  { label: 'Riesgo de tsunami', color: TSUNAMI_COLOR, i18n: 'legend_tsunami' },
];
