SELECT
  p.client_code,
  p.client_name,
  p.seller_id,
  s.name AS vendedor
FROM points_of_sale p
LEFT JOIN sellers s ON s.id = p.seller_id
LIMIT 20;