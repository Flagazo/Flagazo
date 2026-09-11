/**
 * Reporte de proporciones de las banderas descargadas.
 *
 * Sirve para mirar con ojos humanos después de correr `build:flags`. El guardián
 * automático es `server/src/data/flagFiles.test.ts`: esto solo lista.
 *
 *     npm run audit:flags
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'server/flags';

const parseLength = (raw) => {
  if (raw === undefined) return null;
  const value = Number.parseFloat(String(raw).replace(/px$/, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
};

const rows = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.svg'))) {
  const id = file.replace('.svg', '');
  // El `<svg>` de apertura puede ocupar varias líneas: nada de `[^>]*`.
  const tag = readFileSync(join(DIR, file), 'utf8').match(/<svg\b[\s\S]*?>/)?.[0];
  if (!tag) {
    rows.push({ id, problema: 'sin <svg> raíz' });
    continue;
  }
  const w = parseLength(tag.match(/\bwidth="([^"]+)"/)?.[1]);
  const h = parseLength(tag.match(/\bheight="([^"]+)"/)?.[1]);
  const p = tag.match(/\bviewBox="([^"]+)"/)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const vbRatio = p?.length === 4 && p[2] > 0 && p[3] > 0 ? p[2] / p[3] : null;
  rows.push({
    id,
    w,
    h,
    attrRatio: w && h ? w / h : null,
    vbRatio,
    // Con esto el SVG pide que lo estiren, y las dos proporciones no tienen por
    // qué coincidir. El de Qatar lo usa: está dibujado en una grilla 75×18 y
    // estirado a su 11:28 oficial, y se ve bien.
    stretches: /preserveAspectRatio="none"/.test(tag),
  });
}

const r4 = (x) => (x == null ? '—' : x.toFixed(4));

const problemas = [];
for (const r of rows) {
  if (r.problema) {
    problemas.push(`${r.id}: ${r.problema}`);
    continue;
  }
  // Con width/height o con viewBox alcanza: el navegador deduce la proporción de
  // cualquiera de los dos. Sin ninguno le inventa 300×150 y la deforma.
  if (r.attrRatio === null && r.vbRatio === null) {
    problemas.push(`${r.id}: no declara proporción de ninguna forma`);
  }
  if (!r.stretches && r.attrRatio && r.vbRatio && Math.abs(r.attrRatio - r.vbRatio) > 0.01) {
    problemas.push(`${r.id}: width/height=${r4(r.attrRatio)} ≠ viewBox=${r4(r.vbRatio)} → se deforma`);
  }
}

console.log(`archivos: ${rows.length}`);
console.log(`\n=== PROBLEMAS (${problemas.length}) ===`);
console.log(problemas.length ? problemas.join('\n') : 'ninguno');

/** La proporción efectiva: la declarada, o la del dibujo si no hay declarada. */
const ratioOf = (r) => r.attrRatio ?? r.vbRatio;

const raras = rows
  .filter((r) => !r.problema)
  .filter((r) => {
    const ratio = ratioOf(r);
    return ratio && Math.abs(ratio - 1.5) > 0.02 && Math.abs(ratio - 4 / 3) > 0.02;
  })
  .sort((a, b) => ratioOf(a) - ratioOf(b));

console.log(`\n=== PROPORCIONES NO ESTÁNDAR (${raras.length} de ${rows.length}) ===`);
console.log('Todo lo que no es 3:2 ni 4:3. Que estén acá es lo correcto:');
console.log('son las que el set anterior redibujaba mal.\n');
for (const r of raras) {
  const size = r.w && r.h ? `${r.w}×${r.h}` : '(del viewBox)';
  console.log(`${r.id.toUpperCase().padEnd(3)} ${size.padStart(14)}  = ${r4(ratioOf(r))}`);
}
