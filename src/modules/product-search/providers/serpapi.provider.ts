import { createLogger } from "@shared/logger/logger";

import type { ProductResult, SerpAPIShoppingResponse } from "../product-search.types";

const logger = createLogger("serpapi");

export async function searchGoogleShopping(
  query: string,
  apiKey: string,
  limit = 10
): Promise<ProductResult[]> {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&gl=ar&hl=es&api_key=${encodeURIComponent(apiKey)}&num=${limit}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.error(`SerpAPI error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as SerpAPIShoppingResponse;

    if (!data.shopping_results) {
      return [];
    }

    return data.shopping_results.slice(0, limit).map((item) => ({
      title: item.title,
      price: item.extracted_price,
      currency: "USD",
      seller: item.source,
      link: item.link,
      source: "Google Shopping" as const
    }));
  } catch (error) {
    logger.error("Google Shopping search failed", error);
    return [];
  }
}
