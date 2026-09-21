// Nombres de las 52 placas tectónicas del modelo PB2002 (Peter Bird, 2003).
//
// Los datos solo traen códigos de dos letras ("NZ-SA"), que no dicen nada a
// quien mira el mapa. Este diccionario los convierte en nombres legibles.
//
// Se incluyen LAS 52, no solo las principales: las 16 más frecuentes cubren
// apenas el 63% de los bordes, así que con una lista corta más de un tercio de
// las líneas habría mostrado un código suelto e incomprensible.
//
// Los nombres van en su forma internacional (la que publica la fuente
// científica), por ser topónimos propios usados así en geología.

export const PLATE_NAMES = {
  AF: 'África',
  AM: 'Amuria',
  AN: 'Antártica',
  AP: 'Altiplano',
  AR: 'Arabia',
  AS: 'Mar Egeo',
  AT: 'Anatolia',
  AU: 'Australia',
  BH: 'Cabeza de Pájaro',
  BR: 'Arrecife Balmoral',
  BS: 'Mar de Banda',
  BU: 'Birmania',
  CA: 'Caribe',
  CL: 'Carolina',
  CO: 'Cocos',
  CR: 'Arrecife Conway',
  EA: 'Isla de Pascua',
  EU: 'Eurasia',
  FT: 'Futuna',
  GP: 'Galápagos',
  IN: 'India',
  JF: 'Juan de Fuca',
  JZ: 'Juan Fernández',
  KE: 'Kermadec',
  MA: 'Marianas',
  MN: 'Manus',
  MO: 'Maoke',
  MS: 'Mar de Molucas',
  NA: 'Norteamérica',
  NB: 'Bismarck Norte',
  ND: 'Andes del Norte',
  NH: 'Nuevas Hébridas',
  NI: 'Niuafo‘ou',
  NZ: 'Nazca',
  OK: 'Ojotsk',
  ON: 'Okinawa',
  PA: 'Pacífico',
  PM: 'Panamá',
  PS: 'Mar de Filipinas',
  RI: 'Rivera',
  SA: 'Sudamérica',
  SB: 'Bismarck Sur',
  SC: 'Scotia',
  SL: 'Shetland',
  SO: 'Somalia',
  SS: 'Mar de Salomón',
  SU: 'Sonda',
  SW: 'Sándwich',
  TI: 'Timor',
  TO: 'Tonga',
  WL: 'Woodlark',
  YA: 'Yangtsé',
};

/** Devuelve el nombre de la placa, o el propio código si no se conoce. */
export function plateName(code) {
  return PLATE_NAMES[code] ?? code;
}
