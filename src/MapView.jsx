// Mapa mundial con MapLibre GL, en proyección de GLOBO terráqueo.
//
// Sustituye a la versión anterior con Leaflet. Motivos del cambio:
//   1. Leaflet es 2D: no existe proyección de globo.
//   2. Con `preferCanvas` los marcadores se pintaban en un único <canvas>, así que
//      no eran elementos del DOM y no admitían animación (la "palpitación").
//
// Cambio de enfoque importante: antes se creaba UN marcador por sismo y se
// añadían/quitaban a mano. Ahora los sismos son una **fuente GeoJSON** y una
// **capa de círculos** que dibuja la GPU. Se declara el conjunto completo de
// datos y MapLibre se encarga del resto, lo que elimina de raíz toda una familia
// de bugs de sincronización (como el de marcadores obsoletos del Paso 5.6).

import { useEffect, useRef } from 'react';
// MapLibre GL v6 solo exporta por nombre (ya no hay export `default`).
// Se importa `MapLibreMap` en vez de `Map` porque ese nombre chocaría con el
// `Map` nativo de JavaScript que se usa más abajo como índice id -> sismo.
import { MapLibreMap, Popup, NavigationControl, GlobeControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { colorForQuake, radiusForMagnitude } from './quakeStyle.js';
import { t } from './i18n.js';

// Estilo de teselas oscuro (Carto). Gratuito y sin clave de API; encaja con la
// interfaz oscura y hace resaltar los colores de los sismos.
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const SOURCE_ID = 'sismos';
const LAYER_ID = 'sismos-circulos';
const HIGHLIGHT_LAYER_ID = 'sismos-destacado';

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

/** Convierte la lista de sismos al GeoJSON que consume la capa de círculos. */
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
        },
        geometry: { type: 'Point', coordinates: [q.longitude, q.latitude] },
      })),
  };
}

export default function MapView({ quakes, highlightId, focus, lang = 'es' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const listoRef = useRef(false); // ¿el estilo terminó de cargar?
  const popupRef = useRef(null);
  const quakeById = useRef(new Map()); // id -> datos (para popups y re-traducción)
  const langRef = useRef(lang); // idioma actual accesible desde los manejadores
  const quakesRef = useRef(quakes); // última lista recibida
  const tsunamiTipRef = useRef(null);

  // Los manejadores de MapLibre viven fuera de React y no ven las props nuevas;
  // estas referencias les dan acceso siempre al valor actual.
  quakeById.current = new Map(quakes.map((q) => [q.id, q]));
  langRef.current = lang;
  quakesRef.current = quakes;

  // --- Inicialización (una sola vez) ---
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
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

    // Controles: zoom + brújula (permite girar e inclinar el globo) y el botón
    // nativo para alternar entre globo y plano.
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new GlobeControl(), 'top-right');

    map.on('load', () => {
      // El globo y el cielo son MEJORAS VISUALES: si fallasen (por ejemplo al
      // cambiar de versión de MapLibre), la excepción mataría este manejador y
      // las capas de sismos nunca se añadirían -> mapa vacío y sin pistas.
      // Aislándolos, lo esencial (los sismos) se dibuja igualmente.
      try {
        // Proyección de GLOBO terráqueo (al acercar el zoom pasa a plano).
        map.setProjection({ type: 'globe' });
        // Halo atmosférico: da sensación de planeta en el espacio.
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

      map.addSource(SOURCE_ID, { type: 'geojson', data: toGeoJson([]) });

      // Capa principal: un círculo por sismo, dibujado por la GPU.
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['get', 'radio'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.6,
          'circle-stroke-width': 1,
          'circle-stroke-color': ['get', 'color'],
        },
      });

      // Capa de resalte: dibuja solo el sismo destacado (llegado por SSE o
      // elegido en la lista) con un borde blanco. Se controla con un filtro.
      map.addLayer({
        id: HIGHLIGHT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'id'], ''], // sin nada destacado al principio
        paint: {
          'circle-radius': ['+', ['get', 'radio'], 4],
          'circle-color': 'transparent',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Cursor de mano sobre los sismos (indica que se puede hacer clic) y aviso
      // al pasar por encima SOLO si el sismo tiene riesgo de tsunami.
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

      // Clic sobre un sismo -> popup con su ficha.
      map.on('click', LAYER_ID, (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const q = quakeById.current.get(feat.properties.id);
        if (!q) return;
        abrirPopup(map, q, langRef.current);
      });

      listoRef.current = true;
      // Pinta los sismos que ya hubiera en memoria al terminar la carga.
      map.getSource(SOURCE_ID)?.setData(toGeoJson(quakesRef.current));
    });

    return () => {
      popupRef.current?.remove();
      tsunamiTipRef.current?.remove();
      map.remove();
      listoRef.current = false;
    };
  }, []);

  // Abre (o reemplaza) el popup de un sismo.
  function abrirPopup(map, q, idioma) {
    popupRef.current?.remove();
    popupRef.current = new Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat([q.longitude, q.latitude])
      .setHTML(popupHtml(q, idioma))
      .addTo(map);
  }

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
