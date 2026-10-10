# Recomendador (React + Capacitor)

## Fase 1 (esta versión): tu biblioteca
Importa tus listas y consúltalas en el móvil. Todo se guarda en el dispositivo.
- MyAnimeList (anime y manga) con la API oficial v2 (necesita un Client ID)
- Letterboxd (RSS público y ZIP) + TMDB
- Libros: se apuntan en la app («Añadir libro»); los dos Excel quedan como
  importación inicial. Sinopsis y portadas de Wikipedia y Open Library (sin claves)
- Los tomos de manga del Excel se agrupan por serie; las series que ya están en tu
  lista de MAL no se buscan y usan la portada de MAL

### Mantenerla al día
- En cada categoría, **desliza hacia abajo** desde arriba del todo o pulsa
  **Actualizar** (encima del buscador, junto a la fecha de la última vez: «MyAnimeList ·
  actualizado hace 2 días»). El progreso y el resumen («Películas: 3 nuevas, 1 nota
  cambiada») salen en un aviso flotante abajo. Anime y manga se actualizan a la vez
  (es la misma lista de MAL); en Libros busca las sinopsis y portadas que falten. Si
  falta algo en Ajustes, el aviso lo dice y lleva a Ajustes.
- MAL: vuelve a leer tu lista y aplica solo los cambios (nuevos, nota, estado,
  progreso; quita lo que ya no esté). Busca la portada solo de los nuevos.
- Letterboxd: lee `https://letterboxd.com/<usuario>/rss/` (usuario en Ajustes). Trae
  las últimas ~50 entradas del diario: añade las nuevas, actualiza notas y pasa a
  vistas las de la watchlist; completa con TMDB solo las nuevas. Para sincronizar
  todo el historial, sube el ZIP en Datos (las películas no se duplican).
- Libros: «Añadir libro» (el botón flotante de la categoría) sugiere títulos de Open
  Library mientras escribes y busca la sinopsis al guardar. En la ficha: «Editar»,
  «Marcar como leído» y «Eliminar». Lo que cambies en un libro del Excel se guarda en
  `extra.userEdits` y gana al reimportar; los que elimines no vuelven. «Libros a
  Excel» (Datos, en Copia de seguridad) descarga un `.xlsx` con todos.
- Nada de esto borra sinopsis ni portadas encontradas o elegidas a mano. La copia
  de seguridad incluye los libros añadidos en la app.

En el navegador, MAL y el RSS de Letterboxd pasan por el proxy de `npm run dev`
(`/mal-api`, `/lb-rss`) porque no admiten CORS; en Android van directos.

Pantallas (pensadas para el móvil): una barra inferior con Inicio y las cuatro
categorías, al alcance del pulgar. Inicio: una tarjeta por categoría con sus portadas
mejor puntuadas y las filas «Continúa» (lo que tienes a medias) y «Terminado hace
poco». Categoría: cuadrícula de portadas con buscador, filtro por estado (con cuántos
hay de cada uno), orden y barra de progreso en lo que estás viendo o leyendo. Ficha:
portada sobre su versión desenfocada, nota, sinopsis (con «Leer más» si es larga) y
datos según el tipo. Datos y Ajustes se abren desde los iconos de la cabecera; en
Ajustes se elige el tema (automático, claro u oscuro). El botón «atrás» de Android
vuelve a la pantalla anterior; desde una categoría, al inicio, y desde el inicio sale.

Importar tarda segundos: las sinopsis y portadas se traen después con el botón
«Completar datos» de Datos (portadas de MAL; sinopsis y pósters de TMDB; sinopsis
de Wikipedia en español, Open Library y Wikipedia en inglés, y portadas de Open
Library o Wikipedia para los libros). Solo procesa lo pendiente y se puede detener
y reanudar.

«Descargar portadas» busca solo portadas, para lo que no tenga:
- Anime y manga de MAL: `main_picture` (se vuelve a pedir título a título si falta).
- Manga del Excel: la portada de la serie en tu lista de MAL o, si no está, la del
  resultado de buscarla en MAL cuyo título coincida (necesita el Client ID).
- Películas: póster de TMDB (`/movie/{tmdbId}` para las ya completadas).
- Libros: `cover_i` de Open Library y, si no hay, la miniatura de Wikipedia
  (español y luego inglés), con una petición por segundo.

Al terminar, el Registro muestra cuántas portadas faltan por categoría. Si una
imagen no carga, se ve un recuadro del color de la categoría con las iniciales.

### Ruleta de pelis
En Películas, el botón flotante **Ver peli** abre una ruleta con tus películas
pendientes (la watchlist de Letterboxd). Si tienes más de las que caben, pone unas
cuantas al azar y «Otras pelis» cambia la selección. Al girarla se para en una al
azar y enseña su póster, año, dirección, dónde verla en España y la sinopsis, con
«Ver ficha» y «Girar otra vez». El botón solo sale si tienes alguna pendiente.

El icono de los deslizadores (arriba a la derecha) abre **Personaliza la ruleta**
(`src/ui/wheel.ts`): cuántas pelis lleva (de 2 a 24; 12 por defecto), el estilo
(Cine, Arcoíris, Casino, Neón o Pastel), si cada porción lleva el póster o el título,
la velocidad del giro (rápido, normal o con suspense) y un clic al pasar cada
porción por la flecha. Se guarda en el dispositivo, como el tema.

## Fase 2: recomendador
**Recomiéndame** (tarjeta del inicio o icono ✦ de la cabecera, que abre la categoría
en la que estás): eliges qué quieres (anime, manga, película o libro), de dónde (de
tus pendientes, algo nuevo o ambos), puedes escribir lo que te apetece («algo corto
y oscuro», «parecido a Steins;Gate») y marcar «basado en todos mis gustos» para
recomendaciones cruzadas.

1. **Perfil** (`src/reco/profile.ts`, sin IA): por categoría, tus 15 mejor
   puntuados, los 5 peor puntuados, los 10 más recientes, los géneros que más
   puntúas alto y tu media; títulos con autor, año o título original. Texto de
   unos 3.000 tokens como mucho.
2. **Gemini** (`src/reco/gemini.ts`): con tu API key gratuita de Google AI Studio
   (Ajustes). El modelo se elige en Ajustes o en el desplegable de Recomiéndame
   entre los que tienen nivel gratuito: Gemini 3.8 Flash (por defecto), 3.6 Flash,
   3.5 Flash-Lite, 3.1 Flash-Lite y 3 Flash (preview); con «Otro» se escribe el
   nombre de cualquier otro. Cada modelo tiene su propio límite diario, así que
   si agotas uno puedes seguir con otro. Pide la respuesta en JSON con esquema:
   título, título original, año, autor, si es de tus pendientes y por qué te lo
   recomienda, citando títulos tuyos parecidos.
3. **Verificación** (`src/reco/verify.ts`): anime y manga en MAL, películas en
   TMDB y libros en Open Library. Solo se muestra lo que se encuentra con
   seguridad (título y año), con portada, enlace y sinopsis; se descarta lo que
   ya has visto o leído.
4. **Tarjetas**: «Añadir a pendientes» (libros en la app; anime, manga y
   películas con el enlace para añadirlos en MAL o Letterboxd), «Ya lo he visto»
   y «No me interesa» (no se vuelven a recomendar y se mandan a Gemini como
   contexto). Las últimas recomendaciones de cada categoría se guardan para
   verlas sin gastar peticiones.

En libros (con «Algo nuevo» o «Ambos») hay una opción experimental, **Pistas de
«An Ocean of Books»** (`src/reco/ocean.ts`). [An Ocean of Books](https://artsexperiments.withgoogle.com/ocean-of-books)
es un mapa de Google Arts & Culture que coloca los libros de Google Books según lo
parecido de su texto, con una isla por autor. La app busca en él tus 8 libros
favoritos (o la isla de su autor), coge los libros de otros autores que tienen más
cerca y se los pasa a Gemini como candidatos. Gemini elige los que encajan y las
tarjetas que salen de ahí llevan la etiqueta «Del mapa». El mapa no siempre acierta:
fuera de los clásicos, la cercanía indica poco, y solo están los ~1.000 autores y
~4.000 libros más conocidos, casi todos con su título en inglés. Si falla o no
encuentra nada, se recomienda como siempre.

Si llegas al límite gratuito de Gemini, cambia de modelo o usa **Copiar mi perfil**,
que copia el perfil con unas instrucciones para pegarlo en cualquier chat de IA.

## Primeros pasos (en el PC)
    node --version        # necesita 20 o superior
    npm install
    npm run dev           # prueba en el navegador

En la app: Ajustes (usuario y Client ID de MAL, usuario de Letterboxd, API key de TMDB
y, para las recomendaciones, API key de Gemini) -> Datos (importar) -> inicio.

El Client ID de MyAnimeList se crea gratis en https://myanimelist.net/apiconfig
(tipo de app: "other"). La API de MAL no admite CORS, así que en el navegador
las peticiones pasan por el proxy de `npm run dev` (`/mal-api`); en Android van
directas. Con `npm run preview` o una web estática la importación de MAL no funciona.

## Android
La carpeta `android/` está en el repositorio (proyecto de Capacitor 7). Hace falta
**JDK 21** (Gradle 8.11 no funciona con Java 25) y el Android SDK con la
plataforma 35 (Gradle la descarga si la licencia está aceptada).

    npm run build && npx cap sync android     # copia la web y los plugins al proyecto Android
    cd android && gradlew.bat assembleDebug   # APK de depuración
    # -> android/app/build/outputs/apk/debug/app-debug.apk
    npm run android                           # o abrirlo en Android Studio

Si Java 21 no es el que usa la terminal, pon `JAVA_HOME` a la carpeta del JDK 21
antes de `gradlew.bat`.

En el móvil, «Exportar copia» y «Libros a Excel» abren «Compartir» para
guardar el archivo en Drive, Descargas o mandarlo (en el navegador se descargan).

Icono y pantalla de carga: `node scripts/icono.mjs` dibuja el icono (un abanico de
cuatro cartas con los colores de las categorías y un destello) y escribe los iconos
de Android a su tamaño en cada densidad: el adaptativo, con capa monocroma para los
iconos temáticos de Android 13, y los antiguos (cuadrado y redondo). También genera
`assets/splash*.png`, y `npx @capacitor/assets generate --android` saca de ahí los
tamaños de la pantalla de carga (no toca los iconos: en `assets/` no hay `icon-*.png`).

## Copias de seguridad
La biblioteca vive en la base de datos del navegador (o de la app en Android):
depende del navegador y de la dirección exacta (`localhost:5173` no es lo mismo
que `127.0.0.1:5173`) y se pierde si se borran los datos del sitio. En Datos ->
Copia de seguridad puedes exportarla a un `.json` y restaurarla en otro navegador
o en el móvil. La copia no incluye las claves de Ajustes. Los archivos
`backup*.json` están en `.gitignore`.

## Privacidad
Tus listas, notas y claves se guardan solo en el dispositivo. Salen de él:
- Las consultas a las APIs públicas para importar y completar (MAL, Letterboxd,
  TMDB, Open Library, Wikipedia): usuario, títulos que se buscan y claves de cada
  servicio.
- **Al pedir recomendaciones, se envía a Google (Gemini)**: tu perfil de gustos
  (títulos con autor o año, notas, géneros y medias), la lista de tus pendientes
  de esa categoría, los títulos que ya has visto o leído de esa categoría, lo
  marcado como visto o «no me interesa» y lo que escribas en «lo que te apetece».
  No se envían sinopsis, portadas, fechas exactas ni las claves de otros
  servicios. Con el **nivel gratuito**, Google puede usar ese contenido para
  mejorar sus productos (condiciones de la API de Gemini); si no quieres, no uses
  «Recomiéndame» o usa «Copiar mi perfil» en el chat que prefieras.
- Con las pistas de «An Ocean of Books», la app descarga de Google Cloud Storage
  los índices del mapa y las zonas cercanas a tus libros favoritos. No se envía
  ningún título, solo qué zonas del mapa se piden.

El repositorio no incluye datos personales: `.gitignore` excluye Excel, ZIP, CSV
y `.env`, y las claves (también la de Gemini) solo están en los Ajustes del
dispositivo, nunca en el código ni en las copias de seguridad.

## Créditos y licencias
- Esta aplicación usa la API de TMDB, pero no está avalada ni certificada por TMDB.
- Anime y manga: [API oficial de MyAnimeList](https://myanimelist.net/apiconfig/references/api/v2).
- Libros: [Open Library](https://openlibrary.org) (datos y portadas de Open Library Covers).
- Pósters de películas: TMDB. Portadas de anime y manga: MyAnimeList.
- Resúmenes de Wikipedia (CC BY-SA): los textos de [Wikipedia](https://www.wikipedia.org)
  se usan bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es);
  la app guarda el enlace al artículo de origen de cada resumen.
- Recomendaciones generadas con [Gemini](https://ai.google.dev) (Google) y comprobadas
  en MyAnimeList, TMDB y Open Library.
- Pistas de libros: [An Ocean of Books](https://artsexperiments.withgoogle.com/ocean-of-books)
  (Google Arts & Culture). Sus datos se consultan en directo y no se copian en este repositorio.

## Licencia
Copyright (C) 2026 aropero8

Este programa es software libre: puedes redistribuirlo y modificarlo bajo los términos
de la Licencia Pública General de GNU (GPL) publicada por la Free Software Foundation,
versión 3 o (a tu elección) cualquier versión posterior. Se distribuye con la esperanza
de que sea útil, pero SIN NINGUNA GARANTÍA. Texto completo en `LICENSE`.
