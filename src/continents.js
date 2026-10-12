// ¿En qué continente ocurrió un sismo?
//
// USGS no lo dice. Solo da coordenadas y un texto libre como
// "49 km NNE of Kainantu, Papua New Guinea". Extraer el país de ese texto
// parece lo fácil, pero falla justo donde más tiembla: "south of Africa",
// "Kermadec Islands region", "off the coast of Chile"... La mayoría de los
// sismos ocurren en el mar, y ahí el texto no nombra ningún país.
//
// Así que se resuelve geométricamente: se comprueba si el punto cae dentro de
// los polígonos de cada continente (algoritmo de lanzamiento de rayo). Lo que
// no cae en ninguno es OCEANO, y no es un caso residual: es la categoría más
// poblada, porque los grandes bordes de placas están bajo el mar.
//
// Los polígonos vienen de Natural Earth (dominio público), agrupados por
// continente y con la precisión reducida a 2 decimales (~1 km), que es de
// sobra para esta decisión. De 819 KB a 151 KB.

const DATOS_URL = `${import.meta.env.BASE_URL}continentes.json`;

export const OCEANO = 'oceano';

/** Orden fijo para que la gráfica no baile entre recargas. */
export const CONTINENTES = [
  'Asia',
  'North America',
  'South America',
  'Europe',
  'Africa',
  'Oceania',
  'Antarctica',
  OCEANO,
];

/** Clave de traducción de cada continente (ver i18n.js). */
export function claveI18n(id) {
  return 'cont_' + id.toLowerCase().replace(/ /g, '_');
}

let datos = null; // se cachea tras la primera descarga

/** Descarga (una sola vez) los polígonos de continentes. */
export async function cargarContinentes() {
  if (datos) return datos;
  const res = await fetch(DATOS_URL);
  if (!res.ok) throw new Error(`No se pudieron cargar los continentes (${res.status})`);
  datos = await res.json();
  return datos;
}

/**
 * Algoritmo de lanzamiento de rayo: se traza una semirrecta horizontal desde el
 * punto y se cuentan los lados del polígono que cruza. Impar = dentro.
 */
function dentroDelAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/** Un polígono es su contorno (anillo 0) menos sus huecos (anillos 1+). */
function dentroDelPoligono(lon, lat, poligono) {
  if (!dentroDelAnillo(lon, lat, poligono[0])) return false;
  for (let i = 1; i < poligono.length; i++) {
    if (dentroDelAnillo(lon, lat, poligono[i])) return false; // cayó en un hueco
  }
  return true;
}

/**
 * Devuelve el continente de unas coordenadas, u OCEANO si no cae en ninguno.
 * Si los datos aún no se han descargado, devuelve null (el llamante decide).
 */
export function continenteDe(lon, lat) {
  if (!datos || lon == null || lat == null) return null;
  for (const c of datos) {
    // La caja envolvente descarta la mayoría de continentes sin llegar a
    // recorrer un solo polígono: un punto en Chile ni se compara con Asia.
    const [x0, y0, x1, y1] = c.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const p of c.polis) {
      if (dentroDelPoligono(lon, lat, p)) return c.id;
    }
  }
  return OCEANO;
}

/**
 * Cuenta sismos por continente. Devuelve solo las categorías con algún sismo,
 * ordenadas de más a menos.
 */
export function contarPorContinente(quakes) {
  const cuenta = new Map();
  for (const q of quakes) {
    const c = continenteDe(q.longitude, q.latitude);
    if (c == null) return []; // datos aún no cargados
    cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  }
  return CONTINENTES.filter((c) => cuenta.has(c))
    .map((c) => ({ id: c, n: cuenta.get(c) }))
    .sort((a, b) => b.n - a.n);
}
