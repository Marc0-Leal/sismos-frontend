import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView.jsx';
import { BASEMAPS } from './basemaps.js';
import { fetchEarthquakes, subscribeToEarthquakes } from './api.js';
import { LEGEND, colorForQuake, categoryOf, TERREMOTO_MIN } from './quakeStyle.js';
import { computeStats } from './stats.js';
import { LANGS, t } from './i18n.js';

// Tope de seguridad. No es el criterio de que se muestra (eso lo decide la
// ventana temporal), sino un cinturon para que una consulta no pueda devolver
// una cantidad desmedida: 7 dias son ~1.700 sismos, asi que 5.000 da holgura.
const MAX_SISMOS = 5000;

// Ventanas temporales ofrecidas. 30 dias se descarto tras medirlo: 8.034 sismos
// y 3 MB de descarga, demasiado para movil y visualmente saturado.
const VENTANAS = [24, 48, 168];

// Limita un valor al rango [lo, hi]. Si es NaN (campo vacío) devuelve lo.
function clamp(value, lo, hi) {
  if (Number.isNaN(value)) return lo;
  return Math.min(Math.max(value, lo), hi);
}

export default function App() {
  const [quakes, setQuakes] = useState([]);
  const [status, setStatus] = useState('cargando'); // cargando | ok | error
  const [liveState, setLiveState] = useState('connecting'); // connecting | live | off
  const [minMag, setMinMag] = useState(0);
  const [maxMag, setMaxMag] = useState(10);
  const [categoria, setCategoria] = useState('todos'); // todos | sismos | terremotos | tsunami
  const [sortBy, setSortBy] = useState('magnitude'); // magnitude (por defecto) | time
  const [lang, setLang] = useState('es');
  const [basemap, setBasemap] = useState('noche');
  // Ventana temporal: se muestran los sismos de las ultimas N horas.
  // Sustituye al antiguo "ultimos 500", que era un numero arbitrario y, peor,
  // se encogia justo cuando mas interesa el mapa: tras un gran terremoto, sus
  // cientos de replicas empujaban fuera todo lo demas.
  const [hours, setHours] = useState(48);
  const [plates, setPlates] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [focus, setFocus] = useState(null); // {id, lat, lon, nonce}
  const [lastUpdate, setLastUpdate] = useState(null);
  const byId = useRef(new Set());

  // Carga (REST vía gateway). Se repite al cambiar la ventana temporal.
  // El `limit` alto es solo un tope de seguridad: quien manda es `hours`.
  useEffect(() => {
    let cancelado = false;
    setStatus('cargando');
    fetchEarthquakes({ hours, limit: MAX_SISMOS })
      .then((list) => {
        if (cancelado) return;
        byId.current = new Set(list.map((q) => q.id));
        setQuakes(list);
        setStatus('ok');
        setLastUpdate(new Date());
      })
      .catch(() => {
        if (!cancelado) setStatus('error');
      });
    return () => {
      cancelado = true;
    };
  }, [hours]);

  // Suscripción en tiempo real (SSE vía gateway).
  useEffect(() => {
    const unsubscribe = subscribeToEarthquakes(
      (q) => {
        if (byId.current.has(q.id)) return; // evita duplicar en el cliente
        byId.current.add(q.id);
        setQuakes((prev) => [q, ...prev]);
        setHighlightId(q.id);
        setLastUpdate(new Date());
      },
      (state) => setLiveState(state === 'open' ? 'live' : 'off')
    );
    return unsubscribe;
  }, []);

  // Al hacer clic en un sismo de la lista, el mapa vuela hacia él.
  function irAlSismo(q) {
    if (q.latitude == null || q.longitude == null) return;
    setFocus({ id: q.id, lat: q.latitude, lon: q.longitude, nonce: Date.now() });
  }

  const categorias = [
    { value: 'todos', label: t(lang, 'cat_all') },
    { value: 'sismos', label: t(lang, 'cat_quakes', { min: TERREMOTO_MIN }) },
    { value: 'terremotos', label: t(lang, 'cat_earthquakes', { min: TERREMOTO_MIN }) },
    { value: 'tsunami', label: t(lang, 'cat_tsunami') },
  ];

  const visibles = useMemo(() => {
    // Instante a partir del cual un sismo sigue siendo visible. Se calcula aquí
    // dentro para que se recalcule sola cada vez que cambian los sismos (por
    // ejemplo al llegar uno nuevo por SSE) o la ventana elegida.
    const corte = Date.now() - hours * 3600e3;
    return quakes.filter((q) => {
      // Filtro temporal también en cliente: los sismos que llegan en vivo por
      // SSE se acumularian indefinidamente, y los antiguos deben ir saliendo
      // de la ventana aunque no se recargue la pagina.
      if (q.occurredAt && Date.parse(q.occurredAt) < corte) return false;
      const m = q.magnitude ?? 0;
      if (m < minMag || m > maxMag) return false;
      if (categoria === 'tsunami') return !!q.tsunami;
      if (categoria === 'sismos') return categoryOf(q) === 'sismo';
      if (categoria === 'terremotos') return categoryOf(q) === 'terremoto';
      return true; // 'todos'
    });
  }, [quakes, minMag, maxMag, categoria, hours]);

  // Lista lateral: por magnitud (mayor→menor, por defecto) o por hora.
  const ultimos = useMemo(() => {
    const arr = [...visibles];
    if (sortBy === 'magnitude') {
      arr.sort((a, b) => (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity));
    } else {
      arr.sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
    }
    return arr.slice(0, 12);
  }, [visibles, sortBy]);

  const stats = useMemo(() => computeStats(visibles), [visibles]);

  const liveLabel =
    liveState === 'live'
      ? t(lang, 'live_on')
      : liveState === 'off'
        ? t(lang, 'live_off')
        : t(lang, 'live_connecting');

  return (
    <div className="app">
      <aside className="panel">
        <div className="topbar">
          <h1>🌍 TerraPulso</h1>
          <select
            className="lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label={t(lang, 'lang_label')}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <p className="sub">{t(lang, 'subtitle')}</p>

        <div className="status-row">
          <span className={`dot ${liveState === 'live' ? 'on' : 'off'}`} />
          <span>{liveLabel}</span>
        </div>

        <div className="filter">
          <div className="filter-head">
            {t(lang, 'mag_range')}{' '}
            <strong>
              {minMag.toFixed(1)} – {maxMag.toFixed(1)}
            </strong>
          </div>

          <label className="range-row">
            <span>{t(lang, 'from')}</span>
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={minMag}
              onChange={(e) => setMinMag(clamp(Number(e.target.value), 0, maxMag))}
            />
            <input
              className="num"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={minMag}
              onChange={(e) => setMinMag(clamp(parseFloat(e.target.value), 0, maxMag))}
            />
          </label>

          <label className="range-row">
            <span>{t(lang, 'to')}</span>
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={maxMag}
              onChange={(e) => setMaxMag(clamp(Number(e.target.value), minMag, 10))}
            />
            <input
              className="num"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={maxMag}
              onChange={(e) => setMaxMag(clamp(parseFloat(e.target.value), minMag, 10))}
            />
          </label>

          <div className="range-presets">
            {[
              [0, 10, t(lang, 'preset_all')],
              [4, 5, '4 – 5'],
              [5, 6, '5 – 6'],
              [6, 10, '6+'],
            ].map(([lo, hi, label]) => (
              <button
                key={label}
                className="preset"
                onClick={() => {
                  setMinMag(lo);
                  setMaxMag(hi);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter">
          <label className="type-row">
            {t(lang, 'window_label')}
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {VENTANAS.map((h) => (
                <option key={h} value={h}>
                  {t(lang, `window_${h}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter">
          <label className="type-row">
            {t(lang, 'event_type')}
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {categorias.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter">
          <label className="type-row">
            {t(lang, 'basemap_label')}
            <select value={basemap} onChange={(e) => setBasemap(e.target.value)}>
              {BASEMAPS.map((b) => (
                <option key={b.id} value={b.id}>
                  {t(lang, b.i18n)}
                </option>
              ))}
            </select>
          </label>

          <label className="check-row">
            <input type="checkbox" checked={plates} onChange={(e) => setPlates(e.target.checked)} />
            <span
              className="swatch line"
              style={{ background: BASEMAPS.find((b) => b.id === basemap)?.placasColor }}
            />
            {t(lang, 'plates_label')}
          </label>
        </div>

        <div className="legend">
          {LEGEND.map((l) => (
            <div key={l.label} className="legend-item">
              <span className="swatch" style={{ background: l.color }} />
              {l.i18n ? t(lang, l.i18n) : l.label}
            </div>
          ))}
        </div>

        <div className="count">
          {status === 'cargando' && t(lang, 'loading')}
          {status === 'error' && t(lang, 'error')}
          {status === 'ok' && t(lang, 'shown', { n: visibles.length })}
        </div>

        {status === 'ok' && (
          <div className="stats">
            <div className="stat">
              <span className="stat-num">{stats.total}</span>
              <span className="stat-lbl">{t(lang, 'stat_total')}</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats.max ? `M${stats.max.magnitude}` : '—'}</span>
              <span className="stat-lbl">{t(lang, 'stat_max')}</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats.bands.cuatro6 + stats.bands.seis}</span>
              <span className="stat-lbl">{t(lang, 'stat_m4')}</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats.tsunamis}</span>
              <span className="stat-lbl">{t(lang, 'stat_tsunami')}</span>
            </div>
          </div>
        )}

        <div className="list-head">
          <h2>{t(lang, 'list_heading')}</h2>
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label={t(lang, 'sort_label')}
          >
            <option value="magnitude">{t(lang, 'sort_mag')}</option>
            <option value="time">{t(lang, 'sort_time')}</option>
          </select>
        </div>

        {status === 'ok' && visibles.length === 0 && <p className="empty">{t(lang, 'empty')}</p>}
        <ul className="list">
          {ultimos.map((q) => (
            <li key={q.id} onClick={() => irAlSismo(q)} title={t(lang, 'see_on_map')}>
              <b style={{ color: colorForQuake(q) }}>M{q.magnitude ?? '?'}</b>
              <span className="place">
                {q.place ?? '—'}
                {q.tsunami ? ' ⚠️' : ''}
              </span>
              <span className="time">
                {q.occurredAt ? new Date(q.occurredAt).toLocaleTimeString() : ''}
              </span>
            </li>
          ))}
        </ul>

        <footer className="foot">
          {lastUpdate && (
            <div>
              {t(lang, 'updated')} {lastUpdate.toLocaleTimeString()}
            </div>
          )}
          <div>
            {t(lang, 'source')}{' '}
            <a href="https://earthquake.usgs.gov" target="_blank" rel="noreferrer">
              USGS
            </a>{' '}
            · {t(lang, 'updates_note')}
          </div>
        </footer>
      </aside>

      <main className="map-wrap">
        <MapView
          quakes={visibles}
          highlightId={highlightId}
          focus={focus}
          lang={lang}
          basemap={basemap}
          plates={plates}
        />
      </main>
    </div>
  );
}
