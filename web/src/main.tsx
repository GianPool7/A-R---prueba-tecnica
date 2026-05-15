import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GoogleMapsOverlay} from '@deck.gl/google-maps';
import {GeoJsonLayer, ScatterplotLayer} from '@deck.gl/layers';
import {getHealth, generateTerritories, getPoints, getSellers, getTerritories, getTerritoryPoints} from './api';
import {loadGoogleMaps} from './google';
import type {FeatureCollection, PointProperties, Seller, TerritoryProperties} from './types';
import './styles.css';

const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const lima = {lat: -12.0464, lng: -77.0428};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function App() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const searchNode = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);

  const [health, setHealth] = useState({points: 0, sellers: 0, territories: 0});
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [selectedSellers, setSelectedSellers] = useState<number[]>([]);
  const [clientsPerSeller, setClientsPerSeller] = useState(200);
  const [points, setPoints] = useState<FeatureCollection<PointProperties> | null>(null);
  const [territories, setTerritories] = useState<FeatureCollection<TerritoryProperties> | null>(null);
  const [selectedTerritory, setSelectedTerritory] = useState<TerritoryProperties | null>(null);
  const [territoryPoints, setTerritoryPoints] = useState<Array<{clientCode: string; clientName: string; currency: string; amount: number}>>([]);
  const [loading, setLoading] = useState('Inicializando mapa');
  const [error, setError] = useState('');

  const refreshData = useCallback(async () => {
    setLoading('Cargando puntos');
    const [healthData, pointData, territoryData] = await Promise.all([
      getHealth(),
      getPoints(),
      getTerritories()
    ]);
    setHealth(healthData);
    setPoints(pointData);
    setTerritories(territoryData);
    setLoading('');
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const sellerData = await getSellers();
        setSellers(sellerData);
        setSelectedSellers(sellerData.slice(0, 5).map((seller) => seller.id));
        await refreshData();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando datos');
        setLoading('');
      }
    }
    boot();
  }, [refreshData]);

  useEffect(() => {
    if (!googleKey || !mapNode.current) return;
    loadGoogleMaps(googleKey).then(() => {
      if (!mapNode.current || mapRef.current) return;
      mapRef.current = new google.maps.Map(mapNode.current, {
        center: lima,
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });
      overlayRef.current = new GoogleMapsOverlay({layers: []});
      overlayRef.current.setMap(mapRef.current);

      if (searchNode.current) {
        const autocomplete = new google.maps.places.Autocomplete(searchNode.current, {
          fields: ['geometry', 'name']
        });
        autocomplete.addListener('place_changed', async () => {
          const place = autocomplete.getPlace();
          const location = place.geometry?.location;
          if (!location || !mapRef.current) return;
          const center = {lat: location.lat(), lng: location.lng()};
          mapRef.current.setCenter(center);
          mapRef.current.setZoom(14);
          setLoading('Filtrando radio de 3 km');
          const filtered = await getPoints({...center, radiusKm: 3});
          setPoints(filtered);
          setLoading('');
        });
      }
    }).catch((err) => setError(err.message));
  }, []);

  const layers = useMemo(() => {
    const pointLayer = points && new ScatterplotLayer({
      id: 'points',
      data: points.features,
      getPosition: (feature: {geometry: GeoJSON.Geometry}) => (feature.geometry as GeoJSON.Point).coordinates as [number, number],
      getRadius: 45,
      radiusMinPixels: 2,
      radiusMaxPixels: 8,
      getFillColor: (feature: {properties: PointProperties}) => [...hexToRgb(feature.properties.color), 210],
      pickable: true
    });

    const territoryLayer = territories && new GeoJsonLayer({
      id: 'territories',
      data: territories,
      stroked: true,
      filled: true,
      pickable: true,
      getFillColor: (feature: {properties: TerritoryProperties}) => [...hexToRgb(feature.properties.color), 42],
      getLineColor: (feature: {properties: TerritoryProperties}) => [...hexToRgb(feature.properties.color), 220],
      getLineWidth: 3,
      lineWidthMinPixels: 2,
      onClick: ({object}: {object?: {properties: TerritoryProperties}}) => {
        if (!object) return;
        void (async () => {
          setSelectedTerritory(object.properties);
          setTerritoryPoints(await getTerritoryPoints(object.properties.id));
        })();
      }
    });

    return [territoryLayer, pointLayer].filter(Boolean);
  }, [points, territories]);

  useEffect(() => {
    overlayRef.current?.setProps({layers});
  }, [layers]);

  const toggleSeller = (id: number) => {
    setSelectedSellers((current) =>
      current.includes(id) ? current.filter((sellerId) => sellerId !== id) : [...current, id]
    );
  };

  const runGeneration = async () => {
    try {
      setError('');
      setLoading('Generando polígonos');
      await generateTerritories(selectedSellers, clientsPerSeller);
      setSelectedTerritory(null);
      setTerritoryPoints([]);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando territorios');
      setLoading('');
    }
  };

  const resetFilter = async () => {
    if (searchNode.current) searchNode.current.value = '';
    mapRef.current?.setCenter(lima);
    mapRef.current?.setZoom(11);
    await refreshData();
  };

  if (!googleKey) {
    return (
      <main className="empty-state">
        <h1>Geo Puntos</h1>
        <p>Configura <code>GOOGLE_MAPS_API_KEY</code> en un archivo <code>.env</code> y vuelve a levantar Docker.</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="map-region">
        <div ref={mapNode} className="map" />
        {loading && <div className="loader">{loading}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      <aside className="sidebar">
        <header>
          <h1>Geo Puntos</h1>
          <div className="stats">
            <span>{health.points.toLocaleString('es-PE')} puntos</span>
            <span>{health.sellers} vendedores</span>
            <span>{health.territories} polígonos</span>
          </div>
        </header>

        <label className="field">
          <span>Buscar ubicación</span>
          <input ref={searchNode} placeholder="Distrito, avenida o local" />
        </label>
        <button className="secondary" onClick={resetFilter}>Ver todos los puntos</button>

        <div className="controls">
          <label className="field">
            <span>Clientes por vendedor</span>
            <input
              type="number"
              min="1"
              value={clientsPerSeller}
              onChange={(event) => setClientsPerSeller(Number(event.target.value))}
            />
          </label>
          <button onClick={runGeneration} disabled={selectedSellers.length === 0 || !!loading}>
            Generar polígonos
          </button>
        </div>

        <section className="seller-list">
          <div className="section-title">
            <strong>Vendedores</strong>
            <span>{selectedSellers.length} seleccionados</span>
          </div>
          <div className="seller-scroll">
            {sellers.map((seller) => (
              <label key={seller.id} className="seller-row">
                <input
                  type="checkbox"
                  checked={selectedSellers.includes(seller.id)}
                  onChange={() => toggleSeller(seller.id)}
                />
                <span>{seller.id}. {seller.name}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="territory-panel">
          <div className="section-title">
            <strong>Polígono</strong>
            {selectedTerritory && <span>{selectedTerritory.pointCount} puntos</span>}
          </div>
          {selectedTerritory ? (
            <>
              <div className="territory-summary" style={{borderColor: selectedTerritory.color}}>
                <strong>{selectedTerritory.sellerName}</strong>
                <span>Total: S/ {selectedTerritory.totalPurchaseAmount.toLocaleString('es-PE')}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Cliente</th>
                      <th>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {territoryPoints.map((point) => (
                      <tr key={point.clientCode}>
                        <td>{point.clientCode}</td>
                        <td>{point.clientName}</td>
                        <td>{point.currency} {point.amount.toLocaleString('es-PE')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">Haz click en un polígono para ver sus clientes.</p>
          )}
        </section>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
