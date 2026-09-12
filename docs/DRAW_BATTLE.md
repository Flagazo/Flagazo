# 🎨 Draw Battle — análisis y diseño

Todos reciben el mismo país, todos dibujan su bandera de memoria al mismo tiempo, y
el servidor decide quién la representó mejor. Este documento es el análisis previo a
la implementación: cómo encaja en lo que ya existe, cómo se compara un dibujo y por qué.

---

## 1. Cómo está armado Flagazo hoy

- **Monorepo** `shared/` (contrato y reglas), `server/` (Express + Socket.IO),
  `client/` (React + Zustand).
- **El servidor decide, el cliente dibuja.** Los cambios viajan como snapshots
  completos (`room:state`), nunca como diffs. Reconectarse usa el mismo camino.
- **Salas**: `RoomManager` es dueño de las parties, el host, las gracias de
  desconexión y la revancha. `Room.game` es la partida en curso.
- **Motor**: `GameEngine` es una máquina de estados con timers
  (`countdown → flag → reveal → roundSummary → results`).

### El hallazgo que condiciona todo

Los 7 "modos" actuales (normal, pixelado, bomba…) **no son juegos distintos**: son
*variantes* del mismo juego de adivinar. Comparten fases, entrada (texto) y
puntuación; cada uno solo cambia ganchos (`presentation`, `flagDurationMs`,
`pickFlags`, `missPenalty`).

Draw Battle no entra en ese molde: otras fases, otra entrada (un dibujo), otra
puntuación y otra configuración (no hay "banderas por ronda"). Por eso va **un nivel
arriba** de los modos existentes, no al lado.

## 2. Arquitectura: juegos y variantes

```
GameSettings.kind
├── 'guess'  → FlagGuessGame   (el motor de siempre)
│              └── mode: normal · pixelated · cropped · grayscale · similar · bomb · flash
└── 'draw'   → DrawBattleGame  (nuevo)
```

- **`Game`** (`server/src/game/Game.ts`): la interfaz que `RoomManager` conoce.
  `start`, `setConnected`, `removePlayer`, `rename`, `toSnapshot`, `dispose`,
  `isFinished`. Salas, host, lobby, conexión y revancha **no se tocan**: siguen
  hablando con "una partida", sin saber cuál.
- **`createGame(settings, roster, hooks)`**: la única línea que elige el motor según
  `kind`. Agregar un tercer juego es sumar un motor y un caso acá.
- Las acciones propias de cada juego (`answer` en adivinar, `submitDrawing` en
  dibujar) se piden a la sala; si la partida en curso es de otro tipo, responde
  `WRONG_GAME`.
- **Snapshot**: `GameSnapshot = GuessSnapshot | DrawSnapshot`, discriminado por
  `kind`. El cliente elige la pantalla con eso.

Los nombres de los tipos compartidos de las variantes (`mode`, `GameModeId`) se
conservan: renombrarlos tocaría medio cliente sin cambiar ningún comportamiento.

## 3. Flujo de una ronda

```
countdown (3 s) → drawing (30–90 s) → judging (1,5 s) → reveal (11 s) ─┬→ countdown
                                                                        └→ results
```

- **drawing**: aparece el país. Cada uno dibuja en su aparato. Nada viaja mientras
  tanto, salvo un borrador cada 4 s (ver §6).
- **TERMINAR**: manda el dibujo final, bloquea el lienzo de ese jugador y el
  servidor anota el instante. Si terminan todos los conectados, la ronda se corta.
- **judging**: "⏰ ¡TIEMPO!". Existe porque el cliente manda su dibujo cuando *su*
  reloj llega a cero y eso tarda en llegar: 1,5 s de margen para aceptarlo. Quien no
  llegó cuenta con su último borrador; quien no dibujó nada, con un dibujo vacío.
- **reveal**: aparecen los dibujos, después la bandera real, después los puntajes y
  el ganador. Todo en el mismo snapshot; la animación la cronometra el cliente
  contra `startsAt`, como la barra de tiempo.

## 4. Cómo se representa el dibujo: trazos, no píxeles

| | Imagen (PNG) | **Trazos** |
|---|---|---|
| Peso | 50–200 KB | 3–15 KB |
| El límite de socket (16 KB hoy) | no entra | entra con margen |
| Pegar una imagen de la bandera | trivial: es un PNG más | **imposible por construcción** |
| Quién rasteriza para puntuar | el cliente (mentible) | **el servidor** |
| Se ve igual en todos | sí | sí (se re-dibuja) |

Un dibujo es una lista de trazos `{herramienta, color, grosor, puntos}` sobre un
lienzo lógico fijo de **600×400 (3:2)**. El servidor nunca recibe píxeles: recibe
trazos, los valida y los pinta él mismo. No hay camino por el que entre una imagen.

**Formato de cable** (`shared/src/drawing.ts`, el mismo código en cliente y
servidor): cada trazo es herramienta + grosor + color + puntos en base64, con el
primer punto absoluto y el resto como diferencias de 1 byte (con escape para saltos
largos). Los trazos se simplifican al soltar el dedo (Ramer–Douglas–Peucker).

**Lienzo 3:2 fijo para todas las banderas.** Usar la proporción real haría que Qatar
(11:28) quedara como una tira inusable en un celular, y cambiar la forma del lienzo
en cada ronda desorienta. La referencia se estira a 3:2 para comparar; en la
revelación la bandera se muestra con su proporción real.

## 5. Comparar dibujos: las tres alternativas

### A. Comparación de imágenes tradicional (píxel a píxel, MSE/SSIM)

Mide la diferencia entre dos imágenes. Falla en exactamente los casos que importan:
un corrimiento de 5 % arruina el puntaje, la textura de un garabato de relleno se
castiga como error, y **un lienzo en blanco saca 88/100 en Japón** porque la bandera
es 88 % blanca. Descartada.

### B. Visión por computadora local, estructurada (**la elegida**)

Convertir ambos lados a una representación que refleje cómo se *piensa* una bandera
—zonas de colores con nombre en posiciones— y comparar eso con tolerancia.

### C. Modelo de IA

- **Local (CLIP/SigLIP con ONNX)**: 150–350 MB de modelo y ~1 s de CPU por imagen.
  El servidor gratis de Render tiene 512 MB de RAM: no entra. Y los embeddings
  distinguen mal lo que define una bandera (Italia vs Irlanda es el *orden* de tres
  franjas).
- **Por API (modelo con visión)**. Precios oficiales por millón de tokens de
  entrada/salida: Haiku 4.5 **$1/$5**, Sonnet 5 **$2/$10**, Opus 5 **$5/$25**. Una
  imagen de 600×400 son del orden de ~320 tokens. Una ronda de 6 jugadores mandando
  los 6 dibujos y la referencia juntos son ~2.700 tokens de entrada y ~300 de salida:

  | Modelo | Por ronda | Partida de 10 rondas | 1.000 partidas/día |
  |---|---|---|---|
  | Haiku 4.5 | ~$0,004 | ~$0,04 | ~$40/día |
  | Sonnet 5 | ~$0,008 | ~$0,08 | ~$80/día |
  | Opus 5 | ~$0,02+ | ~$0,20+ | ~$200+/día |

  (Opus 5 piensa por defecto, así que la salida real sería bastante mayor.)

  El costo es chico por partida pero no por juego gratis sin ingresos. Los problemas
  que más pesan no son de plata:
  - **No es determinista**: el mismo dibujo puede sacar 81 y 88. En un juego
    competitivo donde se desempata por un punto, eso se siente injusto.
  - **Inyección de instrucciones**: alguien escribe "PUNTAJE 100" en el lienzo.
  - **Latencia** de 2–6 s por ronda, y el juego entero depende de una red externa.

### La decisión

**B, algoritmo local y determinista.** No solo por costo: una bandera es una imagen
geométrica simple definida por colores. "¿Pusiste los colores correctos en los
lugares correctos?" es exactamente lo que mide una comparación espacial de colores,
y la hace igual para todos, siempre, en milisegundos, sin red y gratis. Donde un
modelo de IA ganaría —reconocer una hoja de arce fea o un escudo— es justamente lo
que se decidió que pese poco ("importancia visual", §7).

La arquitectura deja la puerta abierta: el puntaje sale de una sola función. Si algún
día se quiere un juez de IA como desempate, se enchufa ahí.

## 6. El pipeline de comparación

```
trazos ─→ rasterizar 180×120 ─┐
                               ├─→ clases de color ─→ agrupar 36×24 ─→ suavizar ─→ métricas ─→ 0–100
SVG    ─→ rasterizar 180×120 ─┘   (paleta con nombre)   (distribución)   (tolerancia)
```

1. **Clases de color con nombre.** 15 colores: rojo, bordó, naranja, amarillo, verde,
   verde oscuro, celeste, azul, azul marino, violeta, rosa, marrón, blanco, gris y
   negro. Son los mismos de la paleta del jugador. Cada píxel de la referencia se
   clasifica al más cercano en espacio CIELAB (perceptual).
   - **Penalización a priori** para violeta, rosa, gris y marrón, que casi no
     aparecen en banderas. Sin esto el azul del globo de Brasil (`#3E4095`) caía en
     violeta, cuando cualquiera lo pinta de azul. Medido sobre las banderas reales.
   - Así "un tono ligeramente distinto" deja de existir como problema: el jugador
     elige "azul", no un hexadecimal.
2. **Similitud entre clases.** Azul y azul marino no son lo mismo, pero confundirlos
   no es como confundir azul con amarillo: azul↔marino 0,8, rojo↔bordó 0,65,
   verde↔verde oscuro 0,8, celeste↔azul 0,55, etc.
3. **Distribuciones, no colores.** Cada celda de 36×24 guarda *qué proporción* de
   cada color tiene (de sus 25 píxeles finos). Un borde tembloroso deja una celda
   60/40 en vez de 100/0: pierde poco, no todo.
4. **Tolerancia espacial.** Suavizado leve de las distribuciones y búsqueda del mejor
   corrimiento de ±2 celdas. Una bandera "ligeramente desplazada" no se castiga.
5. **Relleno de huecos.** Los huecos chicos de un garabato se completan con el color
   que los rodea antes de comparar: rellenar a mano no puede costar puntos.
6. **Lo no pintado cuenta como blanco**, como en papel. Nadie pinta de blanco sobre
   blanco.

### Referencias precalculadas

`npm run build:flag-refs` rasteriza las 195 banderas (sin antialiasing, para no
inventar colores intermedios en los bordes), clasifica cada píxel y guarda el mapa
de clases comprimido en `server/src/data/flagReferences.json`. El servidor no
depende de ninguna librería nativa en producción. El archivo lleva una huella de la
paleta: si la paleta cambia sin regenerar las referencias, un test falla.

## 7. El puntaje: ejecución × conocimiento

Cuatro señales, cada una mide algo que las otras no ven. Todas van de 0 a 1.

| Señal | Pregunta | Cómo |
|---|---|---|
| **Colores** | ¿Usó los colores de la bandera, en cantidad parecida? | Mezcla de colores de tinta, sin posición |
| **Distribución** | ¿Los puso en el lugar correcto? | F-score celda a celda sobre la tinta, con tolerancia, y respetando el blanco |
| **Forma** | ¿Ocupó el lienzo como la bandera? | Lo mismo, pero ignorando el color |
| **Elementos** | ¿Incluyó las piezas que la identifican? | Cobertura de cada región, pesada por importancia |

Las tres primeras son **ejecución**; la cuarta es **conocimiento**, y se combinan
multiplicando:

```
ejecución    = 0,3·colores + 0,5·distribución + 0,2·forma
conocimiento = elementos (se cuenta completo desde 0,88)
puntaje      = ejecución × (0,25 + 0,75·conocimiento)
```

**Por qué un producto y no una suma.** La primera versión sumaba las cuatro con pesos
fijos, y la calibración mostró que fallaba en lo más importante: **Canadá sin la hoja
sacaba 82** y **Suiza toda roja, 80**. La hoja ocupa poco y todo lo demás estaba bien
pintado, así que sumando costaba 13 puntos. Pero sin la hoja no es Canadá: el
conocimiento tiene que poder bajar el puntaje entero, no restarle una parte.

**Por qué el blanco no se regala.** La distribución mide la *tinta* (todo lo que no es
blanco): "cuánto de la tinta de la bandera reprodujiste" y "cuánta de tu tinta está
bien puesta". Un lienzo vacío no tiene tinta, así que saca 0 en Japón aunque la
bandera sea 81 % blanca. Pero cuando la bandera *tiene* blanco que importa, taparlo
cuesta: pintar encima de la cruz suiza es un error, no un detalle.

**La precisión pesa más que la cobertura** (F con β = 0,7). "Lo que dibujaste está
bien pero incompleto" vale más que "cubriste todo, incluido lo que no va". Eso a la
vez ayuda al disco de Japón dibujado chico y castiga a Japón todo rojo.

**Importancia visual (§28 del pedido).**
- La bandera se parte en regiones de un mismo color. Cada una pesa `√área`: una
  región chica pesa más de lo que ocupa.
- Las **encerradas** (que no tocan el borde: el disco de Japón, la hoja de Canadá, el
  globo de Brasil, la cruz suiza) pesan **×3**: son la identidad de la bandera.
- **Una región solo cuenta si se distingue de sus vecinas.** El disco de Japón no está
  dibujado si todo el lienzo es rojo, y la cruz suiza no existe sin el rojo alrededor.
- Los **detalles diminutos** (estrellas, letras, trazos finos de un escudo) se borran
  de una versión de la referencia, y cada celda se compara contra la bandera con y sin
  detalles quedándose la mejor. No dibujar las 50 estrellas no cuesta; dibujarlas,
  tampoco.
- La cobertura de una región es "cuánto de ella pintaste **de su color**". La primera
  versión comparaba contra la referencia suavizada y un dibujo sin hoja cobraba crédito
  por el blanco que el suavizado mezclaba en el borde de la hoja.

### Calibración

Todos los números viven en `SCORE_TUNING` (`server/src/game/draw/score.ts`) y se
ajustaron mirando `npx tsx scripts/calibrate-draw-scoring.ts`, que puntúa dibujos
armados a pinceladas —con temblor y huecos, como una persona— sobre banderas reales:

| Dibujo | Suma inicial | Final |
|---|---|---|
| Japón correcta | 98 | **98** |
| Japón con el disco a la mitad de tamaño | 46 | **39** |
| Japón todo rojo | 40 | **14** |
| Japón con el disco azul | 13 | **5** |
| Francia correcta (azul en vez de marino) | 93 | **93** |
| Francia rellenada a garabatos | 93 | **92** |
| Francia espejada | 29 | **12** |
| Italia dibujada como Irlanda | 69 | **63** |
| Alemania con el orden al revés | 52 | **16** |
| Estados Unidos sin estrellas | 83 | **79** |
| Suiza toda roja | 80 | **18** |
| Canadá sin la hoja | 83 | **63** |
| Brasil sin el globo | 74 | **55** |
| Brasil solo verde | 64 | **19** |
| Lienzo vacío, garabato de colores | 0 / 5–21 | **0 / 2–9** |

`score.test.ts` fija el **orden** (correcta > errores chicos > orden equivocado >
colores equivocados > garabato > vacío) y rangos con margen, no números exactos. Se
comprobó que rompiendo a propósito el factor de conocimiento fallan 4 de esos tests.

Puntuar un dibujo toma ~9 ms. Una sala llena (30 jugadores) son ~280 ms en una compu
normal y bastante más en el servidor gratuito, así que el motor **no los puntúa de un
bloque**: hace uno por vuelta del bucle de eventos (`setImmediate`). Si los hiciera
seguidos, el proceso quedaría sin atender a nadie ese rato: las otras salas se congelan
y, en Flag Guess, una respuesta que llega en ese lapso se mediría como más lenta y daría
menos puntos. Mientras se puntúa la ronda no acepta dibujos y los jugadores ven
"Comparando los dibujos…".

**No penalizar el estilo.** Todo el pipeline mide *qué color hay dónde*, nunca la
calidad del trazo: bordes temblorosos (distribuciones y suavizado), relleno a
garabatos (relleno de huecos), bandera corrida (búsqueda de desplazamiento) y
detalles omitidos (regiones diminutas fundidas) no cuestan casi nada. Colores
equivocados cuestan mucho.

## 8. Puntos de la partida y desempates

- Cada ronda: el primer puesto suma **+1** al marcador. Los puntos por puesto viven en
  `DRAW_SCORING.placePoints` (`[1]` hoy), así pasar a `[3, 2, 1]` es cambiar una línea.
- **Desempate**: 1) puntaje mostrado (el entero, que es lo que ven los jugadores:
  87,4 y 86,6 se ven como 87 y 87, y desempatar por lo invisible sería injusto);
  2) quien apretó TERMINAR antes; 3) si sigue empatado, comparten el puesto y el punto.
- Sin puntaje, no hay ganador: una ronda donde todos dejaron el lienzo vacío no la
  gana nadie.
- Gana la partida quien más rondas ganó.

## 9. Anti-trampa

| Trampa | Medida |
|---|---|
| Pegar o subir una imagen | El formato son trazos: no existe forma de mandar píxeles. Además se bloquean `paste` y `drop` durante el dibujo. |
| Mandar un puntaje propio | El cliente nunca manda puntajes. El servidor rasteriza y puntúa. |
| Mandar un dibujo trucado | Validación estricta: coordenadas dentro del lienzo, grosores de una lista, colores de la paleta o `#rrggbb`, tope de trazos, de puntos y de bytes. |
| Mandar fuera de tiempo | Solo se acepta en `drawing` y en el margen de `judging`, y solo para la ronda actual. Después de TERMINAR, no más cambios. |
| Mirar la bandera (modo "solo bandera") | Se sirve por token aleatorio, como en el modo de adivinar, y el token se revoca cuando se tapa. |
| Abrir otra pestaña y buscarla | No se puede impedir. Los tiempos cortos lo limitan. |

Un tramposo muy decidido podría generar trazos que rellenan la bandera por programa.
Requiere escribir código específico y no es "un clic de distancia", que es lo que
arruina una partida entre amigos.

## 10. Frontend

- **Lobby**: arriba de la configuración, el selector de juego (🎯 Flag Guess / 🎨 Draw
  Battle). Debajo, la configuración de cada uno. Las variantes de siempre pasan a
  llamarse "variante", para no tener dos cosas llamadas "modo".
- **`DrawBattleScreen`**: cuenta regresiva, lienzo + herramientas, TIEMPO, galería de
  revelación y resultados. Misma tipografía, botones, ranking y colores; el acento
  del modo es el violeta.
- **`DrawCanvas`**: eventos de puntero (mouse, touch, stylus con la misma API),
  `touch-action: none`, captura del puntero, un solo dedo a la vez, sin menú
  contextual ni zoom, escalado por `devicePixelRatio`.
- **Herramientas**: pincel (3 grosores), borrador, deshacer, rehacer, limpiar
  (deshacible) y 15 colores en una sola fila; color personalizado como opción
  secundaria. Todo a un toque, sin menús.
- **Persistencia**: el dibujo en curso se guarda en `sessionStorage` por sala y
  ronda. Un F5 en medio del dibujo lo recupera.
- **Lo que se aprendió probándolo con eventos de puntero reales**:
  - `getCoalescedEvents()` puede devolver una lista **vacía** y no `undefined`: hay que
    caer al evento mismo, o el trazo queda en un punto.
  - El pincel se lee de una referencia y no de props: un trazo empezado justo después
    de elegir un color salía del color anterior si React no había re-renderizado.
  - Si el tiempo se acaba con el dedo apoyado, `flush()` cierra ese trazo para que
    entre en el envío.
  - El lienzo se achica con el alto de la pantalla: en una notebook, la paleta quedaba
    debajo del borde y había que scrollear para cambiar de color.

## 11. Backend

- `shared/src/draw.ts`: opciones, paleta, tiempos, límites, puntos por puesto.
- `shared/src/drawing.ts`: codificar, decodificar y validar trazos.
- `server/src/game/Game.ts`: interfaz y fábrica.
- `server/src/game/FlagGuessGame.ts`: el motor de siempre, renombrado.
- `server/src/game/draw/`: `DrawBattleGame`, `color` (clases y similitud), `grid`
  (resoluciones y compresión), `raster` (trazos a clases), `pool` (celdas y suavizado),
  `references` (banderas y regiones), `score`, `fixtures` (dibujos de prueba).
- `RoomManager.submitDrawing`, evento `draw:submit`.
- `scripts/build-flag-references.ts` y `scripts/calibrate-draw-scoring.ts`.

## 12. Transmisión y almacenamiento

- **Cliente → servidor**: `draw:submit {round, drawing, final}`. Borrador cada 4 s si
  cambió; final al apretar TERMINAR o cuando se acaba el tiempo. Nada se transmite a
  los demás mientras se dibuja.
- **Servidor → clientes**: los dibujos viajan en el snapshot **solo en la revelación**,
  junto con puntajes y ranking. Con trazos simplificados un dibujo pesa entre 3 y 10 KB:
  una sala llena de 30 son del orden de 100–300 KB por revelación. Es mucho más que el
  resto de los snapshots, pero la revelación genera uno o dos, así que se aceptó. Si las
  salas crecen más, este es el primer lugar donde conviene mandar los dibujos aparte.
- **Almacenamiento**: en memoria de la partida y solo la ronda actual. Al pasar a la
  siguiente ronda se descartan. Nada va a disco.
- El límite por mensaje de Socket.IO sube de 16 KB a 64 KB: sigue siendo una
  protección contra abusos, con lugar para un dibujo detallado.

## 13. Fuera del MVP, con la puerta abierta

- Puntos por puesto (`[3, 2, 1]`): una línea.
- Ranking global / ELO: la partida ya produce puntajes deterministas por jugador y
  ronda, que es la materia prima.
- Juez de IA como desempate: se enchufa en la función de puntaje.
- Compartir dibujo: los trazos se re-dibujan en cualquier tamaño, no hace falta
  guardar imágenes.
- Búsqueda de escala (además de corrimiento) para quien dibuja la bandera más chica
  que el lienzo.
