import { createLogger } from "@shared/logger/logger";

interface CoinGeckoPrice {
  usd: number;
  ars: number;
}

type CoinGeckoResponse = Record<string, CoinGeckoPrice>;

export interface CoinPrice {
  id: string;
  name: string;
  usd: number;
  ars: number;
}

const COIN_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  tether: "Tether",
  solana: "Solana",
  cardano: "Cardano",
  ripple: "XRP",
  dogecoin: "Dogecoin",
  binancecoin: "BNB",
  "matic-network": "Polygon",
  avalanche: "Avalanche"
};

const COIN_SYMBOLS: Record<string, string> = {
  bitcoin: "₿",
  ethereum: "Ξ",
  tether: "💲",
  solana: "◎",
  cardano: "₳",
  ripple: "✕",
  dogecoin: "Ð",
  binancecoin: "BNB",
  "matic-network": "MATIC",
  avalanche: "AVAX"
};

export class CryptoService {
  private readonly logger = createLogger("crypto");
  private readonly apiUrl = "https://api.coingecko.com/api/v3/simple/price";
  private readonly defaultCoins = ["bitcoin", "ethereum", "tether"];

  async getPrices(coins?: string[]): Promise<CoinPrice[]> {
    const ids = (coins && coins.length > 0 ? coins : this.defaultCoins).join(",");
    const url = `${this.apiUrl}?ids=${ids}&vs_currencies=usd,ars`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = (await response.json()) as CoinGeckoResponse;

      return Object.entries(data).map(([id, prices]) => ({
        id,
        name: COIN_NAMES[id] || id,
        usd: prices.usd,
        ars: prices.ars
      }));
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Failed to fetch crypto prices", error);
      throw error;
    }
  }

  formatMessage(prices: CoinPrice[]): string {
    const fmtUsd = (n: number) =>
      n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtArs = (n: number) =>
      n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let message = `🪙 *Precios Cripto*\n\n`;

    for (const coin of prices) {
      const symbol = COIN_SYMBOLS[coin.id] || "•";
      message += `${symbol} *${coin.name}:* $${fmtUsd(coin.usd)} USD | $${fmtArs(coin.ars)} ARS\n`;
    }

    message += `\n📊 CoinGecko · ahora`;
    return message;
  }
}
