import { createLogger } from "@shared/logger/logger";

import type { MercadoLibreSearchResponse, ProductResult } from "../product-search.types";

const logger = createLogger("mercadolibre");

export async function searchMercadoLibre(
  query: string,
  limit = 10,
  accessToken?: string
): Promise<ProductResult[]> {
  const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=${limit}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.error(`MercadoLibre API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as MercadoLibreSearchResponse;

    return data.results.map((item) => ({
      title: item.title,
      price: item.price,
      currency: item.currency_id,
      seller: item.seller.nickname,
      link: item.permalink,
      source: "MercadoLibre" as const
    }));
  } catch (error) {
    logger.error("MercadoLibre search failed", error);
    return [];
  }
}
