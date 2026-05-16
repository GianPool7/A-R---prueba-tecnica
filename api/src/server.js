import cors from 'cors';
import express from 'express';
import {parse} from 'csv-parse/sync';
import {pool, withClient} from './db.js';
import {colorForIndex, convexHull, haversineKm} from './geo.js';

const app = express();
app.use(cors());
app.use(express.json({limit: '25mb'}));

function excelSerialToDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 1) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  return new Date(excelEpoch + serial * 86400000).toISOString().slice(0, 10);
}

function parseCsv(content, label) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(`${label} CSV is required`);
  }
  return parse(content, {columns: true, skip_empty_lines: true, trim: true});
}

function parsePointsContent(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('points file is required');
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return parseCsv(content, 'points');
  }

  const json = JSON.parse(trimmed);
  const features = Array.isArray(json) ? json : json.features;
  if (!Array.isArray(features)) {
    throw new Error('points GeoJSON must be a FeatureCollection or an array of features');
  }

  return features.map((feature) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    return {
      Cliente: properties.clientCode || properties.client_code || properties.Cliente || properties.id,
      Nombre_del_cliente: properties.clientName || properties.client_name || properties.Nombre_del_cliente || 'Cliente sin nombre',
      Ultima_fecha_de_compra: properties.lastPurchaseDate || properties.last_purchase_date || properties.Ultima_fecha_de_compra,
      Longitud: coordinates[0] ?? properties.longitude ?? properties.Longitud,
      Latitud: coordinates[1] ?? properties.latitude ?? properties.Latitud,
      Monto_Compra_anual: properties.amount ?? properties.annual_purchase_amount ?? properties.Monto_Compra_anual ?? 0,
      Moneda: properties.currency || properties.Moneda || 'S/'
    };
  });
}

async function importSellersRows(client, rows) {
  let imported = 0;
  for (const row of rows) {
    const id = Number(row.CODIGO);
    if (!Number.isFinite(id)) continue;
    await client.query(
      `INSERT INTO sellers (id, name)
       VALUES ($1, $2)`,
      [id, row['APELLIDOS Y NOMBRES DEL VENDEDOR']]
    );
    imported += 1;
  }
  return imported;
}

async function importPointRows(client, rows) {
  let imported = 0;
  for (const row of rows) {
    const lng = Number(row.Longitud);
    const lat = Number(row.Latitud);
    if (!row.Cliente || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    await client.query(
      `INSERT INTO points_of_sale (
         client_code, client_name, last_purchase_date, longitude, latitude,
         annual_purchase_amount, currency, geom
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
      [
        row.Cliente,
        row.Nombre_del_cliente,
        excelSerialToDate(row.Ultima_fecha_de_compra),
        lng,
        lat,
        Number(row.Monto_Compra_anual || 0),
        row.Moneda || 'S/'
      ]
    );
    imported += 1;
  }
  return imported;
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const {rows} = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM points_of_sale) AS points,
        (SELECT count(*)::int FROM sellers) AS sellers,
        (SELECT count(*)::int FROM territories) AS territories
    `);
    res.json({ok: true, ...rows[0]});
  } catch (error) {
    next(error);
  }
});

app.get('/api/sellers', async (_req, res, next) => {
  try {
    const {rows} = await pool.query('SELECT id, name FROM sellers ORDER BY id');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/import', async (req, res, next) => {
  const start = performance.now();
  try {
    const sellersRows = parseCsv(req.body.sellersCsv, 'sellers');
    const pointRows = parsePointsContent(req.body.pointsCsv);

    const result = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('TRUNCATE territory_points, territories, points_of_sale, sellers RESTART IDENTITY CASCADE');
        const sellers = await importSellersRows(client, sellersRows);
        const points = await importPointRows(client, pointRows);
        await client.query('COMMIT');
        return {sellers, points};
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    const elapsedMs = Math.round(performance.now() - start);
    res.json({...result, territories: 0, elapsedMs});
  } catch (error) {
    next(error);
  }
});

app.post('/api/clear', async (_req, res, next) => {
  try {
    await pool.query('TRUNCATE territory_points, territories, points_of_sale, sellers RESTART IDENTITY CASCADE');
    res.json({points: 0, sellers: 0, territories: 0});
  } catch (error) {
    next(error);
  }
});

app.get('/api/points', async (req, res, next) => {
  try {
    const {lat, lng, radiusKm} = req.query;
    const params = [];
    let where = '';
    if (lat && lng && radiusKm) {
      params.push(Number(lng), Number(lat), Number(radiusKm) * 1000);
      where = `WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`;
    }
    const {rows} = await pool.query(
      `SELECT id, client_code, client_name, longitude, latitude,
              annual_purchase_amount, currency, seller_id, color
       FROM points_of_sale
       ${where}
       ORDER BY id`,
      params
    );
    res.json({
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)]},
        properties: {
          id: row.id,
          clientCode: row.client_code,
          clientName: row.client_name,
          amount: Number(row.annual_purchase_amount),
          currency: row.currency,
          sellerId: row.seller_id,
          color: row.color
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/territories', async (_req, res, next) => {
  try {
    const {rows} = await pool.query(`
      SELECT t.id, t.seller_id, s.name AS seller_name, t.color, t.point_count,
             t.total_purchase_amount, ST_AsGeoJSON(t.geom)::json AS geometry
      FROM territories t
      JOIN sellers s ON s.id = t.seller_id
      ORDER BY t.id
    `);
    res.json({
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          id: row.id,
          sellerId: row.seller_id,
          sellerName: row.seller_name,
          color: row.color,
          pointCount: row.point_count,
          totalPurchaseAmount: Number(row.total_purchase_amount)
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/territories/:id/points', async (req, res, next) => {
  try {
    const {rows} = await pool.query(`
      SELECT p.client_code, p.client_name, p.currency, p.annual_purchase_amount
      FROM territory_points tp
      JOIN points_of_sale p ON p.id = tp.point_id
      WHERE tp.territory_id = $1
      ORDER BY p.client_code
    `, [req.params.id]);
    res.json(rows.map((row) => ({
      clientCode: row.client_code,
      clientName: row.client_name,
      currency: row.currency,
      amount: Number(row.annual_purchase_amount)
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/territories/auto', async (req, res, next) => {
  const sellerIds = Array.isArray(req.body.sellerIds) ? req.body.sellerIds.map(Number).filter(Number.isFinite) : [];
  const clientsPerSeller = Number(req.body.clientsPerSeller);
  if (sellerIds.length === 0 || !Number.isInteger(clientsPerSeller) || clientsPerSeller <= 0) {
    res.status(400).json({error: 'sellerIds and positive clientsPerSeller are required'});
    return;
  }

  try {
    const result = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('TRUNCATE territory_points, territories RESTART IDENTITY');
        await client.query("UPDATE points_of_sale SET seller_id = NULL, color = '#8f8f8f'");

        const {rows} = await client.query(`
          SELECT id, longitude::float AS lng, latitude::float AS lat
          FROM points_of_sale
          ORDER BY longitude, latitude
        `);
        const remaining = rows.map((row) => ({id: row.id, lng: row.lng, lat: row.lat}));
        const created = [];

        for (let index = 0; index < sellerIds.length && remaining.length > 0; index += 1) {
          const sellerId = sellerIds[index];
          const seed = remaining[0];
          const selected = remaining
            .map((point) => ({...point, distance: haversineKm(seed, point)}))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, Math.min(clientsPerSeller, remaining.length));
          const selectedIds = new Set(selected.map((point) => point.id));
          for (let i = remaining.length - 1; i >= 0; i -= 1) {
            if (selectedIds.has(remaining[i].id)) remaining.splice(i, 1);
          }

          const color = colorForIndex(index);
          const coordinates = convexHull(selected);
          const geometry = {type: 'Polygon', coordinates};
          const territory = await client.query(
            `INSERT INTO territories (seller_id, color, requested_clients, geom)
             VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
             RETURNING id`,
            [sellerId, color, clientsPerSeller, JSON.stringify(geometry)]
          );
          const territoryId = territory.rows[0].id;

          await client.query(`
            INSERT INTO territory_points (territory_id, point_id)
            SELECT $1, p.id
            FROM points_of_sale p, territories t
            WHERE t.id = $1
              AND (ST_Covers(t.geom, p.geom) OR p.id = ANY($2::bigint[]))
              AND p.seller_id IS NULL
            ON CONFLICT DO NOTHING
          `, [territoryId, [...selectedIds]]);

          await client.query(`
            UPDATE points_of_sale p
            SET seller_id = $1, color = $2
            FROM territory_points tp
            WHERE tp.point_id = p.id AND tp.territory_id = $3
          `, [sellerId, color, territoryId]);

          await client.query(`
            UPDATE territories t
            SET point_count = stats.point_count,
                total_purchase_amount = stats.total_purchase_amount
            FROM (
              SELECT tp.territory_id, count(*)::int AS point_count,
                     coalesce(sum(p.annual_purchase_amount), 0) AS total_purchase_amount
              FROM territory_points tp
              JOIN points_of_sale p ON p.id = tp.point_id
              WHERE tp.territory_id = $1
              GROUP BY tp.territory_id
            ) stats
            WHERE t.id = stats.territory_id
          `, [territoryId]);

          created.push({territoryId, sellerId});
        }

        await client.query('COMMIT');
        return created;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    res.json({created: result.length, territories: result});
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({error: error.message});
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
