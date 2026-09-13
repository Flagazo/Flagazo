# Flagazo — Arquitectura y plan

> Documento vivo. Se actualiza al cerrar cada fase.
> "Flagazo" es un nombre provisional: se cambia en `shared/src/constants.ts` (`GAME_NAME`).

---

## 1. Stack

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje | **TypeScript** en todo el proyecto | Un solo lenguaje; los eventos tipados rompen la compilación si cliente y servidor dejan de coincidir. |
| Frontend | **React 19 + Vite 8** | Componentes reutilizables, recarga instantánea, build liviano. |
| Estado cliente | **Zustand** | Store mínimo (1 kB). El servidor empuja estado y el store lo refleja sin boilerplate. |
| Estilos | **CSS plano con variables** (un `.css` por componente) | Cero dependencias, animaciones con keyframes, fácil de tocar. |
| Backend | **Node.js + Express 5** | Solo sirve `/health`, `/flags` y el frontend compilado. |
| Tiempo real | **Socket.IO 4** | Reconexión automática, acks (pedido → respuesta), rooms nativas y fallback si WebSocket falla. Evita reimplementar todo eso sobre `ws`. |
| Banderas | **Wikimedia Commons** (SVG), bajadas por script y commiteadas | La fuente canónica, la misma que usa Wikipedia. Se sirven desde nuestro servidor: sin URLs externas que se rompan. Se empezó con `flag-icons` (MIT) pero **redibuja todo a 4:3** y eso deforma a Suiza (cuadrada), Qatar (11:28) y Nepal (ni siquiera rectangular). |
| Datos de países | **i18n-iso-countries** (MIT) + capa curada propia | Nombres en 78 idiomas generados por script; correcciones y aliases a mano. |
| Tests | **Vitest** | Imprescindible para el fuzzy matching y la puntuación. |
| Base de datos | **Ninguna** en el MVP | Todo el estado de parties vive en memoria. SQLite recién si se implementan estadísticas persistentes. |

**Deploy:** un único proceso Node en un único puerto (Render, Railway, Fly.io o un VPS).
Limitación asumida: al estar en memoria, corre en **una sola instancia**. Alcanza de sobra para
cientos de partidas simultáneas; escalar horizontalmente requeriría Redis más adelante.

---

## 2. Arquitectura general

```
┌──────────── Navegador ────────────┐          ┌──────────────── Servidor Node ────────────────┐
│ React (pantallas + componentes)   │          │ Express: /health · /flags/* · frontend        │
│ Zustand (reflejo del estado)      │ WebSocket│ Socket.IO                                     │
│ net/ (socket tipado, reloj)       │◄────────►│  ├─ SessionStore   (quién sos)                │
│                                   │          │  ├─ RoomManager    (parties, host, códigos)   │
│ Solo muestra y envía intenciones  │          │  ├─ GameEngine     (rondas, timers, puntos)   │
└───────────────────────────────────┘          │  ├─ AnswerMatcher  (multidioma + fuzzy)       │
                                               │  └─ GameMode       (normal, pixelada, bomba…) │
             shared/  ← tipos de eventos, constantes y validaciones usados por ambos
```

Principio: **el servidor decide, el cliente dibuja.** El cliente nunca calcula puntos, correcciones,
qué bandera toca ni cuándo termina una ronda.

---

## 3. Estructura de carpetas

```
flagazo/
├─ package.json            workspaces + scripts (dev, build, start, test, typecheck)
├─ tsconfig.base.json
├─ vitest.config.ts
├─ docs/ARQUITECTURA.md
├─ shared/src/
│  ├─ constants.ts         límites (nickname, jugadores, códigos…)
│  ├─ validation.ts        validateNickname, normalizePartyCode…
│  ├─ events.ts            contrato Socket.IO tipado
│  ├─ types.ts             (F2) Player, RoomState, GameSettings, RoundResult…
│  └─ scoring.ts           (F3) valores de puntuación configurables
├─ server/src/
│  ├─ index.ts · app.ts · config.ts
│  ├─ socket/              sesiones, middleware, registro de handlers
│  ├─ rooms/               (F2) RoomManager, Room, generador de códigos
│  ├─ game/                (F3) GameEngine, máquina de estados, selección de banderas
│  │  └─ modes/            (F7) normal, pixelated, cropped, grayscale, similar, bomb
│  ├─ answers/             (F3) normalize, matcher · (F4) distance (Damerau-Levenshtein)
│  └─ data/                (F3) countries.json generado + overrides.ts curado
├─ server/flags/           (F3) 195 SVG de Wikimedia, con su proporción oficial
├─ client/src/
│  ├─ net/                 socket, conexión, reloj
│  ├─ store/               Zustand
│  ├─ screens/             Nickname, Menu, (F2) Lobby, (F3) Game, (F5) Results
│  ├─ components/          Button, Logo, CodeInput, ConnectionBadge, LanguageSelector, …
│  ├─ i18n/                (F7) en.ts · es.ts · tipo Dictionary sacado del inglés
│  ├─ audio/               (F6) SoundManager + sonidos sintetizados (placeholders)
│  └─ styles/              theme.css (todos los colores) + global.css
└─ scripts/                (F3) build-countries.ts · build-flags.ts
```

---

## 4. Multiplayer

- **Sesión:** al conectar, el servidor emite un token secreto (48 hex) + un `playerId` público.
  El cliente guarda el token en `sessionStorage` (uno por pestaña) y lo reenvía en cada reconexión.
  F5, cortes de wifi o bloqueo del celular → vuelve a la misma sesión, party y puntaje.
- **Cliente → servidor:** solo *intenciones* con ack: `party:create`, `party:join`, `party:kick`,
  `party:updateSettings`, `game:start`, `game:answer`, `game:rematch`.
- **Servidor → cliente:**
  - `room:state` → snapshot completo y público de la party (jugadores, host, settings, fase)
    **y de la partida en curso** (`game`: fase, instantes, bandera, marcador, revelación).
    Snapshots completos en vez de diffs: con ≤30 jugadores pesan poco y una reconexión se
    resincroniza sola.
  - `room:left` → te fuiste, te expulsaron o se cerró la party.

  > **Decisión (Fase 3).** El plan original preveía además eventos puntuales
  > (`round:start`, `round:playerAnswered`, `round:reveal`, `game:end`). Se resolvió con un
  > único `room:state` que incluye el snapshot de la partida: los eventos puntuales habrían
  > duplicado estado que ya viaja en el snapshot, y esa duplicación es justo donde aparecen
  > las divergencias entre lo que cree el cliente y lo que decidió el servidor. Con un solo
  > camino, reconectarse en medio de una ronda no necesita ninguna lógica especial.
  > Si más adelante hacen falta disparadores puntuales (sonidos, animaciones), se agregan
  > como avisos *sin estado* encima del snapshot.
- **Validación:** todo payload se valida en servidor (`safeHandler`: tipo, tamaño, permisos).
  Un payload basura responde `BAD_REQUEST` y nunca tira el proceso.

---

## 5. Parties

- **Código:** 5 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O/1/I/L), ~28 M combinaciones, se verifica que no exista.
- **Room:** `{ code, hostId, players, settings, phase: 'lobby' | 'playing' | 'results', game? }`.
- **Unirse — errores claros:** `INVALID_CODE` (formato), `NOT_FOUND`, `FULL` (12 máx.), `NICK_TAKEN`
  (comparación sin mayúsculas ni tildes), `KICKED`. Si la partida ya empezó, entra **en espera** y juega la revancha.
- **Host:** único que puede empezar, configurar y expulsar (verificado en servidor).
  Si se va → pasa al jugador conectado más antiguo. Si se desconecta → 15 s de gracia y luego se transfiere.
- **Desconexión:** el jugador queda marcado `connected: false` (se ve en gris). En el lobby se elimina a los 30 s;
  en partida sigue en el ranking hasta el final. Party vacía → se borra a los 60 s.
- **Expulsión:** el `playerId` queda bloqueado en esa party hasta que se cierre.
- **La bandera entra entera:** la tarjeta es 4:3 y la fila de la grilla se declara
  `minmax(0, 1fr)`, no `auto`. Con `auto` la fila crecía hasta la altura de la imagen y el
  `max-height: 100%` de la bandera se resolvía contra esa fila ya estirada, o sea no
  limitaba nada: las seis banderas más altas que 4:3 (Nepal, Suiza, Vaticano, Bélgica,
  Níger, Mónaco) se desbordaban y el `overflow: hidden` les cortaba arriba y abajo. Una
  cuadrada recortada así se ve como un rectángulo ancho, que era el síntoma reportado.
- **Bandera centrada:** durante la partida la grilla tiene **tres** columnas y no dos
  —tabla, bandera y una tercera vacía del mismo ancho que la tabla— para que la bandera
  caiga en el centro de la pantalla y coincida con el encabezado, que también se centra ahí.
  Con dos columnas se centraba el bloque entero y la bandera quedaba corrida a la derecha
  justo el ancho de la tabla. Debajo de 1000 px se apila: la tabla arriba, la bandera abajo.
- **Visibilidad:** una party es `private` (solo con el código) o `public` (aparece en
  el buscador). Se elige al crearla y el host la cambia cuando quiera. Vive en `RoomState`,
  no en `GameSettings`: no cambia nada de cómo se juega. Solo se listan las que están en
  el lobby y con lugar; entrar a una partida en curso te deja mirando hasta la revancha,
  que está bien si te pasaron el código pero es una pésima primera impresión desde una lista.
- **Settings:** las tres capas los tratan distinto pero con una sola regla. El socket
  desconfía del input (`parseSettingsPatch`), la sala hace cumplir (`isValidSettings`)
  y el lobby pregunta por adelantado (`maxFlagsPerRoundFor`, `fitsInGame`) para no
  ofrecer combinaciones que el servidor va a rechazar. Todas viven en
  `shared/src/validation.ts` y salen del mismo `MAX_FLAGS_PER_GAME`.

---

## 6. Sincronización de rondas

Máquina de estados por party, controlada por timers del servidor:

```
LOBBY → COUNTDOWN (3 s) → FLAG_ACTIVE (N s) → REVEAL (4 s) ─┬─→ FLAG_ACTIVE (siguiente bandera)
                                                             ├─→ ROUND_SUMMARY (ranking, 5 s) → …
                                                             └─→ RESULTS → (revancha) → LOBBY
```

- El servidor elige la bandera y anuncia **instantes absolutos**: `{ roundId, flagUrl, startsAt, endsAt }`.
- **Reloj:** cada cliente mide su desfase con `time:sync` (ya implementado en Fase 1) y anima la barra de
  tiempo localmente con `requestAnimationFrame`. Nada de un mensaje por segundo.
- **Tiempo de respuesta:** lo mide el servidor al recibir (`recibido − startsAt`). El cliente no puede mentirlo.
- **Una respuesta por bandera.** El resto solo ve "Juan ya respondió" (sin saber si acertó).
- La bandera termina cuando vence el tiempo **o** cuando todos los conectados respondieron.
- **Anti-trampa básica:** durante la bandera activa la imagen se pide por un token aleatorio
  (`/flag/r/8f3a…`), no por `ar.svg`, así el código del país no aparece en DevTools. Se revela recién en `round:reveal`.
- **Rondas (1/2/3/5):** una ronda = N banderas seguidas y luego un resumen con ranking.
  **Ganar una ronda suma un punto al marcador general**, como los sets del tenis: por eso una
  partida de una sola ronda es válida (es la partida rápida) y por eso una ronda tiene que ser
  un bloque con sustancia, no dos o tres banderas.
- **"Banderas por ronda" (5 a 100):** no es una lista de opciones, el host **escribe el número**.
  Tope: 100 banderas por partida (≈32 min máx.), así que con más rondas entran menos banderas
  en cada una. El cliente ajusta solo el máximo escribible y tacha las rondas que no entran;
  el servidor lo valida igual.

---

## 7. Respuestas en cualquier idioma

1. `scripts/build-countries.ts` genera `countries.json` desde i18n-iso-countries (78 idiomas).
2. `overrides.ts` (curado a mano) corrige y agrega lo que falta. Ejemplos reales del dataset:
   - Faltan: "EEUU", "Holanda", "Corea del Sur" (solo trae "República de Corea"), "Birmania", "Suazilandia".
   - Conflictos: en inglés "Congo" figura **tanto** para RD Congo como para República del Congo; en alemán "Kongo" aparece para RD Congo.
3. Al iniciar, el servidor arma un índice `nombreNormalizado → Set<countryId>`.
4. El build **falla si un nombre apunta a dos países** y no está declarado como ambiguo → los errores de datos se detectan antes de jugar.
5. No hay selección de idioma: se busca el texto en todos los nombres de todos los países.

---

## 8. Fuzzy matching

**Normalización** (misma función para el índice y para lo que escribe el jugador):
Unicode NFKD → quitar tildes → minúsculas → `ß→ss`, `æ→ae`, `ø→o`, `ł→l` → guiones/apóstrofes a espacio →
quitar puntuación → colapsar espacios → quitar artículos iniciales (`the`, `la`, `el`, `les`, `die`…).

**Decisión, en orden:**

| # | Caso | Resultado |
|---|---|---|
| 1 | Coincide exacto con un nombre del país correcto | ✅ Perfecta |
| 2 | Coincide exacto con un término ambiguo que incluye al correcto ("Congo", "Corea") | 🟡 "Sé más específico" — no gasta el intento |
| 3 | Coincide exacto con **otro** país ("Níger" cuando es Nigeria, "Chine" cuando es Chile) | ❌ Incorrecta |
| 4 | Fuzzy: distancia Damerau-Levenshtein contra **todos** los nombres de **todos** los países | ✅ "Casi" solo si el mejor candidato es el país correcto, está dentro de la tolerancia y le gana al mejor de otro país por ≥ 1 edición. Empate → 🟡 ambiguo |
| 5 | Nada de lo anterior | ❌ Incorrecta |

**Tolerancia según largo del nombre candidato:**

| Largo | Errores permitidos |
|---|---|
| ≤ 4 (Perú, Irán, Cuba, Chad) | 0 |
| 5–7 | 1 |
| 8–11 | 2 |
| ≥ 12 | 3 |

Damerau cuenta una transposición como 1 error: `Argnetina` = 1, `Argentin` = 1, `Argentinaa` = 1 → aceptadas.
`Brasil` para Argentina está lejísimos de cualquier tolerancia → incorrecta. `Austrlia` queda a 1 de *Australia* y a 1 de *Austria* → empate → ambiguo.

**Confianza** = `1 − distancia / largo`. Se usa para la puntuación (perfecta 100 %, 1 error 80 %, 2+ errores 70 %).
Con ~250 países × ~20 nombres cada respuesta compara ~5 000 strings cortos: < 1 ms.

---

## 9. Datos de cada bandera

```ts
interface Country {
  id: string;                       // ISO 3166-1 alpha-2: "AR" → imagen flags/ar.svg
  emoji: string;                    // "🇦🇷" solo decorativo (Windows no dibuja emojis de banderas)
  displayName: { es: string; en: string };
  names: Record<string, string[]>;  // { es: ["Argentina"], de: ["Argentinien"], … 78 idiomas }
  aliases: string[];                // "República Argentina", "Argentine Republic"
  difficulty: 'easy' | 'medium' | 'hard';
  continent: 'africa' | 'americas' | 'asia' | 'europe' | 'oceania';
  similarTo?: string[];             // ["TD"] → modo banderas parecidas
  tags?: string[];                  // futuro: "territory", "historical"
}
```

Conjunto inicial: 193 miembros de la ONU + Vaticano y Palestina (observadores). Territorios (Groenlandia,
Puerto Rico…) y banderas históricas quedan preparados vía `tags`, desactivados por defecto.

---

## 10. MVP (Fases 1–5)

**Incluye:** nickname · crear party · código + copiar + ocultar · unirse con código · lobby con host 👑 · expulsar ·
transferencia de host · dificultad (fácil/medio/difícil/todas) · rondas (1/2/3/5, 1 punto cada una) · banderas por ronda (5–100, escritas) ·
tiempo por bandera (10/15/20/30 s) · opción de jugar solo · banderas como imagen · misma bandera para todos ·
respuestas multilingües · fuzzy matching · puntuación con bonus por velocidad y penalización · rachas ·
ranking en vivo · barra de tiempo con tensión final · revelación por jugador · resultados con estadísticas ·
revancha manteniendo party · desconexión y reconexión.

**Puntuación** (implementada en la Fase 3; editable en `shared/src/scoring.ts`):

```
correcta = redondear((100 × precisión + bonusVelocidad) × multiplicadorRacha)
  precisión:        perfecta 1.0 · 1 error 0.8 · 2+ errores 0.7
  bonusVelocidad:   hasta +50, proporcional al tiempo restante
  racha:            3–4 ×1.5 · 5–9 ×2 · 10+ ×3
incorrecta = −50 (pierde racha) · tiempo agotado = 0 (pierde racha) · el total no baja de 0
```

**No incluye (post-MVP):** modos especiales, modo bomba, sonidos reales, equipos/eliminación/torneo,
estadísticas persistentes, cuentas.

---

## 11. Fases

| Fase | Contenido | Resultado ejecutable |
|---|---|---|
| **1 ✅** | Monorepo, shared tipado, servidor Express + Socket.IO, sesiones con reconexión, reloj sincronizado, pantalla de nickname y menú, tema visual | Abrís 2 pestañas y ves el contador online en vivo; F5 conserva la sesión |
| **2 ✅** | RoomManager, crear/unirse, errores, lobby, host, expulsar, transferencia, settings (solo host edita) | Parties reales entre varias personas |
| **3 ✅** | Dataset de países, GameEngine, máquina de estados, timer sincronizado, pantalla de juego, respuestas (match exacto) | Partidas completas con la misma bandera para todos |
| **4 ✅** | Normalización + fuzzy + multidioma con tests, puntuación, velocidad, rachas, ranking, revelación | El núcleo competitivo |
| **5 ✅** | Resultados + estadísticas, resumen por ronda, revancha, desconexiones en partida, jugadores en espera | **MVP completo** + guía de deploy |
| **6 ✅** | Pulido: animaciones de racha/ranking, tensión final, SoundManager con placeholders | Se siente party game |
| **7 ✅** | `GameMode` modular: pixelada, recortada, grises, parecidas, modo bomba | Modos opcionales |
| 8 (opcional) | Estadísticas persistentes (SQLite), modos futuros | — |

### Modos (preparado desde la Fase 3)

```ts
interface GameMode {
  id: 'normal' | 'pixelated' | 'cropped' | 'grayscale' | 'similar' | 'bomb';
  pickFlags?(pool: readonly Country[], howMany: number): Country[];  // "parecidas" arma pares
  presentation?: FlagPresentation | null;   // el cliente aplica el efecto visual
  flagDurationMs?(ctx: FlagContext): number; // la bomba acorta la mecha
  missPenalty?: number;                      // explosión → penalización
}
```

> **Decisión (Fase 7).** Los ganchos **devuelven valores** en vez de mutar un `RoundContext`,
> como preveía el boceto. El motor sigue siendo el único dueño del estado de la partida, así
> que ningún modo puede dejarla inconsistente; y un modo se testea llamando a sus funciones,
> sin levantar una partida entera.
>
> La **bomba** se resolvió como una mecha que se acorta bandera a bandera dentro de la ronda,
> más una penalización por dejarla explotar. La idea original ("la bomba pasa de jugador")
> implicaba turnos, y todo el juego está construido sobre que **todos responden a la vez**:
> convertirlo en por turnos habría sido otro juego, no un modo.

El GameEngine no conoce los modos concretos: llama a estos hooks. Agregar "Supervivencia" o "Equipos"
es sumar un archivo en `game/modes/` sin tocar el motor.

---

## 12. Idioma de la interfaz

Es distinto de la sección 7: **responder** funciona en 78 idiomas y no depende de nada;
esto es en qué idioma está escrita la pantalla. Hay dos, inglés (por defecto) y español
neutro, y es una preferencia **del aparato, no de la party**: dos jugadores de la misma
partida pueden estar leyendo cada uno en el suyo.

- `client/src/i18n/en.ts` es el idioma de referencia y también el molde: el tipo
  `Dictionary` sale de él con un mapeo que ensancha los literales. Agregar una clave sin
  traducirla al español **rompe el typecheck** en vez de aparecer vacía en pantalla.
- Los textos con partes variables son funciones (`roundWinner(names, many, points)`), no
  plantillas con huecos: así el orden de las palabras es libre en cada idioma.
- El diccionario se lee con `useT()` dentro de componentes y con `t()` fuera (la capa de
  conexión, los avisos). Fuera de React se traduce **en el momento de mostrar**, nunca al
  cargar el módulo: si no, el texto quedaría fijado en el idioma que había al arrancar.

> **Decisión.** El servidor **nunca manda texto** para mostrar: manda códigos de error
> (`NICK_TAKEN`) y nombres en los dos idiomas (`LocalizedName { es, en }` en la revelación
> de la bandera y en las opciones de una respuesta ambigua). Es un poco más de bytes por
> snapshot, pero es lo que permite que cada cliente elija sin preguntarle nada al servidor
> ni tener que avisarle cuando alguien cambia de idioma a mitad de partida.
>
> El nombre y la descripción de cada modo se fueron de `shared/constants.ts` al diccionario
> del cliente. En `GAME_MODES` quedó solo lo que no depende del idioma: el `id` y el emoji.

> **Decisión.** El idioma inicial **no** mira el del navegador: es inglés hasta que alguien
> elija otro, y a partir de ahí se recuerda en `localStorage`. El juego se comparte por
> link, y es más previsible que todos vean lo mismo al abrirlo.

---

## 13. Buscador de salas públicas

`party:list` devuelve un array de `PublicParty` y nada más. Es una **consulta puntual, no
una suscripción**: mientras el buscador está abierto el cliente la repite cada 5 s, y al
salir deja de pedir. Con las decenas de salas que aguanta una instancia, repetir la
consulta sale más barato que mantener un canal de novedades por cada persona parada en el
buscador — y no hay estado de suscripción que limpiar cuando alguien cierra la pestaña.

> **Decisión.** `PublicParty` es deliberadamente más pobre que `RoomState`: no lleva ids
> de jugadores, ni sus nombres, ni el estado de la partida. Quien todavía no entró no
> tiene por qué ver nada de eso. Hay un test que fija exactamente qué campos viaja, para
> que agrandar el listado sea una decisión y no un descuido.

> **Decisión.** El listado **no pide nickname**: mirar qué hay se puede hacer antes de
> decidir nada. Entrar sí lo pide, como siempre.

> **Decisión.** Se listan solo las parties en fase `lobby` y con lugar. Una partida en
> curso deja al que entra mirando hasta la revancha, que con 100 banderas puede ser media
> hora. Está bien cuando te pasaron el código y sabés a qué vas; es una pésima primera
> impresión para alguien que entró desde una lista.

---

## 14. Caché de las banderas

Todas las URLs de banderas llevan `?v=<sello>`, donde el sello es el mtime más nuevo
de `server/flags/` en base 36. El servidor lo arma para la revelación, y lo manda en
`session:ready` para que el fondo decorativo —que construye sus propias URLs— pueda
usar el mismo.

> **Decisión.** El fondo no dibuja nada hasta que llega el sello, en vez de pedir las
> banderas sin versión y arreglarlas después. Pedirlas sin versión las resuelve contra
> la caché del navegador, y una entrada guardada bajo la política vieja (`maxAge: 7d`,
> de cuando las banderas venían de `flag-icons`) se considera fresca durante días: el
> navegador ni siquiera vuelve a preguntar, así que ningún cambio de cabeceras en el
> servidor la desaloja. Versionar la URL es lo único que deja esas entradas
> inalcanzables sin pedirle a nadie que limpie la caché a mano.
>
> El costo es unos milisegundos sin fondo al abrir. Es decoración: no se nota.

---

## 15. Modo parpadeo: por qué el reloj no es el del servidor

`flash` es el único efecto que depende del tiempo en términos absolutos y no de una
fracción del turno: medio segundo es medio segundo, ponga el host 10 o 30 segundos por
bandera. Por eso `FlagPresentation` lleva `visibleMs`, que el servidor manda en el
snapshot y el cliente hace cumplir.

> **Decisión.** La cuenta de esos milisegundos arranca **cuando la imagen terminó de
> cargar**, no cuando arrancó la bandera. La primera versión usaba el reloj del servidor,
> que es lo que hace todo el resto del juego, y medido sobre una conexión real resultó
> injugable: la bandera activa se pide con `no-store` —es el anti-trampa, el token cambia
> en cada bandera— así que nunca está en caché y tardaba ~340 ms en llegar. De un fogonazo
> de 450 ms el jugador alcanzaba a ver **30**. Y como cada uno tiene su conexión, cada uno
> veía una cantidad distinta: lo peor posible para un modo que se trata de cuánto viste.
>
> El precio es que quien tiene peor conexión la ve más tarde, responde más tarde y cobra
> menos bonus de velocidad. Pero la ve, que es el punto.
>
> Si la imagen no llega en 3 segundos (`FLASH_LOAD_GRACE_MS`) el fogonazo se da por
> perdido. Esa misma regla cubre al que se reconecta con la bandera ya empezada: encuentra
> el hueco tapado en vez de recibir medio segundo gratis a destiempo.

> **Medición.** Con el juego publicado por un túnel: imagen lista a los ~340 ms, tapada
> 480 ms después. Antes de la corrección, 30 ms de bandera visible.

---

## 16. Paleta

Todos los colores viven en `client/src/styles/theme.css`. El fondo es azul profundo
neutro: antes era violeta y teñía las banderas, que son lo único que tiene que tener
color en pantalla.

> **Ranking.** La cabecera y las filas comparten los tracks con `subgrid`, no con dos
> `grid-template-columns` idénticos. Declaraciones iguales no dan columnas iguales cuando
> hay `auto`: cada grilla mide sus tracks con su propio contenido, así que la cabecera se
> acomodaba a "PUNTOS TOTALES" y la fila a "279", y los números quedaban corridos respecto
> de su etiqueta. Con subgrid el track mide lo que necesite el más ancho de los dos, en
> cualquier idioma y sin anchos escritos a mano.

> **Decisión.** Los dos rellenos translúcidos que se repetían —el de los paneles que
> flotan sobre el fondo y el de los huecos hundidos dentro de una tarjeta— pasaron a ser
> tokens (`--panel-rgb`, `--sunken-rgb`). Estaban escritos a mano en diez archivos, así
> que cambiar el fondo obligaba a buscarlos uno por uno y cualquiera que se escapara
> quedaba del color viejo. Van como tripletas RGB y no como color porque cada lugar los
> usa con su propia opacidad: `rgba(var(--panel-rgb), 0.72)`.

> **Ícono.** El mismo degradé (rosa → naranja) está en dos lugares:
> `client/public/favicon.svg` con colores literales, porque un favicon no puede leer
> variables CSS, y `client/src/components/Logo.tsx` con los tokens. Si cambian los colores
> hay que cambiar los dos; ambos archivos lo dicen.
>
> En el favicon el degradé va en el **cuadro** y la bandera es blanca; en el logo va en la
> **tela**, porque ahí la bandera va suelta sobre el fondo y no hay cuadro donde ponerlo.
>
> El cuadro va lleno de color a propósito: entre muchas pestañas, un ícono oscuro sobre el
> fondo oscuro del navegador no se encuentra. Y son pocas partes y gruesas —mástil ancho,
> una sola tela, una sola onda— porque tiene que leerse a 16px.
>
> El botón sin variante —JUGAR y Enviar, los dos únicos del juego— usa el naranja del
> degradé y no el amarillo: son la acción principal de su pantalla y conviene que sean del
> color de la marca. El borde del campo de nickname al enfocarlo va por lo mismo: está
> justo debajo del logo.
>
> La palabra FLAGAZO recorre el mismo degradé: cada letra saca su color de su posición
> (`--i` sobre `--last`, que pone el componente) con `color-mix`, en vez de tenerlo
> escrito. Así los dos extremos siguen viviendo solo en `theme.css` y tocar el degradé
> cambia el ícono y la palabra a la vez.


---

## 18. Publicidad

Dos espacios: el lobby y la pantalla final. Los dibuja `client/src/components/AdSlot.tsx`.

> **Decisión.** No hay ningún espacio **dentro de la partida**. El juego es a contrarreloj
> y en el modo Parpadeo la bandera se ve menos de medio segundo: un anuncio al lado compite
> con lo único que el jugador tiene que mirar. El resumen entre rondas dura 5 segundos, que
> no alcanza ni para que cargue: mostrar un hueco que nunca se llena es peor que no ponerlo.

> **Decisión.** El script de la red se carga **desde el componente y solo si hay publicidad
> configurada**, en vez de estar fijo en `index.html`. Sin las variables de entorno no entra
> ningún script de terceros, que es mejor para la velocidad y para la privacidad de quien
> juega — y deja el juego idéntico a como estaba para quien lo despliegue sin monetizar.

> **Decisión.** El espacio se reserva con `min-height` desde el primer pintado. Si el
> anuncio apareciera de golpe empujando los botones, alguien que está por tocar "Empezar"
> termina tocando otra cosa.
>
> Si a los 2,5 s no se llenó —bloqueador, que en público que juega es frecuente, o falta de
> inventario— el espacio se **pliega**. Plegar mueve un poco el layout, pero la alternativa
> es un rectángulo gris vacío para siempre, que se ve roto.

> **Nota.** Falta el banner de consentimiento para tráfico europeo. Es obligatorio para
> AdSense y no está: hay que elegir una CMP y enchufarla antes de servir anuncios en la UE.


---

## 19. El botón de donar

`client/src/components/DonateButton.tsx`. Un `<a>` a una URL que viene de
`VITE_DONATE_URL`; si no está configurada, el componente devuelve `null`.

> **Decisión.** El destino por defecto está en el código y `VITE_DONATE_URL` lo pisa.
> Al principio iba **solo** por entorno, para que el repositorio no llevara el link de
> cobro de nadie. Salió mal: en el primer despliegue la variable no quedó cargada y el
> botón simplemente no apareció, sin ningún error que lo delatara. El link no es un
> secreto —es un botón hecho para que lo vean— así que no había nada que proteger y sí
> un modo de fallar en silencio. El entorno queda para quien copie el proyecto.
>
> Con la variable en vacío no queda ni el markup ni los estilos en el bundle, porque Vite
> reemplaza `import.meta.env.VITE_*` al compilar: no es que se esconda, es que no existe.

> **Decisión.** Está en el **menú** y no en la pantalla final. En la final ya hay un
> espacio de anuncio; dos pedidos de plata en la misma pantalla, justo cuando la persona
> acaba de ganar o perder, se sienten a manotazo. En el menú está a mano y no interrumpe
> nada.

> **Decisión.** Es deliberadamente más callado que los botones de acción: fondo de panel y
> un solo color, el naranja del logo, en los dos extremos —el cuadrado del ícono y la
> palabra "Donar"—. Tiene que estar disponible, no competir con "Crear sala".
>
> El cuadrado del ícono va tintado y no en el gris de panel que usan los otros badges
> porque el ☕ es marrón oscuro y sobre fondo oscuro se pierde; el 🌐 y el 🔑 se sostienen
> solos. El tinte le pone el contraste que al emoji le falta.

> **Decisión.** Abre en una pestaña aparte (`target="_blank"` con
> `rel="noopener noreferrer"`). Nadie quiere perder la sala en la que está por donar.


---

## 20. Dos juegos: Flag Guess y Draw Battle

El diseño completo de Draw Battle —cómo se representa un dibujo, cómo se compara con
la bandera y por qué— está en [`DRAW_BATTLE.md`](DRAW_BATTLE.md). Acá solo lo que
cambió en la arquitectura general.

> **Decisión.** Los 7 modos que ya existían (normal, pixelado, bomba…) resultaron ser
> *variantes* del mismo juego: comparten fases, entrada y puntuación. Draw Battle no
> entra en ese molde, así que va **un nivel arriba**: `GameSettings.kind` elige el juego
> y `mode` sigue siendo la variante de Flag Guess. Renombrar `mode` a "variante" en
> todo el código no cambiaba ningún comportamiento, así que se dejó.

> **Decisión.** `RoomManager` habla con una interfaz `Game`
> (`server/src/game/Game.ts`): arrancar, conexiones, bajas, renombres, snapshot y
> `dispose`. La sala, el host, las gracias de desconexión y la revancha funcionan igual
> para los dos juegos sin saber cuál es. Lo propio de cada uno (`answer`,
> `submitDrawing`) se pide después de mirar `kind`; si no corresponde, `WRONG_GAME`.
> Un tercer juego es un motor más y un caso en `createGame`.

> **Decisión.** El snapshot es una unión discriminada:
> `GameSnapshot = GuessSnapshot | DrawSnapshot`. El cliente elige la pantalla con
> `kind`, y TypeScript no deja leer un campo de un juego en la pantalla del otro.

> **Decisión.** La configuración es plana, con los campos de los dos juegos lado a lado
> (`drawRounds`, `drawSeconds`, `drawPrompt` junto a `totalRounds`…). Cambiar de juego y
> volver no pierde lo elegido, y un cambio parcial sigue siendo un objeto con las claves
> que cambian. Por eso `isValidSettings` valida los campos de los dos juegos siempre.

> **Nota.** El límite por mensaje de Socket.IO pasó de 16 KB a 64 KB. Sigue siendo una
> protección contra abusos; el dibujo más grande que permiten los topes ronda los 48 KB.

## 21. Cuentas de usuario

Las cuentas son **opcionales**: se sigue entrando con un nickname y jugando sin
registrarse. Una cuenta guarda el perfil y, en las próximas fases, estadísticas y
rankings. Se construyen por fases; esta sección describe lo que ya existe.

**Estado actual: Fase 7** — base de datos, registro y login con email y contraseña,
verificación del email, recuperación de la contraseña, "Continuar con Google" y
"Continuar con Discord", perfil con foto, la cuenta integrada a las salas,
estadísticas y ranking mensual.

> **Decisión.** Postgres con Drizzle ORM. Es la primera persistencia del proyecto y
> guarda **solo** cuentas y sesiones: las parties y las partidas siguen en memoria, y un
> invitado nunca toca la base. Drizzle es TypeScript puro, sin binarios, y genera
> migraciones SQL que quedan en `server/drizzle/` y se aplican al arrancar el servidor
> (una sola instancia: no hay carreras entre procesos).

> **Decisión.** La base no está en Render: el Postgres gratis de Render vence a los 30
> días y el disco del plan gratis se borra en cada deploy. Se usa Neon (Postgres
> estándar, región Ohio como el servidor). Mudarla es cambiar `DATABASE_URL`.

> **Decisión.** Sin `DATABASE_URL`, en producción las cuentas se apagan (`/api/me`
> responde `accountsEnabled: false` y el cliente no muestra nada) y el juego funciona
> igual. Si la base no responde al arrancar, lo mismo. En desarrollo se usa PGlite
> (Postgres en WebAssembly, dentro del proceso) guardado en `server/.data/`, y los tests
> usan PGlite en memoria: no hay que instalar Postgres ni Docker.

> **Decisión.** Sesión en el servidor con cookie `HttpOnly`, no JWT. Hay una sola
> instancia con base de datos, y cerrar sesión o cambiar la contraseña tiene que cortar
> el acceso en el momento; con JWT haría falta una lista de revocación, que es volver a
> tener sesiones pero con más piezas. En la base se guarda el SHA-256 del token, nunca el
> token. La cookie es `SameSite=Lax`, `Secure` detrás del HTTPS de Render (`trust proxy`
> en 1 salto), y dura 30 días renovables con "mantener sesión" o hasta cerrar el
> navegador (con tope de 24 h en el servidor) sin él.

> **Decisión.** El token de juego (`sessionStorage`, uno por pestaña) **no cambia**. No
> es una credencial: identifica al jugador dentro de las salas y permite varias pestañas
> como jugadores distintos. La cuenta es otra capa, que en la Fase 5 se engancha a la
> sesión de juego en el handshake del socket.

> **Decisión.** Argon2id (`@node-rs/argon2`, 19 MiB, 2 pasadas) para las contraseñas.
> scrypt con parámetros equivalentes pide más de 100 MB por hash, y el plan tiene 512 MB.
> Las reglas de contraseña siguen NIST: largo mínimo 8, sin exigir símbolos, rechazando
> las más comunes y el propio email o username.

> **Decisión.** CSRF en capas: cookie `SameSite=Lax`, cuerpo solo JSON, y chequeo de
> `Sec-Fetch-Site` (o `Origin` contra `Host` en navegadores viejos) en toda escritura.

> **Decisión.** Login sin enumeración: cuenta inexistente y contraseña incorrecta
> responden lo mismo y tardan lo mismo (se hashea igual). Límites en memoria por IP y
> por email.

> **Decisión.** Todo lo que se puede pedir con solo un email responde **siempre igual**:
> registrarse, reenviar el código, recuperar la contraseña. Lo distinto se le dice al
> dueño del email, por email. Registrarse con un email que ya tiene cuenta responde lo
> mismo que uno nuevo y al dueño le llega "ya tienes una cuenta" (uno por hora como
> mucho). Por eso registrarse **no inicia sesión**: se entra al verificar el código.

> **Decisión.** Códigos de 6 dígitos (`AUTH_CODE` en `shared`): vencen a los 10 minutos,
> se usan una vez, admiten 5 intentos, y se pueden pedir cada 60 s y hasta 5 por hora
> (25 intentos por hora contra un millón de combinaciones). Se guarda un HMAC-SHA256 con
> `AUTH_SECRET`, que incluye la cuenta y el propósito: un SHA-256 simple de 6 dígitos se
> revierte en un segundo. Solo vale el **último** código emitido, usado o no; si se mirara
> "el último sin usar", al usar uno el anterior volvería a servir. Consumir y sumar
> intentos son `UPDATE` condicionales, así dos pedidos simultáneos no usan el mismo código.

> **Decisión.** Los errores de código distinguen incorrecto, vencido y bloqueado. Los dos
> últimos revelan que ese email tiene un registro pendiente de verificar. Es una filtración
> chica y aceptada: sin ella no se le puede decir a nadie "tu código venció". "Ya
> verificado" solo se responde a quien trae el código que ya se usó.

> **Decisión.** Con la contraseña correcta y el email sin verificar, el login responde
> `EMAIL_NOT_VERIFIED` y manda un código: quien sabe la contraseña ya es el dueño.
> Recuperar la contraseña verifica el email (el código lo prueba) y cierra todas las
> sesiones abiertas. Las cuentas que no verifican en 7 días se borran y liberan el nombre.

> **Decisión.** Los emails salen por la API HTTPS de Resend, no por SMTP: el plan gratis
> de Render bloquea los puertos 25, 465 y 587. El remitente es `flagazo@flagazo.com`;
> Resend usa el subdominio `send.flagazo.com` y `resend._domainkey`, así que no toca el
> MX ni el SPF de Google Workspace en la raíz. Se mandan sin esperar la respuesta (el
> registro tarda lo mismo haya o no email que mandar) y un fallo solo se loggea, sin
> asunto ni texto porque llevan el código. En desarrollo el email se escribe en la
> consola del servidor.

> **Decisión.** Google y Discord con OAuth 2.0 (código de autorización), sin librerías:
> son dos pedidos HTTP y la parte delicada, el `state`, conviene tenerla a la vista. El
> `state` y el verificador PKCE (Google lo soporta; Discord se cubre con `state` y el
> secreto) viajan en una cookie HttpOnly firmada con `AUTH_SECRET`, de 10 minutos y
> `Path=/api/auth`. Así la vuelta queda atada al navegador que empezó: si alguien le
> hace abrir a otro el link de vuelta con su propio código, el `state` no coincide y la
> víctima no queda adentro de la cuenta del atacante. El perfil se pide al endpoint
> oficial con el token recién obtenido, así que no hace falta validar firmas de JWT.

> **Decisión.** Las identidades (`auth_identities`) se buscan por el id del proveedor
> (`sub` en Google, `id` en Discord), nunca por el email, que en el proveedor cambia.
> Al volver, en orden: (1) ya vinculado → esa cuenta; (2) el proveedor **garantiza** el
> email y hay una cuenta con él → se vinculan, y si esa cuenta nunca verificó su email se
> le borra la contraseña y se cierran sus sesiones, porque quien la creó no demostró que
> el email fuera suyo y el proveedor sí (evita el "pre-hijacking"); (3) el email coincide
> pero **no** está garantizado → `OAUTH_EMAIL_IN_USE`, ni se vincula ni se duplica; (4)
> cuenta nueva, con email solo si está verificado. Con una sesión iniciada, el mismo
> flujo vincula en vez de entrar. El username sale del nombre del proveedor, limpio para
> que cumpla las reglas del nickname y con un número si está ocupado. La foto del
> proveedor se guarda en la identidad para ofrecerla como avatar en la Fase 4.

> **Decisión.** Las fotos de perfil se guardan **en Postgres** (`avatars`, `bytea`), no en
> disco ni en un almacenamiento de objetos: el disco del plan gratis de Render se borra en
> cada deploy, y R2/S3 sumarían otra cuenta y otras credenciales para unos pocos KB por
> jugador. Cada foto se procesa con `sharp`: se decodifica (lo que no abra como JPG, PNG o
> WebP se rechaza, diga lo que diga la extensión), se limita a 4096 px por lado antes de
> abrirla (contra "bombas" de píxeles), se recorta a 256×256 y se vuelve a codificar en
> WebP sin metadatos (EXIF, GPS). Pesa 10–25 KB. Se sirve en `/api/avatars/<id>.webp?v=N`
> con caché de un año: `N` sube con cada foto nueva. Si algún día pesan demasiado, se
> mudan a R2 sin cambiar la URL pública.

> **Decisión.** El cliente achica la foto a 512 px antes de subirla: el servidor acepta
> 2 MB y una foto de celular pesa 3–8 MB. Las fotos de Google o Discord solo se bajan
> de sus CDN (`lh3.googleusercontent.com`, `cdn.discordapp.com`), sin seguir redirecciones:
> sin esa lista, "bajá la foto de esta URL" serviría para que el servidor haga pedidos a
> la red interna (SSRF). Una cuenta nueva con Google o Discord arranca con esa foto.

> **Decisión.** Cuenta y jugador son dos cosas. El **jugador** (`RoomPlayer`) es "esta
> conexión en esta sala" y existe siempre; la **cuenta** es la persona que la usa y puede
> no haber ninguna. `RoomPlayer.account` es `{ userId, username, avatarUrl }` o `null`
> (invitado). El snapshot público solo agrega `registered` y `avatarUrl`: nada privado
> de la cuenta (email, sesión) llega a las salas. `rooms/` sigue sin saber de la base ni
> de la red: el tipo `PlayerAccount` vive en `rooms/Room.ts`.

> **Decisión.** La cuenta se asocia en el **handshake del socket**, leyendo la cookie de
> sesión que el navegador manda sola (misma página, mismo origen). Es la única prueba
> válida: el token de juego viaja en `sessionStorage` y no dice quién es la persona. Si
> la base falla, se entra como invitado. Con cuenta, el nombre de juego es el username
> (el servidor lo impone; `session:setNickname` lo ignora); si en la sala ya lo usa otro,
> se queda con el nombre que tenía. Después de iniciar sesión con contraseña, el cliente
> reconecta el socket para que el servidor lea la cookie nueva (el token de juego es el
> mismo, así que no sale de la sala). `session:refreshAccount` relee de la base la cuenta
> que la sesión **ya tenía** (nombre o foto nuevos) y no sirve para tomar otra;
> `session:signOut` la desasocia y el jugador sigue como invitado.

> **Decisión.** La misma cuenta no puede estar dos veces en una sala (`ACCOUNT_IN_PARTY`):
> dos pestañas contarían doble en las estadísticas y el ranking. Los invitados sí pueden
> abrir varias pestañas, como antes. La foto que se ve en las partidas sale del snapshot
> de la sala, no del de la partida: los motores de juego no saben nada de cuentas.

> **Decisión.** Las estadísticas se calculan **solo en el servidor**. Cada motor entrega
> `results()` al terminar (puesto, si ganó, si participó, y lo propio de su juego), y
> `RoomManager` avisa una sola vez por partida con `onGameFinished`. Las cuentas se
> fijan al empezar la partida (`room.match.accounts`): iniciar o cerrar sesión a mitad de
> partida no cambia a quién se le carga. Si grabar falla, la sala sigue igual.

> **Decisión.** Cada partida tiene un id (UUID) generado al arrancar. `StatsRecorder`
> graba todo en una transacción que empieza con `INSERT INTO matches … ON CONFLICT DO
> NOTHING`: si la partida ya estaba, no suma nada. Se escriben `match_players` (el
> resultado de cada cuenta, con el que se puede reconstruir cualquier ranking),
> `user_stats` (totales para el perfil) y `leaderboard_entries`. Los invitados no se
> graban.

> **Decisión.** El ranking es genérico: `leaderboard_entries(period, metric, user_id,
> value)`. `period` es `YYYY-MM` o `all`; las métricas hoy son `points`, `wins` y
> `correct`. **No se borra nada al cambiar de mes**: el ranking actual es una consulta
> con el mes en curso, y los anteriores quedan. El mes se decide con
> `LEADERBOARD_TIMEZONE` (UTC por defecto). Empates: mismo valor, mismo puesto; en la
> lista va primero quien llegó antes a ese valor (`updated_at`).

> **Decisión.** `points` suma los puntos de Flag Guess y los de Draw Battle × 6: una
> partida de cada juego dura parecido, pero la de adivinar deja miles de puntos y la de
> dibujar, cientos (`RANKING.drawScoreWeight`). Una partida cuenta para el ranking con
> al menos **2 jugadores que participaron** (respondieron o dibujaron), invitados
> incluidos: si no, cualquiera juega solo y suma sin límite. Las estadísticas del perfil
> se guardan igual.

> **Decisión.** Las cuentas se encienden solo con todo lo necesario: base, `AUTH_SECRET`
> (32+ caracteres) y `RESEND_API_KEY`. Con una pieza faltante quedan apagadas y el
> servidor lo dice en el log, en vez de aceptar registros que nadie podría verificar.

La API vive en `server/src/http/api.ts`, montada en `/api` antes que el frontend:

| Ruta | Qué hace |
|---|---|
| `GET /api/me` | `{ accountsEnabled, account }` |
| `POST /api/auth/register` | `{ username, email, password, remember, locale }` → 202, siempre igual; manda el código |
| `POST /api/auth/verify-email` | `{ email, code, remember }` → verifica e inicia sesión |
| `POST /api/auth/resend-verification` | `{ email, locale }` → siempre `ok` |
| `POST /api/auth/login` | `{ email, password, remember, locale }` |
| `POST /api/auth/forgot-password` | `{ email, locale }` → siempre `ok` |
| `GET /api/auth/google`, `GET /api/auth/discord` | `?remember=1` → redirige al proveedor |
| `GET /api/auth/{google,discord}/callback` | Vuelta del proveedor → redirige a `/?auth=ok|created|linked|error&reason=…` |
| `PATCH /api/me` | `{ username }` |
| `POST /api/me/avatar` | Cuerpo: la imagen (`image/jpeg`, `png` o `webp`, hasta 2 MB) |
| `POST /api/me/avatar/provider` | `{ provider }` → usa la foto de Google o Discord |
| `DELETE /api/me/avatar` | Vuelve al avatar de color |
| `GET /api/avatars/<id>.webp` | La foto, pública y cacheable |
| `GET /api/me/stats` | Estadísticas acumuladas de la cuenta |
| `GET /api/leaderboard/monthly` | `?period=YYYY-MM|all&metric=points|wins|correct` → tabla, posición propia y meses con datos. Sin `period`, el mes actual. Público |
| `POST /api/auth/reset-password` | `{ email, code, password, remember }` → cambia la contraseña, cierra las demás sesiones y entra |
| `POST /api/auth/logout` | Borra la sesión y la cookie |

El username sigue las mismas reglas que el nickname (es el nombre dentro del juego) y
es único sin distinguir mayúsculas ni tildes (`nicknameKey`).
