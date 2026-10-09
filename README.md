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

## Fase 2 (pendiente): recomendador
En `fase2-pendiente/` está el código ya escrito: embeddings locales, perfil de
gustos y ranking. Falta la capa con LLM (Gemini con clave gratuita, más un botón
para copiar tu perfil a cualquier chat) y la verificación de títulos.

## Primeros pasos (en el PC)
    node --version        # necesita 20 o superior
    npm install
    npm run dev           # prueba en el navegador

En la app: Ajustes (usuario y Client ID de MAL, usuario de Letterboxd, API key de TMDB) -> Datos (importar) -> inicio.

El Client ID de MyAnimeList se crea gratis en https://myanimelist.net/apiconfig
(tipo de app: "other"). La API de MAL no admite CORS, así que en el navegador
las peticiones pasan por el proxy de `npm run dev` (`/mal-api`); en Android van
directas. Con `npm run preview` o una web estática la importación de MAL no funciona.

## Android
    npx cap add android   # solo la primera vez (necesita Android Studio)
    npm run android       # compila, sincroniza y abre Android Studio

## Notas
- Sin probar aún con datos reales: es un primer borrador.

## Copias de seguridad
La biblioteca vive en la base de datos del navegador (o de la app en Android):
depende del navegador y de la dirección exacta (`localhost:5173` no es lo mismo
que `127.0.0.1:5173`) y se pierde si se borran los datos del sitio. En Datos ->
Copia de seguridad puedes exportarla a un `.json` y restaurarla en otro navegador
o en el móvil. La copia no incluye las claves de Ajustes. Los archivos
`backup*.json` están en `.gitignore`.

## Privacidad
Tus listas, notas y claves nunca salen del dispositivo (salvo las consultas a
las APIs públicas). El repositorio no incluye datos personales: `.gitignore`
excluye Excel, ZIP, CSV y `.env`.

## Créditos y licencias
- Esta aplicación usa la API de TMDB, pero no está avalada ni certificada por TMDB.
- Anime y manga: [API oficial de MyAnimeList](https://myanimelist.net/apiconfig/references/api/v2).
- Libros: [Open Library](https://openlibrary.org) (datos y portadas de Open Library Covers).
- Pósters de películas: TMDB. Portadas de anime y manga: MyAnimeList.
- Resúmenes de Wikipedia (CC BY-SA): los textos de [Wikipedia](https://www.wikipedia.org)
  se usan bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es);
  la app guarda el enlace al artículo de origen de cada resumen.
- Modelo de embeddings (Fase 2): multilingual-e5-small (MIT).
- Código bajo licencia MIT (ver `LICENSE`).
