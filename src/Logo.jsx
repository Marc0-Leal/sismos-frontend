// Marca de Telura: un epicentro con sus ondas expandiéndose sobre el planeta.
//
// No ilustra el tema, reproduce el gesto del propio producto: en el mapa, los
// sismos relevantes emiten exactamente ese anillo que crece y se disipa. El
// logo es, literalmente, un fotograma de la interfaz.
//
// Va en SVG en línea (no como imagen) por tres razones: nítido a cualquier
// tamaño, sin peticiones de red adicionales, y puede reaccionar al tema.
//
// Colores tomados de la propia paleta de la app: turquesa el de las placas
// tectónicas, ámbar el de las magnitudes medias.

const ANILLO = '#22d3ee'; // turquesa: el planeta
const EPICENTRO = '#f59e0b'; // ámbar: el sismo

export default function Logo({ size = 26 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Telura"
      style={{ flexShrink: 0 }}
    >
      {/* El planeta */}
      <circle cx="24" cy="24" r="20" fill="none" stroke={ANILLO} strokeWidth="2.5" />
      {/* Ondas: la más externa, más tenue, igual que en el mapa al disiparse */}
      <circle
        cx="30"
        cy="30"
        r="10.5"
        fill="none"
        stroke={EPICENTRO}
        strokeWidth="2"
        opacity="0.28"
      />
      <circle
        cx="30"
        cy="30"
        r="5.5"
        fill="none"
        stroke={EPICENTRO}
        strokeWidth="2"
        opacity="0.5"
      />
      {/* El punto de ruptura */}
      <circle cx="30" cy="30" r="2.6" fill={EPICENTRO} />
    </svg>
  );
}
