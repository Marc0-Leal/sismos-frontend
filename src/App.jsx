import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView.jsx';
import { fetchEarthquakes, subscribeToEarthquakes } from './api.js';
import { LEGEND, colorForQuake, categoryOf, TERREMOTO_MIN } from './quakeStyle.js';
import { computeStats } from './stats.js';
import { LANGS, t } from './i18n.js';

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
  const [highlightId, setHighlightId] = useState(null);
  const [focus, setFocus] = useState(null); // {id, lat, lon, nonce}
  const [lastUpdate, setLastUpdate] = useState(null);
  const byId = useRef(new Set());

  // Carga inicial (REST vía gateway).
  useEffect(() => {
    fetchEarthquakes({ limit: 500 })
      .then((list) => {
        byId.current = new Set(list.map((q) => q.id));
        setQuakes(list);
        setStatus('ok');
        setLastUpdate(new Date());
      })
      .catch(() => setStatus('error'));
  }, []);

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

  const visibles = useMemo(
    () =>
      quakes.filter((q) => {
        const m = q.magnitude ?? 0;
        if (m < minMag || m > maxMag) return false;
        if (categoria === 'tsunami') return !!q.tsunami;
        if (categoria === 'sismos') return categoryOf(q) === 'sismo';
        if (categoria === 'terremotos') return categoryOf(q) === 'terremoto';
        return true; // 'todos'
      }),
    [quakes, minMag, maxMag, categoria]
  );

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
          <h1>🌍 Sismos Mundo</h1>
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
        <MapView quakes={visibles} highlightId={highlightId} focus={focus} lang={lang} />
      </main>
    </div>
  );
}
