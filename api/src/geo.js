export const palette = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#be123c', '#4f46e5', '#65a30d', '#0f766e',
  '#a16207', '#7c3aed', '#0284c7', '#c2410c', '#15803d'
];

export function colorForIndex(index) {
  return palette[index % palette.length];
}

function cross(origin, a, b) {
  return (a.lng - origin.lng) * (b.lat - origin.lat) - (a.lat - origin.lat) * (b.lng - origin.lng);
}

export function convexHull(points) {
  const unique = [...new Map(points.map((p) => [`${p.lng},${p.lat}`, p])).values()]
    .sort((a, b) => a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng);

  if (unique.length <= 2) return bufferedBox(unique);

  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return bufferedPolygon(hull);
}

function bufferedBox(points) {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  const minLng = Math.min(...lngs) - 0.002;
  const maxLng = Math.max(...lngs) + 0.002;
  const minLat = Math.min(...lats) - 0.002;
  const maxLat = Math.max(...lats) + 0.002;
  return [[
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ]];
}

function bufferedPolygon(points) {
  const center = points.reduce(
    (acc, p) => ({lng: acc.lng + p.lng / points.length, lat: acc.lat + p.lat / points.length}),
    {lng: 0, lat: 0}
  );
  const ring = points.map((p) => {
    const dx = p.lng - center.lng;
    const dy = p.lat - center.lat;
    return [center.lng + dx * 1.08, center.lat + dy * 1.08];
  });
  ring.push(ring[0]);
  return [ring];
}

export function haversineKm(a, b) {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radius * Math.asin(Math.sqrt(x));
}

function toRad(value) {
  return value * Math.PI / 180;
}
