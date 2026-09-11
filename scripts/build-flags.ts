/**
 * Descarga las banderas oficiales desde Wikimedia Commons (la fuente que usa Wikipedia).
 *
 * Por qué no alcanzaba `flag-icons`: redibuja **todas** las banderas a 4:3, sin importar
 * su proporción oficial. Suiza es cuadrada, Qatar es 11:28 y Nepal ni siquiera es
 * rectangular: metidas a la fuerza en 4:3 quedan deformadas.
 *
 * Acá cada bandera se guarda con su proporción real y el cliente la muestra con
 * `object-fit: contain`, así nunca se estira ni se recorta.
 *
 * Se corre a mano (`npm run build:flags`) y el resultado se commitea: en runtime el
 * juego sirve archivos propios, sin depender de que Wikimedia esté disponible.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Country } from '../shared/src/types';
import dataset from '../server/src/data/countries.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'server', 'flags');
const CREDITS_FILE = path.join(OUT_DIR, 'FUENTE.md');

/** Wikimedia pide un User-Agent que identifique a quién descarga. */
const USER_AGENT = 'FlagazoBuild/0.1 (juego de banderas; contacto vía el repo del proyecto)';
/**
 * Una por vez y con pausa: Commons corta con 429 si se le pide en paralelo.
 * Son 195 archivos que se bajan una sola vez, así que la lentitud no molesta.
 */
const PAUSE_MS = 250;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const IDS = (dataset.countries as Country[]).map((country) => country.id);

async function fetchFlagFileNames(): Promise<Map<string, string>> {
  const query = `
    SELECT ?iso ?flag WHERE {
      ?country wdt:P297 ?iso ; wdt:P41 ?flag .
    }`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Wikidata respondió ${response.status}`);

  const body = (await response.json()) as {
    results: { bindings: { iso: { value: string }; flag: { value: string } }[] };
  };

  const byIso = new Map<string, string>();
  for (const row of body.results.bindings) {
    const iso = row.iso.value.toUpperCase();
    // Si un país trae varias banderas (versiones históricas), nos quedamos con la primera:
    // wdt: ya devuelve la de rango preferido cuando Wikidata la marca.
    if (!byIso.has(iso)) byIso.set(iso, row.flag.value);
  }
  return byIso;
}

/**
 * Baja un SVG reintentando cuando Commons pide bajar el ritmo.
 * Ante un 429 espera lo que diga `Retry-After`, y si no lo dice, va duplicando la espera.
 */
async function download(url: string): Promise<string> {
  let wait = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });

    if (response.ok) {
      const svg = await response.text();
      if (!svg.includes('<svg')) throw new Error(`lo que bajó no parece un SVG`);
      return svg;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`HTTP ${response.status}`);
    }

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait);
    wait *= 2;
  }
  throw new Error('se agotaron los reintentos');
}

const problems: string[] = [];

console.log('Consultando Wikidata…');
const flagUrls = await fetchFlagFileNames();
console.log(`  ${flagUrls.size} países con bandera declarada`);

const missing = IDS.filter((id) => !flagUrls.has(id));
if (missing.length > 0) problems.push(`Sin bandera en Wikidata: ${missing.join(', ')}`);

const targets = IDS.filter((id) => flagUrls.has(id));
console.log(`Descargando ${targets.length} banderas desde Wikimedia Commons…`);

mkdirSync(OUT_DIR, { recursive: true });
// Se limpia antes para que no queden archivos de una corrida vieja.
for (const file of readdirSync(OUT_DIR)) {
  if (file.endsWith('.svg')) rmSync(path.join(OUT_DIR, file));
}

const sources = new Map<string, string>();
let done = 0;

for (const id of targets) {
  const url = flagUrls.get(id)!;
  try {
    const svg = await download(url);
    writeFileSync(path.join(OUT_DIR, `${id.toLowerCase()}.svg`), svg, 'utf8');
    sources.set(id, decodeURIComponent(url.split('Special:FilePath/').pop() ?? url));
  } catch (error) {
    problems.push(`${id}: ${(error as Error).message}`);
  }
  done++;
  if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
  await sleep(PAUSE_MS);
}

if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} problema(s):\n`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

// Constancia de dónde salió cada archivo, para poder rastrear y acreditar.
const credits = [
  '# Origen de las banderas',
  '',
  'Descargadas de **Wikimedia Commons** con `npm run build:flags`, que resuelve cada país',
  'por su código ISO 3166-1 alpha-2 en Wikidata (propiedades P297 e P41).',
  '',
  'Se guardan con su proporción oficial: el cliente las muestra con `object-fit: contain`,',
  'así ninguna se estira ni se recorta.',
  '',
  'La enorme mayoría de las banderas nacionales son de dominio público. El archivo de',
  'cada una en Commons tiene su licencia y autoría concretas.',
  '',
  '| País | Archivo en Commons |',
  '|---|---|',
  ...[...sources.entries()].sort().map(([id, file]) => `| ${id} | ${file} |`),
  '',
].join('\n');
writeFileSync(CREDITS_FILE, credits, 'utf8');

const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.svg'));
const totalBytes = files.reduce((sum, f) => sum + statSync(path.join(OUT_DIR, f)).size, 0);
const biggest = files
  .map((f) => ({ f, size: statSync(path.join(OUT_DIR, f)).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);

console.log(`\n✔ ${files.length} banderas → ${path.relative(process.cwd(), OUT_DIR)}`);
console.log(`  peso total: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  más pesadas: ${biggest.map((b) => `${b.f} ${(b.size / 1024).toFixed(0)}kB`).join(' · ')}`);
