# Recomendador (React + Capacitor)

## Fase 1 (esta versión): tu biblioteca
Importa tus listas y consúltalas en el móvil. Todo se guarda en el dispositivo.
- MyAnimeList (anime y manga) con la API oficial v2 (necesita un Client ID)
- Letterboxd (ZIP) + TMDB
- Libros (dos Excel) + Wikipedia y Open Library (sin claves ni cuentas)
- Los tomos de manga del Excel se agrupan por serie; las series que ya están en tu
  lista de MAL no se buscan

Pestañas: Biblioteca (buscar, filtrar, ordenar), Datos (importar), Ajustes (claves).

Importar libros y películas tarda segundos: las sinopsis (Wikipedia en español,
Open Library y Wikipedia en inglés, por ese orden) y los datos de TMDB se traen
después con los botones «Completar» de la pestaña Datos, que procesan solo lo
pendiente y se pueden detener y reanudar.

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
- Libros: [Open Library](https://openlibrary.org).
- Resúmenes de Wikipedia (CC BY-SA): los textos de [Wikipedia](https://www.wikipedia.org)
  se usan bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es);
  la app guarda el enlace al artículo de origen de cada resumen.
- Modelo de embeddings (Fase 2): multilingual-e5-small (MIT).
- Código bajo licencia MIT (ver `LICENSE`).
