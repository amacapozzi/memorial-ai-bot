import { createLogger } from "@shared/logger/logger";

import type {
  MeliSearchResponse,
  MeliSearchResult,
  MeliOrder,
  MeliOrdersResponse,
  MeliShipment
} from "./meli-api.types";
import type { MeliAuthService } from "../auth/meli-auth.service";

export class MeliApiService {
  private readonly logger = createLogger("meli-api");

  constructor(private readonly authService: MeliAuthService) {}

  private async fetchWithAuth(url: string, accessToken: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchProducts(userId: string, query: string, limit = 10): Promise<MeliSearchResult[]> {
    const { accessToken } = await this.authService.getAccessToken(userId);

    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await this.fetchWithAuth(url, accessToken);

    if (!response.ok) {
      this.logger.error(`MercadoLibre search error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as MeliSearchResponse;
    return data.results;
  }

  async getRecentOrders(userId: string, limit = 5): Promise<MeliOrder[]> {
    const { accessToken, mlUserId } = await this.authService.getAccessToken(userId);

    const url = `https://api.mercadolibre.com/orders/search?buyer=${mlUserId}&sort=date_desc&limit=${limit}`;
    const response = await this.fetchWithAuth(url, accessToken);

    if (!response.ok) {
      this.logger.error(`MercadoLibre orders error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as MeliOrdersResponse;
    return data.results;
  }

  async getShipment(userId: string, shipmentId: number): Promise<MeliShipment | null> {
    const { accessToken } = await this.authService.getAccessToken(userId);

    const url = `https://api.mercadolibre.com/shipments/${shipmentId}`;
    const response = await this.fetchWithAuth(url, accessToken);

    if (!response.ok) {
      this.logger.error(`MercadoLibre shipment error: ${response.status}`);
      return null;
    }

    return (await response.json()) as MeliShipment;
  }
}
