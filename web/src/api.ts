import type {FeatureCollection, PointProperties, Seller, TerritoryProperties} from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {'Content-Type': 'application/json'},
    ...init
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getHealth() {
  return request<{ok: boolean; points: number; sellers: number; territories: number}>('/api/health');
}

export function getSellers() {
  return request<Seller[]>('/api/sellers');
}

export function getPoints(filter?: {lat: number; lng: number; radiusKm: number}) {
  const qs = filter ? `?lat=${filter.lat}&lng=${filter.lng}&radiusKm=${filter.radiusKm}` : '';
  return request<FeatureCollection<PointProperties>>(`/api/points${qs}`);
}

export function getTerritories() {
  return request<FeatureCollection<TerritoryProperties>>('/api/territories');
}

export function getTerritoryPoints(id: number) {
  return request<Array<{clientCode: string; clientName: string; currency: string; amount: number}>>(`/api/territories/${id}/points`);
}

export function generateTerritories(sellerIds: number[], clientsPerSeller: number) {
  return request<{created: number}>('/api/territories/auto', {
    method: 'POST',
    body: JSON.stringify({sellerIds, clientsPerSeller})
  });
}

export function uploadData(pointsCsv: string, sellersCsv: string) {
  return request<{points: number; sellers: number; territories: number; elapsedMs: number}>('/api/import', {
    method: 'POST',
    body: JSON.stringify({pointsCsv, sellersCsv})
  });
}

export function clearData() {
  return request<{points: number; sellers: number; territories: number}>('/api/clear', {
    method: 'POST'
  });
}
