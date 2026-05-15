export type Seller = {
  id: number;
  name: string;
};

export type PointProperties = {
  id: number;
  clientCode: string;
  clientName: string;
  amount: number;
  currency: string;
  sellerId: number | null;
  color: string;
};

export type TerritoryProperties = {
  id: number;
  sellerId: number;
  sellerName: string;
  color: string;
  pointCount: number;
  totalPurchaseAmount: number;
};

export type FeatureCollection<T> = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: T;
  }>;
};

declare global {
  interface Window {
    google: typeof google;
  }
}
