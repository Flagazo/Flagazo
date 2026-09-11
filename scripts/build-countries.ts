/**
 * Genera `server/src/data/countries.json` desde i18n-iso-countries + la capa curada.
 *
 * Se corre a mano (`npm run build:countries`) y el resultado se commitea: el juego
 * no depende del paquete en runtime, y cualquier cambio en los datos se ve en el diff.
 *
 * El script **falla** ante cualquier inconsistencia (un país sin continente, un nombre
 * que apunta a dos países sin estar declarado ambiguo, un id que no existe). La idea
 * es que un error de datos rompa acá y no en medio de una partida.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
import type { Continent, Country, Difficulty } from '../shared/src/types';
import { normalizeName } from '../server/src/answers/normalize';
import {
  ALIASES,
  AMBIGUOUS,
  CONTINENTS,
  DISPLAY_ES,
  EASY,
  MEDIUM,
  REMOVE_NAMES,
  SIMILAR,
} from '../server/src/data/overrides';

const OUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'src',
  'data',
  'countries.json',
);

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

// ── 1. La lista de países sale de la partición por continente ────────

const continentOf = new Map<string, Continent>();
for (const [continent, ids] of Object.entries(CONTINENTS) as [Continent, readonly string[]][]) {
  for (const id of ids) {
    if (continentOf.has(id)) fail(`${id} figura en dos continentes`);
    continentOf.set(id, continent);
  }
}

const IDS = [...continentOf.keys()].sort();
if (IDS.length !== 195) fail(`Se esperaban 195 países y hay ${IDS.length}`);

const known = new Set(IDS);
/** Ningún override puede hablar de un país que no está en el juego. */
function checkIds(source: string, ids: Iterable<string>) {
  for (const id of ids) {
    if (!known.has(id)) fail(`${source} menciona "${id}", que no es un país del juego`);
  }
}
checkIds('ALIASES', Object.keys(ALIASES));
checkIds('REMOVE_NAMES', Object.keys(REMOVE_NAMES));
checkIds('EASY', EASY);
checkIds('MEDIUM', MEDIUM);
for (const [id, similar] of Object.entries(SIMILAR)) {
  checkIds(`SIMILAR["${id}"]`, [id, ...similar]);
}
for (const [term, ids] of Object.entries(AMBIGUOUS)) {
  checkIds(`AMBIGUOUS["${term}"]`, ids);
  if (ids.length < 2) fail(`AMBIGUOUS["${term}"] necesita al menos dos países`);
  if (normalizeName(term) !== term) {
    fail(`AMBIGUOUS["${term}"] tiene que estar ya normalizado ("${normalizeName(term)}")`);
  }
}

// ── 2. Dificultad ────────────────────────────────────────────────────

const difficultyOf = new Map<string, Difficulty>(IDS.map((id) => [id, 'hard']));
for (const id of EASY) difficultyOf.set(id, 'easy');
for (const id of MEDIUM) {
  if (EASY.includes(id as (typeof EASY)[number])) fail(`${id} está en EASY y en MEDIUM`);
  difficultyOf.set(id, 'medium');
}

// ── 3. Banderas parecidas (simétricas) ───────────────────────────────

const similarOf = new Map<string, Set<string>>(IDS.map((id) => [id, new Set()]));
for (const [id, others] of Object.entries(SIMILAR)) {
  for (const other of others) {
    if (id === other) continue;
    similarOf.get(id)?.add(other);
    similarOf.get(other)?.add(id); // parecerse es mutuo
  }
}

// ── 4. Nombres por idioma ────────────────────────────────────────────

const languages = countries.getSupportedLanguages();
const emojiOf = (id: string) =>
  String.fromCodePoint(...[...id].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const built: Country[] = [];

for (const id of IDS) {
  const removed = new Set((REMOVE_NAMES[id] ?? []).map(normalizeName));
  const names: Record<string, string[]> = {};

  for (const lang of languages) {
    const raw = countries.getNames(lang, { select: 'all' })[id];
    if (!raw) continue;
    const list = (Array.isArray(raw) ? raw : [raw]).filter(
      (name) => name && !removed.has(normalizeName(name)),
    );
    if (list.length > 0) names[lang] = [...new Set(list)];
  }

  if (Object.keys(names).length === 0) fail(`${id} se quedó sin ningún nombre`);

  const displayEs =
    DISPLAY_ES[id] ?? countries.getName(id, 'es') ?? countries.getName(id, 'en') ?? id;
  const displayEn = countries.getName(id, 'en') ?? id;

  built.push({
    id,
    emoji: emojiOf(id),
    displayName: { es: displayEs, en: displayEn },
    names,
    aliases: ALIASES[id] ?? [],
    difficulty: difficultyOf.get(id)!,
    continent: continentOf.get(id)!,
    ...(similarOf.get(id)!.size > 0 ? { similarTo: [...similarOf.get(id)!].sort() } : {}),
  });
}

// ── 5. Índice y detección de conflictos ──────────────────────────────

const index = new Map<string, Set<string>>();
for (const country of built) {
  const all = [...Object.values(country.names).flat(), ...country.aliases];
  for (const name of all) {
    const key = normalizeName(name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(country.id);
  }
}

for (const [key, ids] of index) {
  if (ids.size === 1) continue;
  const declared = AMBIGUOUS[key];
  if (!declared) {
    fail(`"${key}" apunta a ${[...ids].join(', ')} y no está declarado en AMBIGUOUS`);
    continue;
  }
  const missing = [...ids].filter((id) => !declared.includes(id));
  if (missing.length > 0) {
    fail(`AMBIGUOUS["${key}"] no incluye ${missing.join(', ')}`);
  }
}

// Un alias no puede pisar el nombre propio de otro país.
for (const [id, aliases] of Object.entries(ALIASES)) {
  for (const alias of aliases) {
    const key = normalizeName(alias);
    const owners = index.get(key);
    if (owners && owners.size === 1 && !owners.has(id)) {
      fail(`El alias "${alias}" de ${id} ya es el nombre de ${[...owners][0]}`);
    }
  }
}

// ── 6. Resultado ─────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} problema(s) en los datos:\n`);
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error('\nNo se escribió countries.json.\n');
  process.exit(1);
}

built.sort((a, b) => a.id.localeCompare(b.id));
// El JSON se basta solo: el servidor no importa overrides.ts, que es de build.
const dataset = { countries: built, ambiguous: AMBIGUOUS };
writeFileSync(OUT_FILE, `${JSON.stringify(dataset)}\n`, 'utf8');

const byDifficulty = (level: Difficulty) => built.filter((c) => c.difficulty === level).length;
console.log(`✔ ${built.length} países → ${path.relative(process.cwd(), OUT_FILE)}`);
console.log(`  claves de búsqueda: ${index.size}`);
console.log(
  `  dificultad: ${byDifficulty('easy')} fáciles · ${byDifficulty('medium')} medias · ${byDifficulty('hard')} difíciles`,
);
console.log(`  términos ambiguos declarados: ${Object.keys(AMBIGUOUS).length}`);
