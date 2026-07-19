# Frontend — Sismos Mundo

Mapa mundial de sismos en tiempo real. **React + Vite + Leaflet.**

Consume todo a través del **API gateway** (una sola URL base):
- Carga inicial: `GET /api/quakes/earthquakes` (REST)
- Tiempo real: `GET /api/stream` (SSE, vía `EventSource`)

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
```

Requiere que el gateway (y los microservicios) estén corriendo. Ver el README
raíz para levantar todo el backend.

## Configuración

`VITE_API_URL` — URL del gateway. Default en dev: `http://localhost:4000`.
En producción, apunta al gateway en Render (ver `.env.example`).

## Estructura

```
src/
 ├─ main.jsx        ← punto de entrada React
 ├─ App.jsx         ← estado, filtros, panel lateral, orquestación
 ├─ MapView.jsx     ← integración con Leaflet (marcadores por magnitud)
 ├─ api.js          ← cliente del gateway (REST + SSE)
 ├─ quakeStyle.js   ← colores/tamaños por magnitud + leyenda
 └─ styles.css
```

## Build

```bash
npm run build      # genera dist/ (lo que se despliega en Vercel)
```
