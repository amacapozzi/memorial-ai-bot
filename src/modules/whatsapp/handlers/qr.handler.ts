// @ts-expect-error - qrcode-terminal has no type declarations
import qrcode from "qrcode-terminal";

import { createLogger } from "@shared/logger/logger";

export class QRHandler {
  private readonly logger = createLogger("qr");

  displayQR(qr: string): void {
    this.logger.info("Scan the QR code below to connect WhatsApp:");
    console.log("\n");
    qrcode.generate(qr, { small: true });
    console.log("\n");
  }
}
