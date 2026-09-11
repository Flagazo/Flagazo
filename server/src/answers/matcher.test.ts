import { describe, expect, it } from 'vitest';
import { DATASET_STATS, getCountry, poolFor } from '../data/countries';
import { matchAnswer } from './matcher';
import { normalizeName } from './normalize';

const verdict = (raw: string, target: string) => matchAnswer(raw, target).verdict;

describe('normalizeName', () => {
  it('ignora mayúsculas, tildes y espacios de más', () => {
    expect(normalizeName('  PERÚ ')).toBe('peru');
    expect(normalizeName('Perú')).toBe(normalizeName('peru'));
    expect(normalizeName('ARGENTINA')).toBe('argentina');
  });

  it('trata guiones y apóstrofes como espacios', () => {
    expect(normalizeName('Guinea-Bissau')).toBe('guinea bissau');
    expect(normalizeName("Côte d'Ivoire")).toBe('cote d ivoire');
  });

  it('descarta puntuación', () => {
    expect(normalizeName('U.S.A.')).toBe('usa');
    expect(normalizeName('¡Chile!')).toBe('chile');
  });

  it('saca el artículo inicial', () => {
    expect(normalizeName('The Gambia')).toBe('gambia');
    expect(normalizeName('Los Países Bajos')).toBe('paises bajos');
    // Pero no si con eso no queda nada.
    expect(normalizeName('The')).toBe('the');
  });

  it('convierte letras que Unicode no descompone', () => {
    expect(normalizeName('Ø')).toBe('o');
    expect(normalizeName('Straße')).toBe('strasse');
    expect(normalizeName('Åland')).toBe('aland');
  });

  it('conserva las vocales de escrituras donde son parte de la palabra', () => {
    // Si se borraran las marcas combinantes, Maldivas y Moldavia (o Malaui y
    // Malasia) colapsarían en el mismo texto y una valdría por la otra.
    expect(normalizeName('मालदीव')).not.toBe(normalizeName('मोल्दोवा'));
    expect(normalizeName('ދިވެހިރާއްޖެ')).not.toBe('');
  });

  it('no rompe con entradas raras', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('!!!')).toBe('');
    expect(normalizeName(undefined as unknown as string)).toBe('');
  });
});

describe('matchAnswer — acierto', () => {
  it('acepta el nombre en cualquiera de los idiomas del dataset', () => {
    expect(verdict('Alemania', 'DE')).toBe('correct');
    expect(verdict('Germany', 'DE')).toBe('correct');
    expect(verdict('Deutschland', 'DE')).toBe('correct');
    expect(verdict('Allemagne', 'DE')).toBe('correct');
    expect(verdict('日本', 'JP')).toBe('correct');
  });

  it('acepta los alias que agregamos a mano', () => {
    expect(verdict('EEUU', 'US')).toBe('correct');
    expect(verdict('EE.UU.', 'US')).toBe('correct');
    expect(verdict('Holanda', 'NL')).toBe('correct');
    expect(verdict('Corea del Sur', 'KR')).toBe('correct');
    expect(verdict('Birmania', 'MM')).toBe('correct');
    expect(verdict('Suazilandia', 'SZ')).toBe('correct');
    expect(verdict('Inglaterra', 'GB')).toBe('correct');
    expect(verdict('Ceilán', 'LK')).toBe('correct');
  });

  it('ignora formato: mayúsculas, tildes y artículos', () => {
    expect(verdict('  perú  ', 'PE')).toBe('correct');
    expect(verdict('The Gambia', 'GM')).toBe('correct');
    expect(verdict('COSTA DE MARFIL', 'CI')).toBe('correct');
  });
});

describe('matchAnswer — ambigüedad', () => {
  it('pide precisión cuando el término no distingue entre los dos Congos', () => {
    const result = matchAnswer('Congo', 'CD');
    expect(result.verdict).toBe('ambiguous');
    // Nombres, no códigos ISO: es lo que se le muestra al jugador, y en los dos
    // idiomas porque el servidor no sabe en cuál está mirando quien preguntó.
    // El orden es alfabético de verdad ("del" antes que "Democrática"), no por
    // código de carácter, que pondría las mayúsculas primero.
    expect(result.options).toEqual([
      { es: 'República del Congo', en: 'Republic of the Congo' },
      { es: 'República Democrática del Congo', en: 'Democratic Republic of the Congo' },
    ]);
    expect(verdict('Congo', 'CG')).toBe('ambiguous');
    expect(verdict('Kongo', 'CD')).toBe('ambiguous');
  });

  it('pide precisión con "Corea", que no es el nombre de ninguna de las dos', () => {
    expect(verdict('Corea', 'KR')).toBe('ambiguous');
    expect(verdict('Corea', 'KP')).toBe('ambiguous');
    expect(verdict('Korea', 'KP')).toBe('ambiguous');
  });

  it('los nombres completos sí distinguen', () => {
    expect(verdict('República Democrática del Congo', 'CD')).toBe('correct');
    expect(verdict('Congo Brazzaville', 'CG')).toBe('correct');
    expect(verdict('Corea del Norte', 'KP')).toBe('correct');
    expect(verdict('Corea del Sur', 'KR')).toBe('correct');
  });

  it('un término ambiguo que no incluye al país correcto es un error', () => {
    // "Congo" no es "sé más específico" si la bandera era Chile.
    expect(verdict('Congo', 'CL')).toBe('wrong');
    expect(verdict('Corea', 'JP')).toBe('wrong');
  });

  it('"Guinea" no es ambiguo: es el nombre propio de un país', () => {
    expect(verdict('Guinea', 'GN')).toBe('correct');
    expect(verdict('Guinea', 'GQ')).toBe('wrong');
    expect(verdict('Guinea Ecuatorial', 'GQ')).toBe('correct');
  });
});

describe('matchAnswer — error', () => {
  it('rechaza el nombre de otro país', () => {
    expect(verdict('Níger', 'NG')).toBe('wrong');
    expect(verdict('Nigeria', 'NE')).toBe('wrong');
    expect(verdict('Brasil', 'AR')).toBe('wrong');
  });

  it('rechaza lo que no es ningún país', () => {
    expect(verdict('cualquier cosa', 'AR')).toBe('wrong');
    expect(verdict('', 'AR')).toBe('wrong');
    expect(verdict('!!!', 'AR')).toBe('wrong');
    expect(verdict('qwertyuiop', 'AR')).toBe('wrong');
  });
});

describe('matchAnswer — errores de tipeo (fuzzy)', () => {
  it('perdona una letra de más, de menos o cambiada', () => {
    expect(verdict('Argentinaa', 'AR')).toBe('close');
    expect(verdict('Argentin', 'AR')).toBe('close');
    expect(verdict('Argentena', 'AR')).toBe('close');
  });

  it('perdona el intercambio de dos letras contiguas como un solo error', () => {
    // Es el error típico de escribir rápido y lo que aporta Damerau.
    expect(verdict('Argnetina', 'AR')).toBe('close');
    expect(verdict('Alemanai', 'DE')).toBe('close');
    expect(verdict('Colomiba', 'CO')).toBe('close');
  });

  it('lo perdonado baja la precisión, que después baja los puntos', () => {
    expect(matchAnswer('Argentina', 'AR')).toMatchObject({ distance: 0, precision: 1 });
    expect(matchAnswer('Argnetina', 'AR')).toMatchObject({ distance: 1, precision: 0.8 });
    expect(matchAnswer('Argentna', 'AR')).toMatchObject({ distance: 1, precision: 0.8 });
    // Dos errores en un nombre largo entran, con la precisión más baja.
    expect(matchAnswer('Arjentna', 'AR')).toMatchObject({ distance: 2, precision: 0.7 });
  });

  it('no perdona nada en nombres cortos', () => {
    // Con tolerancia 1 estos serían "aciertos" siendo otro país o ninguno.
    expect(verdict('Perv', 'PE')).toBe('wrong');
    expect(verdict('Chat', 'TD')).toBe('wrong');
    expect(verdict('Irak', 'IR')).toBe('wrong');
    expect(verdict('Cuva', 'CU')).toBe('wrong');
  });

  it('no perdona lo que está lejos', () => {
    expect(verdict('Brasil', 'AR')).toBe('wrong');
    expect(verdict('Portugal', 'ES')).toBe('wrong');
    expect(verdict('qwertyuiopasdf', 'AR')).toBe('wrong');
  });

  it('si dos países quedan a la misma distancia, pide precisión en vez de adivinar', () => {
    // "Austrlia" está a una edición de Australia y a una de Austria.
    const result = matchAnswer('Austrlia', 'AU');
    expect(result.verdict).toBe('ambiguous');
    expect(result.options?.map((option) => option.es)).toEqual(['Australia', 'Austria']);
    // Y da lo mismo desde cuál de los dos se mire.
    expect(verdict('Austrlia', 'AT')).toBe('ambiguous');
  });

  it('si otro país se parece más, es un error y no un "casi"', () => {
    // "Australa" está a 1 de Australia y a 2 de Austria: gana Australia, así
    // que para Austria no es que le erró al tipear, escribió otra cosa.
    expect(verdict('Australa', 'AU')).toBe('close');
    expect(verdict('Australa', 'AT')).toBe('wrong');
  });

  it('con tres o más candidatos empatados los ofrece a todos', () => {
    // "Chila" está a una edición de Chile y de China.
    const result = matchAnswer('Chila', 'CL');
    expect(result.verdict).toBe('ambiguous');
    expect(result.options?.map((option) => option.es)).toEqual(['Chile', 'China']);
    // El orden es el mismo en los dos idiomas: se ordena una vez, en español.
    expect(result.options?.map((option) => option.en)).toEqual([
      'Chile',
      "People's Republic of China",
    ]);
    // Y si la bandera no era ninguna de las dos, es simplemente un error.
    expect(verdict('Chila', 'TD')).toBe('wrong');
  });

  it('el exacto siempre le gana al parecido', () => {
    // "Niger" es exactamente Níger, aunque esté a una edición de Nigeria.
    expect(verdict('Niger', 'NE')).toBe('correct');
    expect(verdict('Niger', 'NG')).toBe('wrong');
  });

  it('funciona con los nombres en otros idiomas y con los alias', () => {
    // El fuzzy corre contra los ~8900 nombres del índice, no solo los españoles.
    expect(verdict('Deutschlnad', 'DE')).toBe('close');
    expect(verdict('Paises Bajoss', 'NL')).toBe('close');
    // "Holanda" es un alias que agregamos a mano, y también admite tipeos.
    expect(verdict('Holandaa', 'NL')).toBe('close');
  });

  it('responde rápido incluso cuando no coincide con nada', () => {
    const inicio = performance.now();
    for (let i = 0; i < 300; i++) matchAnswer('qwertyuiopasdf', 'AR');
    const porRespuesta = (performance.now() - inicio) / 300;
    // El presupuesto de la arquitectura es < 1 ms por respuesta.
    expect(porRespuesta).toBeLessThan(5);
  });
});

describe('dataset', () => {
  it('tiene los 195 países con datos completos', () => {
    expect(DATASET_STATS.countries).toBe(195);
    expect(DATASET_STATS.searchKeys).toBeGreaterThan(8000);

    const ar = getCountry('AR')!;
    expect(ar.displayName.es).toBe('Argentina');
    expect(ar.emoji).toBe('🇦🇷');
    expect(ar.continent).toBe('americas');
    expect(Object.keys(ar.names).length).toBeGreaterThan(70);
  });

  it('filtra por dificultad y "all" trae todo', () => {
    expect(poolFor('all')).toHaveLength(195);
    expect(poolFor('easy').length).toBeGreaterThan(20);
    expect(poolFor('easy').every((c) => c.difficulty === 'easy')).toBe(true);

    const suma = poolFor('easy').length + poolFor('medium').length + poolFor('hard').length;
    expect(suma).toBe(195);
  });
});
