import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

interface MapSectionProps {
  locationStats: any[];
  t: (key: string) => string;
}

export function MapSection({ locationStats, t }: MapSectionProps) {
  useEffect(() => {
    // This is needed because Leaflet's default icon paths are often broken in build environments
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: markerIcon,
      iconRetinaUrl: markerIcon2x,
      shadowUrl: markerShadow,
    });
  }, []);

  const createCustomIcon = (count: number) => {
    return L.divIcon({
      html: `
        <div class="relative">
          <img src="${markerIcon}" style="width: 25px; height: 41px;" />
          ${count > 0 ? `
            <div class="absolute -top-2 -right-2 bg-emerald-600 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-white shadow-sm animate-in zoom-in duration-300">
              ${count}
            </div>
          ` : ''}
        </div>
      `,
      className: '',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
    });
  };

  return (
    <div className="h-[500px] w-full z-0 overflow-hidden rounded-b-lg">
      <MapContainer 
        center={[42.6977, 23.3219]} 
        zoom={7} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {locationStats.map(loc => (
          <React.Fragment key={loc.id}>
            <Marker 
              position={[loc.latitude, loc.longitude]}
              icon={createCustomIcon(loc.count || 0)}
            >
              <Popup>
                <div className="p-1 min-w-[120px]">
                  <h3 className="font-bold border-b pb-1 mb-1 text-zinc-900">{loc.name}</h3>
                  <div className="space-y-1 text-xs">
                    <p className="flex justify-between items-center gap-4">
                      <span className="text-zinc-500 font-medium">{t('Active')}:</span>
                      <span className="font-bold text-emerald-600 text-sm">{loc.count || 0}</span>
                    </p>
                    {loc.users && loc.users.length > 0 && (
                      <div className="mt-2 pt-1 border-t border-zinc-100">
                        <p className="text-[10px] text-zinc-400 mb-1 uppercase font-semibold tracking-wider">{t('On Site')}:</p>
                        <div className="flex flex-wrap gap-1">
                          {loc.users.map((user: string, idx: number) => (
                            <span key={idx} className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded text-[10px] border border-zinc-200">
                              {user}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
            <Circle 
              center={[loc.latitude, loc.longitude]} 
              radius={loc.radius}
              pathOptions={{ 
                color: (loc.count || 0) > 0 ? '#10b981' : '#6366f1',
                fillColor: (loc.count || 0) > 0 ? '#10b981' : '#6366f1',
                fillOpacity: 0.1
              }}
            />
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
