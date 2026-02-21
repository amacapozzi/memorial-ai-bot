export interface ProductResult {
  title: string;
  price: number;
  currency: string;
  seller: string;
  link: string;
  source: "MercadoLibre" | "Google Shopping";
}

export interface MercadoLibreSearchResponse {
  results: Array<{
    id: string;
    title: string;
    price: number;
    currency_id: string;
    seller: {
      nickname: string;
    };
    permalink: string;
  }>;
}

export interface SerpAPIShoppingResponse {
  shopping_results?: Array<{
    title: string;
    price: string;
    extracted_price: number;
    source: string;
    link: string;
  }>;
}
