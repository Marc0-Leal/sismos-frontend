// Mapa mundial con MapLibre GL, en proyección de GLOBO terráqueo.
//
// Sustituye a la versión anterior con Leaflet. Motivos del cambio:
//   1. Leaflet es 2D: no existe proyección de globo.
//   2. Con `preferCanvas` los marcadores se pintaban en un único <canvas>, así que
//      no eran elementos del DOM y no admitían animación (la "palpitación").
//
// Cambio de enfoque importante: antes se creaba UN marcador por sismo y se
// añadían/quitaban a mano. Ahora los sismos son una **fuente GeoJSON** y unas
// **capas de círculos** que dibuja la GPU. Se declara el conjunto completo de
// datos y MapLibre se encarga del resto, lo que elimina de raíz toda una familia
// de bugs de sincronización (como el de marcadores obsoletos del Paso 5.6).

import { useEffect, useRef } from 'react';
// MapLibre GL v5 exporta por nombre. Se importa `MapLibreMap` en vez de `Map`
// porque ese nombre chocaría con el `Map` nativo de JavaScript que se usa más
// abajo como índice id -> sismo.
// OJO con la versión: la 6.x NO arranca en este montaje (el evento `load` nunca
// llega). Está fijada a ^5.24.0 a propósito; ver Paso 11 de la bitácora.
import { MapLibreMap, Popup, NavigationControl, GlobeControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { colorForQuake, radiusForMagnitude } from './quakeStyle.js';
import { t } from './i18n.js';
import { BASEMAPS } from './basemaps.js';
import { plateName } from './plateNames.js';

const SOURCE_ID = 'sismos';
const LAYER_ID = 'sismos-circulos';
const HIGHLIGHT_LAYER_ID = 'sismos-destacado';
const PULSE_LAYER_ID = 'sismos-pulso';
const GLOW_LAYER_ID = 'sismos-halo';

// --- Placas tectónicas ------------------------------------------------------
// Bordes de placas del modelo PB2002 (Peter Bird, 2003), el estándar en
// geología. Es una CAPA SUPERPUESTA, no un mapa base: su valor está en
// combinarse con cualquier fondo, porque explica *por qué* tiembla donde
// tiembla. Los sismos se alinean sobre estos bordes.
//
// El archivo se sirve desde nuestro propio dominio (no desde GitHub) y se
// descarga de forma perezosa: solo la primera vez que se activa la casilla.
const PLATES_URL = `${import.meta.env.BASE_URL}placas-tectonicas.geojson`;
const PLATES_SOURCE_ID = 'placas';
const PLATES_LAYER_ID = 'placas-linea';
const PLATES_GLOW_ID = 'placas-resplandor';
// El color lo define cada mapa base (`placasColor`): el cian brillante que
// resplandece sobre el mapa oscuro se pierde sobre uno claro. Mismo principio
// que ya se aplica a los sismos: el estilo de los datos se adapta al fondo.
const PLATES_FALLBACK_COLOR = '#22d3ee';

// --- Palpitación ------------------------------------------------------------
// Solo palpitan los sismos relevantes (M >= 4.0) y los de riesgo de tsunami.
// Animar los cientos de marcadores a la vez sería ruido visual: el movimiento
// se reserva para dirigir la mirada hacia lo que importa.
const PULSE_MIN_MAG = 4.0;
const PULSE_MS = 2200; // duración de un latido completo
const PULSE_MAX_SCALE = 2.6; // cuánto llega a crecer el anillo

// --- Rotación automática ----------------------------------------------------
// El globo gira solo mientras nadie lo toca: transmite que el mapa está vivo.
// Muy despacio a propósito (una vuelta completa cada 5 minutos): lo justo para
// percibir movimiento sin marear ni competir con la lectura de los datos.
const GRADOS_POR_SEGUNDO = 360 / 300;

// --- Aspecto de los sismos según el mapa base -------------------------------
// ETEREO: cada sismo se dibuja con tres capas superpuestas para que parezca luz
// y no una pegatina: halo desenfocado + cuerpo translúcido + borde nítido.
// La clave es el CONTRASTE: si todo fuese translúcido, los sismos se perderían.
// El borde nítido es lo que conserva la lectura mientras el interior "respira".
const ETEREO = {
  haloEscala: 2.1,
  haloOpacidad: 0.18,
  cuerpoOpacidad: 0.3,
  cuerpoDifuso: 0.35,
  bordeAncho: 1.2,
  bordeOpacidad: 0.9,
};

// SOLIDO: sobre mapas claros o satélite hace falta peso y un borde marcado para
// recortar los sismos del fondo.
const SOLIDO = {
  haloEscala: 1.6,
  haloOpacidad: 0.12,
  cuerpoOpacidad: 0.72,
  cuerpoDifuso: 0,
  bordeAncho: 1.6,
  bordeOpacidad: 1,
};

// Escapa texto para insertarlo de forma segura en HTML (previene XSS: el `place`
// o la `url` de un sismo podrían contener HTML/JS malicioso).
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Solo permite enlaces http(s); descarta esquemas peligrosos (javascript:, data:).
function safeUrl(url) {
  if (typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function popupHtml(q, lang) {
  const mag = q.magnitude != null ? `M ${esc(q.magnitude)}` : 'M ?';
  const when = q.occurredAt ? esc(new Date(q.occurredAt).toLocaleString()) : '—';
  const url = safeUrl(q.url);
  const depth = q.depthKm != null ? `${esc(Number(q.depthKm).toFixed(1))} km` : '—';
  return `
    <strong>${mag}</strong> — ${esc(q.place ?? '—')}<br/>
    <small>
      ${esc(t(lang, 'popup_depth'))}: ${depth}<br/>
      ${esc(t(lang, 'popup_date'))}: ${when}<br/>
      ${q.tsunami ? esc(t(lang, 'popup_tsunami')) + '<br/>' : ''}
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(t(lang, 'popup_usgs'))}</a>` : ''}
    </small>`;
}

/** Convierte la lista de sismos al GeoJSON que consumen las capas de círculos. */
function toGeoJson(quakes) {
  return {
    type: 'FeatureCollection',
    features: quakes
      .filter((q) => q.latitude != null && q.longitude != null)
      .map((q) => ({
        type: 'Feature',
        // El id del sismo va en las propiedades para poder filtrar por él.
        properties: {
          id: q.id,
          color: colorForQuake(q), // azul si hay riesgo de tsunami
          radio: radiusForMagnitude(q.magnitude),
          tsunami: q.tsunami ? 1 : 0,
          mag: q.magnitude ?? 0, // lo usa el filtro de la palpitación
        },
        geometry: { type: 'Point', coordinates: [q.longitude, q.latitude] },
      })),
  };
}

/**
 * Añade la fuente y las capas de sismos sobre el estilo actual.
 *
 * Hace falta llamarla cada vez que se cambia de mapa base: `setStyle()`
 * reemplaza el estilo COMPLETO, y con él se llevan por delante nuestras capas
 * (y también la proyección de globo y el cielo).
 */
function aplicarCapasSismos(map, basemap) {
  const est = basemap.solido ? SOLIDO : ETEREO;

  // IDEMPOTENCIA: si alguna capa sobrevivió al cambio de estilo, `addLayer`
  // fallaría con "ya existe una capa con ese id" y abortaría el resto de la
  // función, dejando el mapa sin sismos. Se limpia antes de volver a construir.
  for (const id of [GLOW_LAYER_ID, PULSE_LAYER_ID, LAYER_ID, HIGHLIGHT_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }

  // El globo y el cielo son MEJORAS VISUALES: si fallasen, la excepción mataría
  // el resto de la función y las capas de sismos nunca se añadirían -> mapa
  // vacío y sin pistas. Aislándolos, lo esencial se dibuja igualmente.
  try {
    map.setProjection({ type: 'globe' });
    map.setSky({
      'sky-color': '#0b1220',
      'horizon-color': '#1e3a5f',
      'fog-color': '#0b1220',
      'sky-horizon-blend': 0.5,
      'horizon-fog-blend': 0.5,
    });
  } catch (err) {
    console.warn('[MapView] Globo/cielo no disponibles, se sigue en plano:', err.message);
  }

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: toGeoJson([]) });
  }

  // 1) Halo: el resplandor. Va abajo del todo. `circle-blur` difumina el borde,
  // que es lo que convierte un círculo plano en un brillo.
  map.addLayer({
    id: GLOW_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['*', ['get', 'radio'], est.haloEscala],
      'circle-color': ['get', 'color'],
      'circle-opacity': est.haloOpacidad,
      'circle-blur': 1,
    },
  });

  // 2) Latido: anillo que crece y se desvanece bajo los sismos relevantes.
  // Va antes que la capa principal para que salga desde detrás del círculo.
  map.addLayer({
    id: PULSE_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['any', ['>=', ['get', 'mag'], PULSE_MIN_MAG], ['==', ['get', 'tsunami'], 1]],
    paint: {
      'circle-radius': ['get', 'radio'],
      'circle-color': 'rgba(0,0,0,0)', // sin relleno: solo el anillo
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0,
    },
  });

  // 3) Cuerpo + borde: el sismo propiamente dicho.
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['get', 'radio'],
      'circle-color': ['get', 'color'],
      'circle-opacity': est.cuerpoOpacidad,
      'circle-blur': est.cuerpoDifuso,
      'circle-stroke-width': est.bordeAncho,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-opacity': est.bordeOpacidad,
    },
  });

  // 4) Resalte: dibuja solo el sismo destacado (llegado por SSE o elegido en la
  // lista) con un borde blanco. Se controla con un filtro por id.
  map.addLayer({
    id: HIGHLIGHT_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'id'], ''], // sin nada destacado al principio
    paint: {
      'circle-radius': ['+', ['get', 'radio'], 4],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    },
  });
}

/**
 * Dibuja (o retira) los bordes de placas tectónicas.
 *
 * Se insertan DEBAJO de los sismos (`beforeId`) para que nunca los tapen: las
 * placas son contexto, los sismos son el dato principal.
 */
function aplicarCapaPlacas(map, datos, color = PLATES_FALLBACK_COLOR) {
  if (!datos) {
    for (const id of [PLATES_GLOW_ID, PLATES_LAYER_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    return;
  }

  if (map.getSource(PLATES_SOURCE_ID)) {
    map.getSource(PLATES_SOURCE_ID).setData(datos);
  } else {
    map.addSource(PLATES_SOURCE_ID, { type: 'geojson', data: datos });
  }

  // Si ya estaban dibujadas, basta con repintarlas del color del mapa nuevo.
  if (map.getLayer(PLATES_LAYER_ID)) {
    map.setPaintProperty(PLATES_GLOW_ID, 'line-color', color);
    map.setPaintProperty(PLATES_LAYER_ID, 'line-color', color);
    return;
  }

  // Si las capas de sismos ya existen, las placas se insertan por debajo.
  const debajoDe = map.getLayer(GLOW_LAYER_ID) ? GLOW_LAYER_ID : undefined;

  // Trazo ancho y difuso: da la sensación de "falla" y hace la línea visible
  // sobre fondos muy dispares (satélite, mapa claro, mapa oscuro).
  if (!map.getLayer(PLATES_GLOW_ID)) {
    map.addLayer(
      {
        id: PLATES_GLOW_ID,
        type: 'line',
        source: PLATES_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.22, 'line-blur': 3 },
      },
      debajoDe
    );
  }
  if (!map.getLayer(PLATES_LAYER_ID)) {
    map.addLayer(
      {
        id: PLATES_LAYER_ID,
        type: 'line',
        source: PLATES_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 1.4, 'line-opacity': 0.85 },
      },
      debajoDe
    );
  }
}

export default function MapView({
  quakes,
  highlightId,
  focus,
  lang = 'es',
  basemap = 'noche',
  plates = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const listoRef = useRef(false); // ¿el estilo terminó de cargar?
  const popupRef = useRef(null);
  const quakeById = useRef(new Map()); // id -> datos (para popups y re-traducción)
  const langRef = useRef(lang); // idioma actual accesible desde los manejadores
  const quakesRef = useRef(quakes); // última lista recibida
  const tsunamiTipRef = useRef(null);
  const placasTipRef = useRef(null);
  const interactuandoRef = useRef(false); // ¿el usuario está manipulando el mapa?
  const girandoRef = useRef(true); // ¿rotación automática activa?
  const basemapRef = useRef(basemap); // mapa base aplicado actualmente
  const platesRef = useRef(plates); // ¿placas activadas?
  const platesDataRef = useRef(null); // GeoJSON cacheado tras la primera descarga

  platesRef.current = plates;

  // Los manejadores de MapLibre viven fuera de React y no ven las props nuevas;
  // estas referencias les dan acceso siempre al valor actual.
  quakeById.current = new Map(quakes.map((q) => [q.id, q]));
  langRef.current = lang;
  quakesRef.current = quakes;

  // Abre (o reemplaza) el popup de un sismo.
  function abrirPopup(map, q, idioma) {
    popupRef.current?.remove();
    popupRef.current = new Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat([q.longitude, q.latitude])
      .setHTML(popupHtml(q, idioma))
      .addTo(map);
  }

  // --- Inicialización (una sola vez) ---
  useEffect(() => {
    const inicial = BASEMAPS.find((b) => b.id === basemapRef.current) ?? BASEMAPS[0];
    const map = new MapLibreMap({
      container: containerRef.current,
      style: inicial.style,
      center: [0, 20],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // MapLibre no lanza excepciones: emite eventos 'error'. Sin esta escucha los
    // fallos de estilo o de capa son SILENCIOSOS y el mapa se queda en negro sin
    // ninguna pista en consola.
    map.on('error', (e) => {
      console.error('[MapView] Error de MapLibre:', e.error?.message ?? e);
    });

    // Globo flotante reutilizable para el aviso de tsunami (no roba el foco ni
    // cierra el popup de detalle).
    tsunamiTipRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'tsunami-tip',
      offset: 12,
    });

    // Globo flotante para el nombre de las placas al pasar el cursor.
    placasTipRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'placas-tip',
      offset: 10,
    });

    // Controles: zoom + brújula (permite girar e inclinar el globo) y el botón
    // nativo para alternar entre globo y plano.
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new GlobeControl(), 'top-right');

    // --- Cesión del control al usuario ---------------------------------
    // Se reacciona a APRETAR el botón (mousedown/touchstart/wheel), no a que el
    // mapa empiece a moverse (movestart). El motivo es concreto: `setCenter()`,
    // que usa la rotación automática, llama internamente a `stop()` y ese stop
    // ABORTA cualquier gesto de cámara en curso. Con `movestart` la pausa
    // llegaba tarde y cada frame de rotación mataba el arrastre recién
    // iniciado, obligando a frenar el globo antes de poder moverlo.
    //
    // Esta misma bandera pausa la palpitación: mientras el usuario manipula el
    // mapa, el hilo principal se dedica a cargar teselas y dibujar sismos.
    const cederControl = () => {
      interactuandoRef.current = true;
      if (map.getLayer(PULSE_LAYER_ID)) {
        map.setPaintProperty(PULSE_LAYER_ID, 'circle-stroke-opacity', 0, { validate: false });
      }
    };
    const recuperarControl = () => {
      interactuandoRef.current = false;
    };

    for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart']) {
      map.on(ev, cederControl);
    }
    for (const ev of ['mouseup', 'touchend', 'moveend']) {
      map.on(ev, recuperarControl);
    }

    // Clic sobre el globo: alterna la rotación automática. Pulsar sobre un
    // sismo también la detiene, que es justo lo que se quiere al ponerse a leer
    // su ficha.
    map.on('click', () => {
      girandoRef.current = !girandoRef.current;
    });

    // Los manejadores se registran UNA sola vez: sobreviven a los cambios de
    // estilo porque se enlazan por id de capa, y la capa se vuelve a crear con
    // el mismo id.
    map.on('mousemove', LAYER_ID, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (feat?.properties.tsunami) {
        tsunamiTipRef.current
          .setLngLat(feat.geometry.coordinates)
          .setHTML(esc(t(langRef.current, 'tooltip_tsunami')))
          .addTo(map);
      } else {
        tsunamiTipRef.current?.remove();
      }
    });
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      tsunamiTipRef.current?.remove();
    });
    // Al pasar el cursor por un borde de placa, se muestra qué dos placas
    // separa. Los datos solo traen códigos ("NZ-SA"): plateName() los traduce.
    map.on('mousemove', PLATES_LAYER_ID, (e) => {
      const feat = e.features?.[0];
      if (!feat) return;
      map.getCanvas().style.cursor = 'help';
      const { a, b } = feat.properties;
      placasTipRef.current
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${esc(t(langRef.current, 'plate_boundary'))}</strong><br/>` +
            `${esc(plateName(a))} — ${esc(plateName(b))}`
        )
        .addTo(map);
    });
    map.on('mouseleave', PLATES_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      placasTipRef.current?.remove();
    });

    map.on('click', LAYER_ID, (e) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const q = quakeById.current.get(feat.properties.id);
      if (q) abrirPopup(map, q, langRef.current);
    });

    map.on('load', () => {
      aplicarCapasSismos(map, inicial);
      listoRef.current = true;
      map.getSource(SOURCE_ID)?.setData(toGeoJson(quakesRef.current));
    });

    return () => {
      popupRef.current?.remove();
      tsunamiTipRef.current?.remove();
      placasTipRef.current?.remove();
      map.remove();
      listoRef.current = false;
    };
  }, []);

  // --- Cambio de mapa base ---
  // setStyle() reemplaza el estilo entero, así que hay que volver a añadir
  // nuestras capas (y recargar los datos) cuando el nuevo estilo esté listo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !listoRef.current || basemapRef.current === basemap) return;
    const bm = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];
    basemapRef.current = basemap;
    popupRef.current?.remove();
    tsunamiTipRef.current?.remove();
    // `diff: false` es CLAVE. Por defecto setStyle compara el estilo viejo con
    // el nuevo y aplica solo las diferencias. Entre dos estilos parecidos (p. ej.
    // los dos de Carto, que comparten nombre de fuente y capas) ese atajo se
    // lleva por delante nuestras capas de sismos, porque no existen en el estilo
    // destino. Forzando la recarga completa, el comportamiento es siempre el
    // mismo con cualquier combinación de mapas.
    map.setStyle(bm.style, { diff: false });

    // 'style.load' indica que el estilo nuevo está realmente listo; 'styledata'
    // puede dispararse antes de tiempo, a mitad de la transición.
    map.once('style.load', () => {
      aplicarCapasSismos(map, bm);
      map.getSource(SOURCE_ID)?.setData(toGeoJson(quakesRef.current));
      // El estilo nuevo también se llevó las placas: se reponen si estaban.
      if (platesRef.current && platesDataRef.current) {
        aplicarCapaPlacas(map, platesDataRef.current, bm.placasColor);
      }
    });
  }, [basemap]);

  // --- Placas tectónicas: descarga perezosa y encendido/apagado ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !listoRef.current) return;
    let cancelado = false;

    (async () => {
      if (plates && !platesDataRef.current) {
        try {
          const res = await fetch(PLATES_URL);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          platesDataRef.current = await res.json();
        } catch (err) {
          console.error('[MapView] No se pudieron cargar las placas:', err.message);
          return;
        }
      }
      // El usuario pudo apagar la casilla mientras se descargaba.
      if (cancelado) return;
      const bmActual = BASEMAPS.find((b) => b.id === basemapRef.current) ?? BASEMAPS[0];
      aplicarCapaPlacas(map, plates ? platesDataRef.current : null, bmActual.placasColor);
    })();

    return () => {
      cancelado = true;
    };
  }, [plates]);

  // --- Palpitación: anillo que crece y se desvanece ---
  // Se anima con requestAnimationFrame, que el navegador PAUSA solo cuando la
  // pestaña no está visible: sin gasto de batería en segundo plano.
  // RENDIMIENTO: cada actualización obliga a MapLibre a validar y recompilar la
  // expresión, re-evaluarla para cada sismo de la capa y volver a subir los
  // datos a la GPU. A 60 fps y con miles de sismos (ventana de 7 días) eso
  // compite con la carga de teselas y el mapa se siente pesado al arrastrar.
  // Tres medidas, ninguna con coste visual:
  //   1. Pausar mientras el usuario mueve el mapa (nadie mira el latido
  //      mientras arrastra, y es justo cuando hace falta el hilo principal).
  //   2. `validate: false`: la expresión la construimos aquí, ya sabemos que es
  //      válida; no hace falta revalidarla en cada frame.
  //   3. Limitar a ~30 fps: para un latido de 2,2 s es indistinguible de 60.
  useEffect(() => {
    let raf;
    let ultimo = 0;
    const MS_ENTRE_FRAMES = 33; // ~30 fps

    const animar = (ahora) => {
      raf = requestAnimationFrame(animar);
      const map = mapRef.current;
      if (!map || !listoRef.current || !map.getLayer(PULSE_LAYER_ID)) return;
      if (interactuandoRef.current) return; // el usuario manda: todo cede el paso
      if (ahora - ultimo < MS_ENTRE_FRAMES) return;
      const dt = ultimo ? ahora - ultimo : 0;
      ultimo = ahora;

      // Rotación automática. Se calcula con el tiempo transcurrido (`dt`) y no
      // con un incremento fijo por frame: así la velocidad es la misma en un
      // equipo rápido que en uno lento.
      if (girandoRef.current && dt > 0 && dt < 500) {
        const centro = map.getCenter();
        centro.lng += (GRADOS_POR_SEGUNDO * dt) / 1000;
        map.setCenter(centro);
      }

      // t recorre 0 -> 1 en cada latido.
      const t = (ahora % PULSE_MS) / PULSE_MS;
      // El anillo crece...
      const escala = 1 + (PULSE_MAX_SCALE - 1) * t;
      // ...y se desvanece al expandirse (al cuadrado: se va rápido al final,
      // que es lo que da la sensación de onda que se disipa).
      const opacidad = 0.85 * (1 - t) * (1 - t);

      const opts = { validate: false };
      map.setPaintProperty(PULSE_LAYER_ID, 'circle-radius', ['*', ['get', 'radio'], escala], opts);
      map.setPaintProperty(PULSE_LAYER_ID, 'circle-stroke-opacity', opacidad, opts);
    };
    raf = requestAnimationFrame(animar);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Datos: basta con declarar el conjunto completo ---
  useEffect(() => {
    if (!listoRef.current) return;
    mapRef.current?.getSource(SOURCE_ID)?.setData(toGeoJson(quakes));
  }, [quakes]);

  // --- Idioma: re-traduce el popup abierto ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !popupRef.current?.isOpen()) return;
    const { lng, lat } = popupRef.current.getLngLat();
    const q = quakes.find((x) => x.longitude === lng && x.latitude === lat);
    if (q) popupRef.current.setHTML(popupHtml(q, lang));
  }, [lang, quakes]);

  // --- Vuela hacia un sismo al hacer clic en la lista ---
  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map || !listoRef.current) return;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 4), speed: 0.8 });
    const q = quakeById.current.get(focus.id);
    if (q) abrirPopup(map, q, lang);
  }, [focus, lang]);

  // --- Resalta un sismo recién llegado por SSE (2,5 s) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !listoRef.current || !map.getLayer(HIGHLIGHT_LAYER_ID)) return;
    if (!highlightId) {
      map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'id'], '']);
      return;
    }
    map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'id'], highlightId]);
    const q = quakeById.current.get(highlightId);
    if (q) abrirPopup(map, q, lang);
    const timer = setTimeout(() => {
      if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
        map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'id'], '']);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [highlightId, lang]);

  return <div ref={containerRef} className="map" />;
}
