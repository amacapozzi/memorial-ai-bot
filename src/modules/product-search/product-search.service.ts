import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { ProductResult } from "./product-search.types";
import { searchMercadoLibre } from "./providers/mercadolibre.provider";
import { searchGoogleShopping } from "./providers/serpapi.provider";

export class ProductSearchService {
  private readonly logger = createLogger("product-search");

  async search(query: string, mlAccessToken?: string): Promise<ProductResult[]> {
    this.logger.info(`Searching products for: "${query}"`);

    const serpApiKey = env().SERPAPI_API_KEY;

    const promises: Array<Promise<ProductResult[]>> = [
      searchMercadoLibre(query, 10, mlAccessToken)
    ];

    if (serpApiKey) {
      promises.push(searchGoogleShopping(query, serpApiKey));
    }

    const settled = await Promise.allSettled(promises);

    const allResults: ProductResult[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        allResults.push(...result.value);
      }
    }

    // Deduplicate by normalized title (first 50 chars, lowercase, no special chars)
    const seen = new Set<string>();
    const unique = allResults.filter((product) => {
      const key = product.title
        .substring(0, 50)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by price ascending, return top 5
    unique.sort((a, b) => a.price - b.price);

    this.logger.info(`Found ${unique.length} unique results, returning top 5`);
    return unique.slice(0, 5);
  }
}
