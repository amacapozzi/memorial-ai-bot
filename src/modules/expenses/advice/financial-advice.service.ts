import type { GroqClient } from "@modules/ai/groq/groq.client";
import { createLogger } from "@shared/logger/logger";

import type { ExpenseSummary } from "../expense.service";

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: "Comida y bebida",
  TRANSPORT: "Transporte",
  SHOPPING: "Compras",
  UTILITIES: "Servicios del hogar",
  ENTERTAINMENT: "Entretenimiento",
  HEALTH: "Salud",
  EDUCATION: "Educacion",
  TRAVEL: "Viajes",
  SERVICES: "Servicios",
  OTHER: "Otros"
};

export class FinancialAdviceService {
  private readonly logger = createLogger("financial-advice");

  constructor(private readonly groqClient: GroqClient) {}

  async generateAdvice(summary: ExpenseSummary, period: string): Promise<string> {
    if (summary.transactionCount === 0) {
      return "No hay suficientes datos de gastos para generar consejos personalizados.";
    }

    const summaryText = this.buildSummaryText(summary, period);

    const systemPrompt = `Sos un asesor financiero personal amigable y cercano que ayuda a personas en Argentina a mejorar sus finanzas. Usas espanol rioplatense (vos en lugar de tu).

Dado el resumen de gastos del usuario, genera 3-4 consejos personalizados, concretos y accionables sobre:
- Patrones de gastos y donde puede ahorrar
- Categorias donde esta gastando mucho
- Recomendaciones practicas para Argentina (contexto de inflacion, economia local)
- Un consejo positivo de refuerzo

IMPORTANTE:
- Se especifico con numeros cuando sea relevante
- Usa emojis para hacerlo mas amigable (1 por consejo)
- Maximo 4-5 lineas por consejo
- Tono amigable y motivador, no alarmista
- Considera el contexto economico argentino`;

    try {
      const advice = await this.groqClient.chat(systemPrompt, summaryText);
      return advice;
    } catch (error) {
      this.logger.error("Failed to generate financial advice", error);
      return "No pude generar consejos en este momento. Intenta mas tarde.";
    }
  }

  private buildSummaryText(summary: ExpenseSummary, period: string): string {
    const lines: string[] = [`Resumen de gastos - ${period}:`];

    if (summary.totals.length > 0) {
      lines.push("\nTotal gastado:");
      for (const t of summary.totals) {
        lines.push(`  ${t.currency}: ${this.formatAmount(t.amount, t.currency)}`);
      }
    }

    if (summary.categoryBreakdown.length > 0) {
      lines.push("\nPor categoria:");
      for (const c of summary.categoryBreakdown) {
        const label = CATEGORY_LABELS[c.category] ?? c.category;
        lines.push(`  ${label}: ${this.formatAmount(c.amount, c.currency)}`);
      }
    }

    if (summary.topMerchants.length > 0) {
      lines.push("\nPrincipales comercios:");
      for (const m of summary.topMerchants) {
        lines.push(`  ${m.merchant}: ${this.formatAmount(m.amount, m.currency)}`);
      }
    }

    lines.push(`\nTotal de transacciones: ${summary.transactionCount}`);

    return lines.join("\n");
  }

  private formatAmount(amount: number, currency: string): string {
    if (currency === "ARS") {
      return `$${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS`;
    }
    if (currency === "USD") {
      return `US$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${currency}`;
  }
}
