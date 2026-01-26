import type {
  AuthenticationCreds,
  SignalDataTypeMap,
  SignalDataSet
} from "@whiskeysockets/baileys";
import { initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";

import { createLogger } from "@shared/logger/logger";

import type { SessionRepository } from "./session.repository";

type AuthState = {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
};

export class SessionService {
  private readonly logger = createLogger("session");

  constructor(private readonly repository: SessionRepository) {}

  async getAuthState(): Promise<{
    state: {
      creds: AuthenticationCreds;
      keys: {
        get: <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ) => Promise<{ [id: string]: SignalDataTypeMap[T] }>;
        set: (data: SignalDataSet) => Promise<void>;
      };
    };
    saveCreds: () => Promise<void>;
  }> {
    const session = await this.repository.findById("default");

    let creds: AuthenticationCreds;
    let keys: Record<string, Record<string, unknown>> = {};

    if (session?.data) {
      const data = session.data as unknown as AuthState;
      creds = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver);
      keys = JSON.parse(JSON.stringify(data.keys || {}), BufferJSON.reviver);
    } else {
      creds = initAuthCreds();
    }

    const saveCreds = async () => {
      await this.repository.upsert(
        "default",
        JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer))
      );
      this.logger.debug("Session credentials saved");
    };

    const keyStore = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const value = keys[type]?.[id];
          if (value !== undefined) {
            result[id] = value as SignalDataTypeMap[T];
          }
        }
        return result;
      },
      set: async (data: SignalDataSet) => {
        for (const [type, entries] of Object.entries(data)) {
          if (!keys[type]) keys[type] = {};
          for (const [id, value] of Object.entries(entries || {})) {
            if (value === null || value === undefined) {
              delete keys[type][id];
            } else {
              keys[type][id] = value;
            }
          }
        }
        await saveCreds();
      }
    };

    return {
      state: {
        creds,
        keys: keyStore
      },
      saveCreds
    };
  }

  async clearSession(): Promise<void> {
    await this.repository.delete("default");
    this.logger.info("Session cleared");
  }
}
