// --- Mapas base -------------------------------------------------------------
// Tres estilos gratuitos y sin clave de API, cada uno con un propósito distinto.
//
// `solido` NO es un capricho: el aspecto etéreo (translúcido y con resplandor)
// solo se lee como "brillo" sobre un fondo oscuro. Sobre un mapa claro o sobre
// imágenes de satélite, ese mismo efecto se convierte en una mancha lavada e
// ilegible. Por eso cambiar de mapa cambia TAMBIÉN cómo se pintan los sismos.
export const BASEMAPS = [
  {
    id: 'noche',
    i18n: 'basemap_dark',
    solido: false, // sismos etéreos: máximo contraste para detectar actividad
    placasColor: '#22d3ee', // cian brillante: resplandece sobre el negro
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id: 'natural',
    i18n: 'basemap_natural',
    solido: true, // sismos sólidos: el mapa ya aporta mucho color
    placasColor: '#0e7490', // cian OSCURO: sobre fondo claro, el brillante se pierde
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  {
    id: 'satelite',
    i18n: 'basemap_satellite',
    solido: true,
    placasColor: '#67e8f9', // cian muy claro: destaca sobre océano y vegetación
    // Estilo construido a mano sobre teselas raster (no hay style.json público).
    style: {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
    },
  },
];

