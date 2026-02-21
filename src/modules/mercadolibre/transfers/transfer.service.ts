import { createLogger } from "@shared/logger/logger";

import type { MeliAuthService } from "../auth/meli-auth.service";

const MP_API = "https://api.mercadopago.com";

export interface TransferRequest {
  recipient: string; // alias, CVU or CBU
  amount: number;
  description?: string;
}

export interface TransferResult {
  success: boolean;
  transactionId?: string;
  message: string;
}

interface MPTransferResponse {
  id?: string | number;
  status?: string;
  error?: string;
  message?: string;
  cause?: Array<{ code: string; description: string }>;
}

function isAlias(value: string): boolean {
  // CBU: 22 digits, CVU: 22 digits starting with 000003
  // Alias: anything else (letters, dots, hyphens)
  return !/^\d{22}$/.test(value);
}

export class MeliTransferService {
  private readonly logger = createLogger("meli-transfer");

  constructor(private readonly meliAuthService: MeliAuthService) {}

  async sendTransfer(userId: string, request: TransferRequest): Promise<TransferResult> {
    const { accessToken } = await this.meliAuthService.getAccessToken(userId);

    const body: Record<string, unknown> = {
      amount: request.amount,
      description: request.description ?? "Transferencia"
    };

    // Resolve recipient: alias or CBU/CVU
    if (isAlias(request.recipient)) {
      body["alias"] = request.recipient;
    } else {
      body["cbu"] = request.recipient;
    }

    this.logger.info(
      `Sending transfer of $${request.amount} to ${request.recipient} for user ${userId}`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${MP_API}/v1/account/bank_transfers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `${userId}-${Date.now()}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = (await response.json()) as MPTransferResponse;

      if (!response.ok) {
        const causeMsg =
          data.cause?.[0]?.description ?? data.message ?? data.error ?? "Error desconocido";
        this.logger.error(`Transfer failed: ${response.status} - ${causeMsg}`);
        return { success: false, message: causeMsg };
      }

      const txId = String(data.id ?? "");
      this.logger.info(`Transfer successful: ${txId}`);
      return {
        success: true,
        transactionId: txId,
        message: `Transferencia realizada exitosamente${txId ? ` (ID: ${txId})` : ""}`
      };
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error("Transfer request failed", error);
      throw error;
    }
  }
}
