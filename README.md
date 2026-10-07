# Recomendador (React + Capacitor)

## Fase 1 (esta versión): tu biblioteca
Importa tus listas y consúltalas en el móvil. Todo se guarda en el dispositivo.
- MyAnimeList (anime y manga) con la API oficial v2 (necesita un Client ID)
- Letterboxd (ZIP) + TMDB
- Libros (dos Excel) + Wikipedia y Open Library (sin claves ni cuentas)
- Los tomos de manga del Excel se agrupan por serie; las series que ya están en tu
  lista de MAL no se buscan y usan la portada de MAL

Pantallas: inicio (una tarjeta por categoría con sus portadas mejor puntuadas) ->
categoría (cuadrícula de portadas con buscador, filtro por estado y orden) ->
ficha (portada, nota, sinopsis y datos según el tipo). Datos y Ajustes se abren
desde los iconos de la cabecera. El botón «atrás» del navegador o de Android vuelve
a la pantalla anterior.

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

En la app: Ajustes (usuario y Client ID de MAL, API key de TMDB) -> Datos (importar) -> Biblioteca.

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
