// Mapa mundial con Leaflet (usado de forma imperativa dentro de un efecto).
//
// Recibe la lista de sismos y los dibuja como círculos. Mantiene un índice
// id -> marcador para poder añadir sismos nuevos (SSE) sin redibujar todo.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colorForQuake, radiusForMagnitude } from './quakeStyle.js';
import { t } from './i18n.js';

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
  return `
    <strong>${mag}</strong> — ${esc(q.place ?? '—')}<br/>
    <small>
      ${esc(t(lang, 'popup_depth'))}: ${q.depthKm != null ? esc(q.depthKm.toFixed(1)) + ' km' : '—'}<br/>
      ${esc(t(lang, 'popup_date'))}: ${when}<br/>
      ${q.tsunami ? esc(t(lang, 'popup_tsunami')) + '<br/>' : ''}
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(t(lang, 'popup_usgs'))}</a>` : ''}
    </small>`;
}

export default function MapView({ quakes, highlightId, focus, lang = 'es' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const rendererRef = useRef(null);
  const markersRef = useRef(new Map()); // id -> marcador
  const quakeById = useRef(new Map()); // id -> datos del sismo (para re-traducir)

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
      // Renderer de canvas: dibuja todos los marcadores en un solo <canvas>
      // en vez de un elemento SVG por sismo. Escala a miles de sismos sin
      // penalizar el rendimiento (mejora de la Fase 5).
      preferCanvas: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    rendererRef.current = L.canvas({ padding: 0.5 });
    return () => map.remove();
  }, []);

  // Sincroniza los marcadores cuando cambia la lista de sismos visible.
  // Añade los nuevos Y elimina los que ya no están (p. ej. al filtrar por rango).
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const markers = markersRef.current;
    const visibleIds = new Set(quakes.map((q) => q.id));

    // 1) Quitar del mapa los marcadores que ya no están en la lista visible.
    for (const [id, marker] of markers) {
      if (!visibleIds.has(id)) {
        layer.removeLayer(marker);
        markers.delete(id);
        quakeById.current.delete(id);
      }
    }

    // 2) Añadir los que aún no están dibujados.
    for (const q of quakes) {
      if (markers.has(q.id)) continue; // ya dibujado
      if (q.latitude == null || q.longitude == null) continue;
      quakeById.current.set(q.id, q);
      const color = colorForQuake(q); // azul si tiene riesgo de tsunami
      const marker = L.circleMarker([q.latitude, q.longitude], {
        renderer: rendererRef.current, // dibuja sobre canvas (rendimiento)
        radius: radiusForMagnitude(q.magnitude),
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 1,
      }).bindPopup(popupHtml(q, lang));

      // Aviso al pasar el cursor: SOLO si el sismo tiene riesgo de tsunami.
      if (q.tsunami) {
        marker.bindTooltip(t(lang, 'tooltip_tsunami'), {
          direction: 'top',
          className: 'tsunami-tip',
        });
      }

      marker.addTo(layer);
      markers.set(q.id, marker);
    }
  }, [quakes, lang]);

  // Al cambiar de idioma, re-traduce popups y tooltips de los marcadores ya dibujados.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const q = quakeById.current.get(id);
      if (!q) continue;
      marker.setPopupContent(popupHtml(q, lang));
      if (q.tsunami) marker.setTooltipContent(t(lang, 'tooltip_tsunami'));
    }
  }, [lang]);

  // Vuela hacia un sismo cuando el usuario hace clic en la lista.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    const map = mapRef.current;
    map.setView([focus.lat, focus.lon], Math.max(map.getZoom(), 5), { animate: true });
    const marker = markersRef.current.get(focus.id);
    if (marker) marker.openPopup();
  }, [focus]);

  // Resalta (anima) un sismo recién llegado por SSE.
  useEffect(() => {
    if (!highlightId) return;
    const marker = markersRef.current.get(highlightId);
    if (marker) {
      marker.openPopup();
      const original = marker.options.radius;
      marker.setStyle({ weight: 3, color: '#111827' });
      setTimeout(() => marker.setStyle({ weight: 1, color: marker.options.fillColor }), 2500);
      void original;
    }
  }, [highlightId]);

  return <div ref={containerRef} className="map" />;
}
