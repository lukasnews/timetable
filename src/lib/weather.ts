/** Wettervorhersage von Open-Meteo (kostenlos, ohne Schlüssel). Wird 1 Stunde zwischengespeichert. */
import { useEffect, useState } from 'react';

export interface DayWeather {
  code: number;
  max: number;
  min: number;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

/** Standard, solange kein Ort gewählt ist */
export const DEFAULT_PLACE: Place = { name: 'Linz', lat: 48.3064, lon: 14.2861 };

export function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function weatherText(code: number): string {
  if (code === 0) return 'Sonnig';
  if (code <= 2) return 'Leicht bewölkt';
  if (code === 3) return 'Bewölkt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 57) return 'Nieselregen';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Regen';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Schnee';
  if (code >= 95) return 'Gewitter';
  return '';
}

export function parseForecast(j: { daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] } }): Record<string, DayWeather> {
  const d = j.daily;
  const out: Record<string, DayWeather> = {};
  if (!d) return out;
  d.time.forEach((t, i) => {
    if (d.weather_code[i] == null) return;
    out[t] = { code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]) };
  });
  return out;
}

const CACHE = 'fk.weather';

export function useWeather(place: Place | undefined, enabled: boolean): Record<string, DayWeather> {
  const p = place ?? DEFAULT_PLACE;
  const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  const [data, setData] = useState<Record<string, DayWeather>>(() => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      return c?.key === key ? c.days : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const load = async () => {
      try {
        const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
        if (c?.key === key && Date.now() - c.at < 3600_000) { setData(c.days); return; }
        if (!navigator.onLine) return;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FVienna&forecast_days=16';
        const r = await fetch(url);
        if (!r.ok) return;
        const days = parseForecast(await r.json());
        if (stop) return;
        setData(days);
        localStorage.setItem(CACHE, JSON.stringify({ key, at: Date.now(), days }));
      } catch {
        /* offline oder Dienst nicht erreichbar – letzte Daten bleiben */
      }
    };
    load();
    const t = setInterval(load, 30 * 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return enabled ? data : {};
}

/** Ortssuche (Open-Meteo Geocoding) */
export async function searchPlaces(q: string): Promise<(Place & { region?: string })[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`);
  if (!r.ok) throw new Error('Ortssuche fehlgeschlagen');
  const j = (await r.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; country_code?: string }[] };
  return (j.results ?? []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, region: [x.admin1, x.country_code].filter(Boolean).join(', ') }));
}
