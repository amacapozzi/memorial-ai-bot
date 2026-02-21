import { createLogger } from "@shared/logger/logger";

export type TravelMode = "driving" | "transit" | "walking" | "bicycling";

// ORS doesn't support transit routing — map it to driving-car
const ORS_PROFILES: Record<TravelMode, string> = {
  driving: "driving-car",
  transit: "driving-car",
  walking: "foot-walking",
  bicycling: "cycling-regular"
};

const MODE_ICONS: Record<TravelMode, string> = {
  driving: "🚗",
  transit: "🚗",
  walking: "🚶",
  bicycling: "🚲"
};

const MODE_LABELS: Record<TravelMode, string> = {
  driving: "En auto",
  transit: "En auto",
  walking: "Caminando",
  bicycling: "En bicicleta"
};

interface GeocodeResponse {
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: { label: string };
  }>;
}

interface ORSRoute {
  summary: { distance: number; duration: number };
  segments: Array<{
    steps: Array<{ instruction: string; duration: number; distance: number }>;
  }>;
}

interface ORSDirectionsResponse {
  routes: ORSRoute[];
  error?: { code: number; message: string };
}

export interface Coordinates {
  lat: number;
  lon: number;
  label?: string;
}

export interface RouteResult {
  duration: string;
  distance: string;
  steps: string[];
  origin: string;
  destination: string;
  mode: TravelMode;
}

const ORS_BASE = "https://api.openrouteservice.org";

export class MapsService {
  private readonly logger = createLogger("maps");

  constructor(private readonly apiKey: string) {}

  async geocodeAddress(address: string): Promise<Coordinates> {
    const coords = await this.geocode(address);
    return { lon: coords[0], lat: coords[1], label: address };
  }

  private async geocode(address: string): Promise<[number, number]> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      text: address,
      "boundary.country": "AR",
      size: "1"
    });

    const response = await fetch(`${ORS_BASE}/geocode/search?${params}`);

    if (!response.ok) {
      throw new Error(`Geocoding error: ${response.status}`);
    }

    const data = (await response.json()) as GeocodeResponse;

    if (!data.features?.length) {
      throw new Error(`No se encontró la dirección: "${address}"`);
    }

    return data.features[0].geometry.coordinates; // [lon, lat]
  }

  async getDirectionsFromCoords(
    originCoords: Coordinates,
    destination: string,
    mode: TravelMode = "transit"
  ): Promise<RouteResult> {
    const destCoords = await this.geocode(destination);
    return this.fetchRoute(
      [originCoords.lon, originCoords.lat],
      destCoords,
      originCoords.label ?? `${originCoords.lat},${originCoords.lon}`,
      destination,
      mode
    );
  }

  async getDirections(
    origin: string,
    destination: string,
    mode: TravelMode = "transit"
  ): Promise<RouteResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Geocode both addresses in parallel
      const [originCoords, destCoords] = await Promise.all([
        this.geocode(origin),
        this.geocode(destination)
      ]);

      return this.fetchRoute(originCoords, destCoords, origin, destination, mode);
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Failed to get directions", error);
      throw error;
    }
  }

  private async fetchRoute(
    originCoords: [number, number],
    destCoords: [number, number],
    originLabel: string,
    destLabel: string,
    mode: TravelMode
  ): Promise<RouteResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const profile = ORS_PROFILES[mode] ?? "driving-car";

      const response = await fetch(`${ORS_BASE}/v2/directions/${profile}/json`, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json"
        },
        body: JSON.stringify({
          coordinates: [originCoords, destCoords],
          language: "es",
          instructions: true
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(err.error?.message ?? `ORS error: ${response.status}`);
      }

      const data = (await response.json()) as ORSDirectionsResponse;

      if (!data.routes?.length) {
        throw new Error("No se encontró ruta entre esos puntos.");
      }

      const route = data.routes[0];
      const steps = route.segments[0].steps
        .slice(0, 8)
        .map((s) => `${s.instruction} (${this.formatDuration(s.duration)})`);

      return {
        duration: this.formatDuration(route.summary.duration),
        distance: this.formatDistance(route.summary.distance),
        steps,
        origin: originLabel,
        destination: destLabel,
        mode
      };
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Failed to fetch route", error);
      throw error;
    }
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }

  private formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  formatMessage(route: RouteResult): string {
    const icon = MODE_ICONS[route.mode];
    const modeLabel = MODE_LABELS[route.mode];

    const osmUrl = `https://www.openstreetmap.org/directions?from=${encodeURIComponent(route.origin)}&to=${encodeURIComponent(route.destination)}`;

    let message =
      `🗺️ *Cómo llegar*\n` +
      `📍 *De:* ${route.origin} → *A:* ${route.destination}\n\n` +
      `${icon} *${modeLabel}:* ${route.duration} (${route.distance})\n\n`;

    if (route.steps.length > 0) {
      message += `📋 *Pasos:*\n`;
      route.steps.forEach((step, i) => {
        message += `${i + 1}. ${step}\n`;
      });
      message += "\n";
    }

    message += `🔗 Ver en mapa: ${osmUrl}`;
    return message;
  }
}
