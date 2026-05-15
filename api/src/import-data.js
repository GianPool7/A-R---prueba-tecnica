import fs from 'node:fs';
import {parse} from 'csv-parse';
import {pool, withClient} from './db.js';

const pointsPath = new URL('../data/points.csv', import.meta.url).pathname;
const sellersPath = new URL('../data/sellers.csv', import.meta.url).pathname;

function excelSerialToDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 1) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  return new Date(excelEpoch + serial * 86400000).toISOString().slice(0, 10);
}

async function readCsv(path) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(path)
      .pipe(parse({columns: true, skip_empty_lines: true, trim: true}))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

async function importSellers(client) {
  const rows = await readCsv(sellersPath);
  for (const row of rows) {
    const id = Number(row.CODIGO);
    if (!Number.isFinite(id)) continue;
    await client.query(
      `INSERT INTO sellers (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [id, row['APELLIDOS Y NOMBRES DEL VENDEDOR']]
    );
  }
  return rows.length;
}

async function importPoints(client) {
  const rows = await readCsv(pointsPath);
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($4, $5), 4326))
       ON CONFLICT (client_code) DO UPDATE SET
         client_name = EXCLUDED.client_name,
         last_purchase_date = EXCLUDED.last_purchase_date,
         longitude = EXCLUDED.longitude,
         latitude = EXCLUDED.latitude,
         annual_purchase_amount = EXCLUDED.annual_purchase_amount,
         currency = EXCLUDED.currency,
         geom = EXCLUDED.geom`,
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

await withClient(async (client) => {
  await client.query('BEGIN');
  try {
    const sellers = await importSellers(client);
    const points = await importPoints(client);
    await client.query('COMMIT');
    console.log(`Imported ${sellers} sellers and ${points} points`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
});

await pool.end();
