import { createLogger } from "@shared/logger/logger";

interface BluelyticsResponse {
  oficial: { value_buy: number; value_sell: number };
  blue: { value_buy: number; value_sell: number };
  oficial_euro: { value_buy: number; value_sell: number };
  blue_euro: { value_buy: number; value_sell: number };
  last_update: string;
}

export interface DollarRates {
  oficial: { buy: number; sell: number };
  blue: { buy: number; sell: number };
  oficialEuro: { buy: number; sell: number };
  blueEuro: { buy: number; sell: number };
  lastUpdate: string;
}

export class DollarService {
  private readonly logger = createLogger("dollar");
  private readonly apiUrl = "https://api.bluelytics.com.ar/v2/latest";

  async getRates(): Promise<DollarRates> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(this.apiUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Bluelytics API error: ${response.status}`);
      }

      const data = (await response.json()) as BluelyticsResponse;

      return {
        oficial: { buy: data.oficial.value_buy, sell: data.oficial.value_sell },
        blue: { buy: data.blue.value_buy, sell: data.blue.value_sell },
        oficialEuro: { buy: data.oficial_euro.value_buy, sell: data.oficial_euro.value_sell },
        blueEuro: { buy: data.blue_euro.value_buy, sell: data.blue_euro.value_sell },
        lastUpdate: data.last_update
      };
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Failed to fetch dollar rates", error);
      throw error;
    }
  }

  formatMessage(rates: DollarRates): string {
    const fmt = (n: number) =>
      n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const updateDate = new Date(rates.lastUpdate);
    const timeStr = updateDate.toLocaleTimeString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit",
      minute: "2-digit"
    });

    return (
      `💵 *Cotización del Dólar*\n\n` +
      `🏦 *Oficial:* $${fmt(rates.oficial.sell)} venta | $${fmt(rates.oficial.buy)} compra\n` +
      `🔵 *Blue:* $${fmt(rates.blue.sell)} venta | $${fmt(rates.blue.buy)} compra\n` +
      `💶 *Euro Oficial:* $${fmt(rates.oficialEuro.sell)} venta\n` +
      `💙 *Euro Blue:* $${fmt(rates.blueEuro.sell)} venta\n\n` +
      `🕐 Actualizado: ${timeStr} hs`
    );
  }
}
