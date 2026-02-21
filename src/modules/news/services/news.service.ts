import { createLogger } from "@shared/logger/logger";

interface NewsApiArticle {
  title: string;
  source: { name: string };
  url: string;
  publishedAt: string;
  description?: string;
}

interface NewsApiResponse {
  status: string;
  articles: NewsApiArticle[];
  message?: string;
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: Date;
}

export type NewsCategory =
  | "general"
  | "business"
  | "technology"
  | "sports"
  | "entertainment"
  | "health"
  | "science";

export class NewsService {
  private readonly logger = createLogger("news");
  private readonly baseUrl = "https://newsapi.org/v2";

  constructor(private readonly apiKey: string) {}

  async getTopHeadlines(options?: {
    query?: string;
    category?: NewsCategory;
    pageSize?: number;
  }): Promise<NewsArticle[]> {
    const pageSize = options?.pageSize ?? 5;
    let url: string;

    if (options?.query) {
      // Use /everything for keyword queries
      const params = new URLSearchParams({
        q: options.query,
        language: "es",
        sortBy: "publishedAt",
        pageSize: String(pageSize),
        apiKey: this.apiKey
      });
      url = `${this.baseUrl}/everything?${params}`;
    } else {
      // Use /top-headlines for categories
      const params = new URLSearchParams({
        country: "ar",
        language: "es",
        pageSize: String(pageSize),
        apiKey: this.apiKey
      });
      if (options?.category && options.category !== "general") {
        params.set("category", options.category);
      }
      url = `${this.baseUrl}/top-headlines?${params}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`NewsAPI error: ${response.status}`);
      }

      const data = (await response.json()) as NewsApiResponse;

      if (data.status !== "ok") {
        throw new Error(`NewsAPI error: ${data.message}`);
      }

      return data.articles
        .filter((a) => a.title && a.title !== "[Removed]")
        .map((a) => ({
          title: a.title,
          source: a.source.name,
          url: a.url,
          publishedAt: new Date(a.publishedAt)
        }));
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Failed to fetch news", error);
      throw error;
    }
  }

  formatMessage(articles: NewsArticle[], query?: string): string {
    const header = query ? `📰 *Noticias sobre "${query}"*` : `📰 *Noticias de hoy*`;

    if (articles.length === 0) {
      return `${header}\n\nNo encontre noticias en este momento.`;
    }

    const now = new Date();
    let message = `${header}\n\n`;

    articles.forEach((article, index) => {
      const ageMs = now.getTime() - article.publishedAt.getTime();
      const ageHours = Math.floor(ageMs / 3600000);
      const ageMin = Math.floor(ageMs / 60000);
      const ageStr = ageHours >= 1 ? `hace ${ageHours}h` : `hace ${ageMin} min`;

      message += `*${index + 1}.* ${article.title}\n`;
      message += `   📺 ${article.source} · ${ageStr}\n`;
      message += `   🔗 ${article.url}\n\n`;
    });

    return message.trim();
  }
}
