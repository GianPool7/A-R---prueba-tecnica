CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS sellers (
  id integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS points_of_sale (
  id bigserial PRIMARY KEY,
  client_code text UNIQUE NOT NULL,
  client_name text NOT NULL,
  last_purchase_date date,
  longitude double precision NOT NULL,
  latitude double precision NOT NULL,
  annual_purchase_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  seller_id integer REFERENCES sellers(id),
  color text NOT NULL DEFAULT '#8f8f8f',
  geom geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS points_of_sale_geom_gix ON points_of_sale USING gist (geom);
CREATE INDEX IF NOT EXISTS points_of_sale_seller_idx ON points_of_sale (seller_id);

CREATE TABLE IF NOT EXISTS territories (
  id bigserial PRIMARY KEY,
  seller_id integer NOT NULL REFERENCES sellers(id),
  color text NOT NULL,
  requested_clients integer NOT NULL,
  point_count integer NOT NULL DEFAULT 0,
  total_purchase_amount numeric(16,2) NOT NULL DEFAULT 0,
  geom geometry(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territories_geom_gix ON territories USING gist (geom);

CREATE TABLE IF NOT EXISTS territory_points (
  territory_id bigint NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  point_id bigint NOT NULL REFERENCES points_of_sale(id) ON DELETE CASCADE,
  PRIMARY KEY (territory_id, point_id)
);
