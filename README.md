# 🏁 Flagazo

**▶ Jugá gratis en [flagazo.com](https://flagazo.com)** · sin crear cuenta · hasta 30 jugadores por sala

**▶ Play for free at [flagazo.com](https://flagazo.com)** · no account needed · up to 30 players per room

Party game multijugador en tiempo real con dos juegos:

- **🎯 Flag Guess** — todos ven la misma bandera y gana el que la reconoce primero.
- **🎨 Draw Battle** — todos reciben el mismo país, dibujan su bandera de memoria y gana el mejor dibujo.

> Estado: **Plan completo (Fases 1–7)** — parties con lobby y host, y partidas completas: la misma bandera
> para todos, timer sincronizado, puntuación con velocidad y rachas, y respuestas en
> cualquiera de 78 idiomas con tolerancia a errores de tipeo, resultados con estadísticas
> y 7 modos de juego.
> Plan completo en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Requisitos

- **Node.js 20.19 o superior** (recomendado 22 LTS) → https://nodejs.org
- npm (viene con Node)

Verificá con:

```bash
node -v
npm -v
```

## Ejecutar en desarrollo

Desde la carpeta `flagazo`:

```bash
npm install
npm run dev
```

Abrí **http://localhost:5173**.

- `npm run dev` levanta dos procesos: el servidor de juego (puerto 3001) y el frontend con Vite (5173).
- Guardar un archivo del cliente recarga la página al instante; guardar uno del servidor lo reinicia
  y los clientes se reconectan solos.
- **Probar desde el celular:** con la PC y el celu en la misma red wifi, abrí la dirección `Network`
  que muestra Vite en la consola (por ejemplo `http://192.168.0.15:5173`).
  Si Windows pregunta por el firewall, permití el acceso en redes privadas.

### Qué probar en la Fase 1

1. Elegí un nickname (probá uno inválido como `<hola>` o `a`).
2. Abrí una **segunda pestaña** (o una ventana de incógnito) y entrá con otro nickname:
   el contador 👥 de arriba a la derecha se actualiza en vivo en ambas.
3. Apretá **F5** en el menú: volvés directo al menú con tu nickname (la sesión se conserva).
4. Guardá cualquier archivo de `server/src` (el servidor se reinicia): el indicador pasa a
   "Reconectando…" y se recupera solo, sin volver a pedir nickname.
5. Escribí o pegá un código como `x7k-92` en "Unirse con código": se normaliza a `X7K92`.

### Qué probar en la Fase 2

Cada pestaña es un jugador distinto (el token de sesión vive en `sessionStorage`),
así que alcanza con abrir varias para probar todo vos solo.

1. **Crear y unirse:** creá una party en una pestaña y entrá desde otra con el código
   (probalo en minúsculas y con guión: `zj-528` entra igual). El de al lado aparece al toque.
2. **Nickname repetido:** entrá desde otra pestaña con el mismo nickname → *"Ya hay alguien
   con tu nickname en esa party"*. Compara sin tildes ni mayúsculas: `JUÁN` choca con `juan`.
3. **Código inexistente:** probá `AAAAA` → *"No existe ninguna party con ese código"*.
4. **Solo el host manda:** el invitado ve la configuración en gris con *"Decide el host"* y su
   botón dice "Esperando al host…". Cambiá dificultad o rondas desde el host: se actualiza
   en vivo en todas las pestañas.
5. **Banderas por ronda:** es un número que se escribe, de **5 a 100**. Probá escribir `500`
   o `1`: se ajusta solo al máximo o al mínimo. Se confirma al salir del campo o con Enter,
   no mientras tipeás (si no, "4" de "40" sería inválido).
6. **Tope de la partida:** son 100 banderas entre todas las rondas. Con 1 ronda entran 100;
   con 3 rondas, hasta 33 cada una (el rótulo del campo te dice el máximo). Si ponés 100
   banderas, las rondas que no entrarían aparecen tachadas.
7. **Ocultar el código:** tocá el 👁️ al lado del código. Se tapa con puntos, para que no se
   filtre si estás compartiendo pantalla o transmitiendo. Aun tapado, tocarlo lo copia igual.
   Es una preferencia **tuya**: los demás lo siguen viendo, y se recuerda para la próxima vez.
8. **Expulsar:** tocá la ✕ roja al lado de un jugador. Vuelve al menú con el aviso, y si
   intenta entrar de nuevo con ese código → *"Te expulsaron de esa party"*.
9. **F5 en el lobby:** volvés al mismo lobby, con el mismo código y la misma configuración.
10. **Cerrar la pestaña del host:** queda en gris como "desconectado", a los **15 s** la corona
   pasa al jugador conectado más antiguo y a los **30 s** desaparece del lobby.
   Si vuelve antes de los 15 s, se queda con la corona.

### Qué probar en la Fase 3

1. **Jugar:** en el lobby tocá **Empezar**. Va cuenta regresiva → bandera → revelación,
   y al final de cada ronda un ranking.
2. **Respuestas en cualquier idioma:** para Alemania sirven `Alemania`, `Germany`,
   `Deutschland`, `Allemagne`… y para Japón también `日本`. No importan tildes ni mayúsculas:
   `perú`, `PERU` y `  peru  ` son lo mismo.
3. **Nombres que usa la gente:** `EEUU`, `Holanda`, `Corea del Sur`, `Birmania`, `Inglaterra`.
4. **Ambigüedad:** si sale una de las dos Coreas y escribís `Corea`, no cuenta como error:
   te pide que seas más específico y podés volver a responder. Lo mismo con `Congo`.
5. **Anti-trampa:** abrí la pestaña de red del navegador mientras corre el tiempo. La bandera
   se pide como `/flag/r/8f3a…`, un id aleatorio; el país recién aparece en la revelación.
6. **Timer sincronizado:** con dos pestañas abiertas, la barra de tiempo va igual en las dos
   aunque sus relojes no coincidan (se anima contra el reloj del servidor).
7. **La bandera se corta antes** si ya respondieron todos los conectados: no hay que esperar
   el tiempo completo.
8. **Reconexión en partida:** apretá F5 en medio de una ronda. Volvés a la misma bandera,
   con el mismo tiempo restante y tu respuesta ya enviada.
9. **Revancha:** al terminar, el host puede volver al lobby conservando la party.

### Cómo se puntúa

Hay **dos marcadores a la vez**, y los dos se ven en la tabla de la izquierda:

- **Puntos de la ronda** (columna `pts`): lo que se mueve bandera a bandera.
  - Acertar: **100** + hasta **50** por velocidad (proporcional al tiempo que sobró).
  - **Racha**: 3 o 4 seguidas ×1.5 · 5 a 9 ×2 · 10 o más ×3. Aparece un 🔥 al lado del nombre.
  - Errar: **−50** y se corta la racha. No responder: 0, pero también corta la racha.
  - El puntaje de la ronda nunca baja de 0.
- **Rondas ganadas** (columna 🏆): quien más puntos hizo en la ronda se lleva **1 punto**
  al marcador general, que es el que define la partida. En empate suman todos.

Los números están todos en [`shared/src/scoring.ts`](shared/src/scoring.ts): para cambiar
el balance no hace falta tocar el motor. La pantalla final los lee de ahí para explicarlos
(*Cómo se suman los puntos*), así que rebalancear no deja el texto mintiendo.

### Qué probar en la Fase 4

1. **Errores de tipeo perdonados:** `Argnetina`, `Argentin` y `Argentinaa` cuentan como
   acierto. Aparece **🟢** en vez de ✅ y el mensaje *"¡Casi! Te la damos, con menos puntos"*:
   valen 80 en vez de 100 (dos errores o más, 70).
2. **Letras invertidas = un solo error:** escribir rápido invierte letras, así que
   `Alemanai` o `Colomiba` entran con un solo error, no dos.
3. **Nombres cortos no perdonan nada:** `Perv` no vale por Perú, ni `Chat` por Chad,
   ni `Irak` por Irán. Con un error de tolerancia, esos serían **otro país**.
4. **Si empatan, no adivina:** `Austrlia` está a una edición de Australia y de Austria
   → te pide que seas más específico y **no gasta el intento**. Igual `Chila`, que empata
   entre Chile y China.
5. **El que se parece más gana:** `Australa` está a 1 de Australia y a 2 de Austria,
   así que vale para Australia y es error para Austria.
6. **El exacto siempre le gana al parecido:** `Niger` es Níger, aunque esté a una
   edición de Nigeria.
7. **Funciona en los 78 idiomas:** `Deutschlnad` vale por Alemania.

### Qué probar en la Fase 5

1. **Estadísticas al final:** terminá una partida. Abajo del podio aparece *"Cómo les fue"*
   con los destacados (⚡ más rápido, 🔥 mejor racha) y una tabla con aciertos, errores,
   banderas sin responder, mejor racha, tiempo más rápido, promedio y puntos.
2. **Desconectarse en partida NO te saca:** cerrá una pestaña en medio de una ronda.
   El jugador queda en gris pero **sigue en el ranking hasta el final** — a diferencia
   del lobby, donde a los 30 s desaparece.
3. **Y al terminar sí:** cuando la partida termina, a ese jugador desconectado vuelve
   a corrérsele el tiempo de gracia y se va del lobby.
4. **Entrar con la partida empezada:** unite desde otra pestaña a una party que ya está
   jugando. No podés responder, aparecés en la tabla como *"Juegan la próxima"*, y en
   la revancha entrás normalmente.
5. **Resumen entre rondas:** con 2 o más rondas, al cerrar cada una aparece quién la
   ganó y con cuántos puntos.

### Qué probar en la Fase 6

1. **Sonido:** el 🔊 de arriba a la derecha lo activa y silencia, y se recuerda para la
   próxima vez. Hay tic-tac en la cuenta regresiva, un sonido distinto según si acertaste,
   raspaste o erraste, arpegio al subir de racha y fanfarria al final.
2. **La tabla se reordena con animación:** con dos jugadores, cuando uno pasa al otro las
   filas **viajan** a su lugar nuevo en vez de saltar.
3. **Tensión final en dos escalones:** la barra se pone roja en el último cuarto del tiempo,
   y en los **últimos 5 segundos** late todo el bloque, el número salta y suena el tic-tac.
4. **La racha late:** al llegar a 3, 5 y 10 seguidas el 🔥 pega un salto y suena.
5. **Los puntos palpitan** cuando cambian, y en la revelación entran desde abajo.
6. **Si pediste menos movimiento** en tu sistema operativo (`prefers-reduced-motion`),
   las animaciones se desactivan solas.

> Los sonidos son **sintetizados con Web Audio**, no archivos: pesan cero y no hay licencias
> que revisar. Para pasar a sonidos de verdad alcanza con reemplazar `playRecipe` en
> [`SoundManager.ts`](client/src/audio/SoundManager.ts) y dejar los nombres como están.

### Qué probar en la Fase 7

En el lobby, arriba de todo, ahora hay un selector de **Modo**. Cada uno cambia cómo se juega:

| Modo | Qué hace |
|---|---|
| 🏳️ **Normal** | La bandera tal cual. |
| 🟦 **Pixelada** | Arranca en bloques gigantes y se va aclarando. |
| 🔍 **Recortada** | Se ve un pedacito muy de cerca y la cámara se aleja. |
| ⬜ **Sin color** | Todo en grises, y **no** se aclara nunca. |
| 👯 **Parecidas** | Solo banderas confundibles, y **de a pares consecutivos**. |
| 💣 **Bomba** | La mecha se acorta con cada bandera; dejarla explotar cuesta 50 puntos. |
| ⚡ **Parpadeo** | La bandera se ve medio segundo y se tapa. El resto del tiempo es para escribir. |

1. **Los dos que se aclaran premian arriesgar:** cuanto antes la reconocés, más bonus de
   velocidad te llevás. Esperar a que se vea clara es cómodo pero rinde menos.
2. **Sin color no afloja nunca:** mostrar el color sería regalar la respuesta.
3. **Parecidas:** vas a ver Rumania justo después de Chad, o Mónaco pegado a Indonesia.
   La confusión aparece cuando las tenés fresquitas una al lado de la otra.
4. **Bomba:** con 5 banderas por ronda, la primera dura lo configurado y la última el 30 %
   (nunca menos de 3 segundos). Quedarse callado deja de ser gratis.
5. **En la revelación la bandera siempre se ve limpia**, sin importar el modo.
6. El modo elegido queda visible arriba durante toda la partida.

### Qué probar en los últimos ajustes

1. **Idioma.** Arriba a la derecha, al lado del sonido, hay un selector **EN / ES**.
   Arranca en inglés; al elegir español queda recordado para la próxima visita.
   Se puede cambiar en cualquier momento, incluso a mitad de partida, y no afecta a los
   demás jugadores: cada uno lee en el suyo. El español es **neutro** (tuteo, sin
   regionalismos). Responder sigue funcionando en 78 idiomas, sin importar el selector.
2. **El logo es un botón.** Arriba a la izquierda: te lleva a crear party / poner código.
   Si estabas en una party, primero sale de ella.
3. **Pixelada.** La bandera se ve **de tamaño normal desde el primer frame**, con el
   pixelado encima como si fuera un filtro. Antes era una bandera chiquita que crecía.
4. **Fondo.** Las banderas decorativas cubren toda la pantalla y se despejan en el centro,
   donde va el contenido. La paleta general es más oscura.
5. **Modos.** Son seis: ya no está "A oscuras".

### Qué probar en las salas públicas

1. **Al crear.** En el menú, la tarjeta *Crear sala* tiene ahora **Privada / Pública**.
   Arranca en **privada**: publicarla es algo que elegís, no algo que te pasa.
2. **El buscador.** Abajo del todo, *Salas públicas → Ver salas*. Lista las que están
   esperando jugadores, con el modo, la dificultad, la configuración y cuánta gente hay.
   Se refresca sola cada 5 segundos mientras la mirás.
3. **Entrar sin el código.** Tocá *Entrar* en cualquier fila: no hace falta que nadie te
   pase nada. Probalo con dos pestañas.
4. **Cambiarlo a mitad de camino.** En el lobby, el host tiene el mismo par de botones y
   puede publicar o esconder la sala cuando quiera. Los demás solo ven un cartel con en
   cuál de las dos está. El cambio les llega a todos al instante.
5. **Qué NO aparece en la lista:** las privadas, las llenas y las que ya están jugando.
   Empezá una partida pública y vas a ver que desaparece del buscador; con la revancha
   vuelve.

### Qué probar en Draw Battle

El segundo juego: todos reciben el mismo país y dibujan su bandera de memoria al mismo
tiempo. El servidor compara los dibujos con la bandera real y el mejor se lleva el punto.
El diseño completo, y el porqué de cada decisión, está en [`docs/DRAW_BATTLE.md`](docs/DRAW_BATTLE.md).

1. **Elegir el juego:** en el lobby, arriba de la configuración, tocá 🎨 **Draw Battle**.
   La configuración cambia: rondas (5–20), tiempo para dibujar (30–90 s) y qué te toca
   (el nombre del país, o la bandera unos segundos y después de memoria).
2. **Dibujar:** pincel en tres grosores, borrador, deshacer, rehacer, borrar todo y 15
   colores. Con dos pestañas se juega de a dos. **Terminar** bloquea tu lienzo; si
   terminan todos, la ronda se corta.
3. **Celular:** abrí el juego desde el celu. El lienzo ocupa el ancho, arrastrar no hace
   scroll ni zoom y todo entra en una pantalla sin scrollear.
4. **F5 a mitad del dibujo:** volvés a la misma ronda con tu dibujo intacto.
5. **Revelación:** aparecen los dibujos de a uno, después la bandera real, después los
   puntajes y el ganador. Tu tarjeta muestra de dónde salió tu número.
6. **No castiga el estilo:** una bandera correcta rellenada a garabatos saca casi lo
   mismo que una prolija. Una bien pintada con los colores equivocados, poco.
7. **Olvidarse del elemento importante cuesta:** Japón sin el disco, Canadá sin la hoja
   o Suiza sin la cruz sacan poco aunque el resto esté perfecto.

## Publicidad

Hay dos espacios preparados: **el lobby** (mientras se espera a los amigos) y **la pantalla
final**. Durante la partida no hay ninguno a propósito: el juego es a contrarreloj y en el
modo Parpadeo la bandera se ve menos de medio segundo.

Se activan con variables de entorno. Copiá `client/.env.example` a `client/.env` y completá:

```
VITE_ADS_CLIENT=ca-pub-0000000000000000
VITE_ADS_SLOT_LOBBY=1234567890
VITE_ADS_SLOT_RESULTS=0987654321
```

**Sin `VITE_ADS_CLIENT` no se carga ningún script de terceros** y los espacios no se
dibujan: el juego queda exactamente como está hoy. En desarrollo, sin configurar, se dibuja
un recuadro punteado para poder ver cómo queda la pantalla.

### Antes de que esto dé un peso

El código es la parte fácil y ya está. Lo que falta no se resuelve programando:

1. **Un dominio propio y el juego desplegado en él.** Ninguna red aprueba un túnel
   temporal ni `localhost`. Ver *Publicarlo para jugar con gente*.
2. **Una cuenta aprobada.** AdSense revisa el sitio a mano; tarda de días a semanas y puede
   rechazarlo. Piden contenido propio y una política de privacidad publicada.
3. **Un banner de consentimiento** si te entra tráfico de la Unión Europea. Es obligatorio
   y no está implementado: hay que elegir una CMP y enchufarla.
4. **Ser mayor de edad y tener forma de cobrar.**

Y una expectativa realista: un party game que se juega entre amigos en sesiones cortas
rinde centavos con publicidad display. No es plata, es una curiosidad.


## Donaciones

Aparte de la publicidad hay un botón de donar, abajo de todo en el menú. Es un enlace
común y silvestre: no carga scripts, no rastrea a nadie y sirve con cualquier plataforma
(Cafecito, Ko-fi, PayPal, Mercado Pago).

Por defecto apunta a la página de Flagazo. Para mandarlo a otro lado, o para sacarlo,
está `VITE_DONATE_URL` en `client/.env`:

```
VITE_DONATE_URL=https://cafecito.app/tu-usuario
```

Dejándola **vacía** el botón no se dibuja ni queda en el bundle, que es la forma de
sacarlo sin tocar el código.

Está en el menú y no en la pantalla final a propósito: ahí ya hay un espacio de anuncio, y
dos pedidos de plata juntos justo cuando alguien acaba de ganar o perder se sienten a
manotazo. En el menú está a mano y no interrumpe nada.


## Revisar las banderas

```bash
npm run audit:flags
```

Lista la proporción de las 195 y avisa si alguna quedó sin declararla o con el
`viewBox` peleado con su `width/height`, que es la forma silenciosa de deformar un
SVG. **104 de 195 no son ni 3:2 ni 4:3** —Suiza y el Vaticano son cuadradas, Nepal
es un banderín más alto que ancho, Qatar es 11:28— y que aparezcan ahí es lo
correcto: son justamente las que el set anterior redibujaba mal.

El guardián automático es `server/src/data/flagFiles.test.ts`, que corre con `npm test`.

> Las URLs de banderas llevan siempre `?v=` con el sello del set. Sin eso, a quien
> hubiera jugado antes de un `build:flags` el navegador le seguía sirviendo las
> viejas desde su caché sin volver a preguntar.

## Regenerar las banderas

Las 195 banderas viven en `server/flags/`, descargadas de Wikimedia Commons (la fuente que
usa Wikipedia) resolviendo cada país por su código ISO en Wikidata:

```bash
npm run build:flags
```

Tarda un par de minutos porque va de a una: Commons corta con `429` si se le pide en paralelo.
Cada bandera se guarda con **su proporción oficial** y el cliente la muestra con
`object-fit: contain`, así ninguna se estira ni se recorta.

## Regenerar las referencias de Draw Battle

```bash
npm run build:flag-refs
```

Rasteriza cada bandera, clasifica sus píxeles en los 15 colores del juego y guarda el
resultado en `server/src/data/flagReferences.json`. Hay que correrlo **después de
`build:flags`** y **si se cambia un color o una penalización de la paleta**: un test
compara la huella de la paleta con la de las referencias y avisa si quedaron viejas.

Con `-- --preview jp,br,us` además dibuja esas banderas en la consola, como quedaron
leídas.

## Regenerar el dataset de países

Los 195 países viven en `server/src/data/countries.json`, generado desde
[i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries) más la capa
curada a mano de `server/src/data/overrides.ts` (alias, continentes, dificultad, ambigüedades):

```bash
npm run build:countries
```

El script **falla si encuentra una inconsistencia** — un país sin continente, un nombre que
apunta a dos países sin estar declarado ambiguo, un alias que pisa el nombre de otro — así
los errores de datos aparecen antes de jugar y no en medio de una partida.

## Producción (una sola app, un solo puerto)

```bash
npm run build
npm start
```

Abrí **http://localhost:3001**. El servidor sirve el juego, las banderas y el tiempo real.
El puerto se cambia con la variable de entorno `PORT`.

## Cuentas de usuario

Opcionales: se puede jugar sin cuenta como siempre. En desarrollo no hace falta
configurar nada, el servidor usa una base embebida guardada en `server/.data/`
(borrar esa carpeta la deja vacía).

Los emails (código de verificación, recuperar la contraseña) en desarrollo no se
envían: se muestran en la consola del servidor, con el código.

Para probar el envío real desde tu compu, copiá `server/.env.example` a `server/.env`
(está en `.gitignore`, nunca se sube) y completá `RESEND_API_KEY`. `npm run dev` la lee sola.

En producción hacen falta tres variables de entorno (ver `server/.env.example`):
`DATABASE_URL` (Postgres), `AUTH_SECRET` y `RESEND_API_KEY`. Si falta alguna, las
cuentas quedan apagadas y el juego funciona igual. Los botones de Google y Discord
aparecen solo si están sus credenciales (`GOOGLE_CLIENT_ID`/`SECRET`,
`DISCORD_CLIENT_ID`/`SECRET`) y `PUBLIC_URL`. Las migraciones se aplican solas al
arrancar.

Si cambiás `server/src/db/schema.ts`, generá la migración y commiteala:

```bash
npm run db:generate -w server -- --name que_cambia
```

Detalles y decisiones en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md#21-cuentas-de-usuario).

## Publicarlo para jugar con gente

Flagazo es **un solo proceso Node en un solo puerto**, así que entra en el plan gratis
de casi cualquier plataforma. Lo único que hace falta:

| Ajuste | Valor |
|---|---|
| Comando de build | `npm install && npm run build` |
| Comando de arranque | `npm start` |
| Versión de Node | 20.19 o superior (mejor 22) |
| Variable de entorno | `PORT` — la pone la plataforma sola |

No hay base de datos ni servicios externos que configurar.

### Render

El repo trae un `render.yaml`, así que no hay que completar el formulario a mano:

1. Subí el repo a GitHub.
2. En Render, **New → Blueprint** y elegí el repositorio.
3. Render lee el `render.yaml` y solo pide los valores de las variables que no
   viven en el repo (el link de donaciones y, si las usás, las de publicidad).

Cargá `VITE_DONATE_URL` **antes** del primer despliegue: Vite la mete dentro del
archivo compilado, así que agregarla después obliga a volver a desplegar.

### Railway / Fly.io / otras

1. Subí el repo a GitHub.
2. Creá un **Web Service** apuntando a ese repo.
3. Pegá los comandos de la tabla. El resto es el default.

### VPS propio

```bash
git clone <tu-repo> && cd flagazo
npm install && npm run build
PORT=3001 npm start
```

Conviene dejarlo bajo `pm2` o un servicio de systemd para que se reinicie solo, y poner
nginx o Caddy adelante para el HTTPS.

### Antes de invitar gente

- **HTTPS sí o sí** si van a jugar desde el celular: sin él algunos navegadores bloquean
  el WebSocket. Las plataformas de arriba lo dan hecho.
- **Una sola instancia.** Las parties viven en memoria, así que no escales a varias
  réplicas: dos jugadores podrían caer en procesos distintos y no verse. Para eso haría
  falta Redis, y está fuera del MVP.
- **Reiniciar el servidor corta las partidas en curso.** Las parties se pierden (los
  jugadores vuelven al menú sin drama, pero la partida no se recupera). Conviene
  desplegar cuando no haya nadie jugando.
- El proceso arranca en menos de un segundo y come poca memoria; los planes gratis
  que "duermen" el servicio funcionan, solo que la primera visita tarda unos segundos.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor + cliente en modo desarrollo |
| `npm run build` | Compila cliente (`client/dist`) y servidor (`server/dist`) |
| `npm start` | Arranca el build de producción |
| `npm test` | Tests (validaciones + integración real con Socket.IO) |
| `npm run typecheck` | Chequeo de tipos de los tres paquetes |
| `npm run db:generate -w server` | Genera la migración SQL tras cambiar el esquema de la base |
| `npm run build:flag-refs` | Regenera las referencias de Draw Battle (ver abajo) |
| `npx tsx scripts/calibrate-draw-scoring.ts` | Tabla de puntajes de Draw Battle sobre dibujos de prueba |

## Estructura

```
flagazo/
├─ shared/   tipos de eventos, constantes y validaciones (cliente y servidor)
├─ server/   Node + Express + Socket.IO (autoritativo)
├─ client/   React + Vite (con `src/i18n/` para inglés y español)
└─ docs/     arquitectura y plan por fases
```

## Solución de problemas

- **`EADDRINUSE: 3001` o `5173`**: ya hay algo usando ese puerto (¿otra terminal con `npm run dev`?). Cerralo.
- **"Conectando…" que nunca termina**: revisá que en la consola aparezca `[server] Flagazo escuchando…`.
- **Las banderas del fondo no cargan**: corré `npm install` de nuevo desde la carpeta raíz.

## Créditos y licencias

- Banderas: **[Wikimedia Commons](https://commons.wikimedia.org)**, descargadas con
  `npm run build:flags` y guardadas con su proporción oficial. El origen de cada archivo
  está en [`server/flags/FUENTE.md`](server/flags/FUENTE.md). La enorme mayoría de las
  banderas nacionales son de dominio público.
- Tipografías: Lilita One y Nunito vía [Fontsource](https://fontsource.org) — SIL Open Font License.

## Que Google lo encuentre

El juego se dibuja con JavaScript, así que lo único que ven los buscadores y las
vistas previas de WhatsApp o Discord es lo que está escrito en `client/index.html`:
título, descripción, imagen de vista previa (`og.png`) y una ficha de datos
estructurados que le dice a Google que esto es un juego jugable en el navegador.

Además hay `client/public/robots.txt` y `client/public/sitemap.xml`.

**Las direcciones están escritas a mano en tres lugares** y tienen que decir todas
lo mismo: `index.html` (canonical y las etiquetas `og:`), `robots.txt` y
`sitemap.xml`. Hoy apuntan a `https://flagazo.com`. Si el dominio cambia, se
cambian las tres juntas, y recién cuando el dominio nuevo ya responda — antes no,
o Google va a buscar una página que todavía no existe.

Con esto puesto, el paso que no se resuelve programando es darlo de alta en
[Google Search Console](https://search.google.com/search-console): verificar el
sitio, mandar el sitemap y pedir la indexación. Sin eso, aparecer puede tardar
semanas; con eso, suele ser cuestión de días.
