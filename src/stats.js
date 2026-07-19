// Cálculo de estadísticas sobre la lista de sismos visible.
// Puro (sin efectos) para poder reutilizarlo y testearlo fácilmente.

export function computeStats(quakes) {
  const bands = { menor2: 0, dos4: 0, cuatro6: 0, seis: 0, sinMag: 0 };
  let max = null;
  let tsunamis = 0;

  for (const q of quakes) {
    if (q.tsunami) tsunamis++;
    const m = q.magnitude;
    if (m == null) {
      bands.sinMag++;
      continue;
    }
    if (m < 2) bands.menor2++;
    else if (m < 4) bands.dos4++;
    else if (m < 6) bands.cuatro6++;
    else bands.seis++;
    if (max == null || m > max.magnitude) max = q;
  }

  return { total: quakes.length, bands, max, tsunamis };
}
