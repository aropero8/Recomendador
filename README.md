# Recomendador (React + Capacitor)

## Fase 1 (esta versión): tu biblioteca
Importa tus listas y consúltalas en el móvil. Todo se guarda en el dispositivo.
- MyAnimeList (anime y manga) con la API oficial v2 (necesita un Client ID)
- Letterboxd (ZIP) + TMDB
- Libros (dos Excel) + Google Books / Open Library
- Los tomos de manga del Excel se agrupan por serie y se funden con MAL si coinciden

Pestañas: Biblioteca (buscar, filtrar, ordenar), Datos (importar), Ajustes (claves).

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

## Privacidad
Tus listas, notas y claves nunca salen del dispositivo (salvo las consultas a
las APIs públicas). El repositorio no incluye datos personales: `.gitignore`
excluye Excel, ZIP, CSV y `.env`.

## Créditos y licencias
- Esta aplicación usa la API de TMDB, pero no está avalada ni certificada por TMDB.
- Anime y manga: [API oficial de MyAnimeList](https://myanimelist.net/apiconfig/references/api/v2).
- Libros: Google Books API y Open Library.
- Modelo de embeddings (Fase 2): multilingual-e5-small (MIT).
- Código bajo licencia MIT (ver `LICENSE`).
