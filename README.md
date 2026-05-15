# Geo Puntos

Aplicación web para visualizar puntos de venta, segmentarlos por vendedores y generar territorios automáticos con polígonos.

## Stack

- React + TypeScript + Vite para el frontend.
- Google Maps JavaScript API + Places API para mapa y búsqueda.
- deck.gl para renderizar miles de puntos con WebGL.
- Node.js + Express para API.
- PostgreSQL 16 + PostGIS para persistencia y consultas geoespaciales.
- Docker Compose para levantar todo sin instalar base de datos ni dependencias globales.

## Ejecutar

1. Crea `.env` desde `.env.example` y coloca tu llave:

```bash
GOOGLE_MAPS_API_KEY=tu_api_key
```

2. Levanta los servicios:

```bash
docker compose up --build
```

3. Importa los datos del Excel convertidos a CSV:

```bash
docker compose exec api npm run import
```

4. Abre:

```bash
http://localhost:5173
```

La API queda en `http://localhost:4000`.

## Estrategia para 18k puntos

Los puntos se guardan en PostGIS con `geometry(Point, 4326)` e índice GiST. El frontend no crea 18k markers DOM; usa `ScatterplotLayer` de deck.gl, que renderiza con WebGL y mantiene el zoom/drag fluido. Los polígonos se muestran con `GeoJsonLayer`.

La generación de territorios se ejecuta en el backend. Se seleccionan puntos contiguos por proximidad, se calcula un convex hull, se persiste el polígono y luego PostGIS determina los puntos cubiertos con `ST_Covers`. Así el navegador no queda bloqueado por cálculos pesados.

## Librerías externas

- `deck.gl`: renderizado GPU para puntos y polígonos.
- `pg`: conexión PostgreSQL.
- `csv-parse`: carga de CSV exportado desde el Excel.
- `PostGIS`: índices y operaciones espaciales.
- Google Places API: autocomplete y filtro de puntos en radio de 3 km.

## Escalamiento a 500,000 puntos

Para 500k puntos no enviaría todos los puntos crudos al navegador. Usaría:

- Clustering o tiles vectoriales servidos por viewport y zoom.
- Consultas por bounds con índice GiST.
- Generalización/agregación por nivel de zoom.
- Workers o jobs backend para generar territorios en segundo plano.
- Cache de respuestas frecuentes y paginación de detalle.
- Posible uso de MVT (`ST_AsMVT`) para servir capas vectoriales desde PostGIS.
