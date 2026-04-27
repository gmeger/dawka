declare module "webpush-webcrypto" {
  export class ApplicationServerKeys {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    constructor(publicKey: CryptoKey, privateKey: CryptoKey);
    toJSON(): Promise<{ publicKey: string; privateKey: string }>;
    static fromJSON(keys: {
      publicKey: string;
      privateKey: string;
    }): Promise<ApplicationServerKeys>;
    static generate(): Promise<ApplicationServerKeys>;
  }

  export type SerializedClientKeys = { p256dh: string; auth: string };
  export type PushTarget = { endpoint: string; keys: SerializedClientKeys };

  export type PushOptions = {
    payload: string | Uint8Array;
    applicationServerKeys: ApplicationServerKeys;
    target: PushTarget;
    adminContact: string;
    ttl: number;
    topic?: string;
    urgency?: "very-low" | "low" | "normal" | "high";
  };

  export function generatePushHTTPRequest(opts: PushOptions): Promise<{
    endpoint: string;
    headers: Record<string, string>;
    body: ArrayBuffer | Uint8Array;
  }>;

  export function setWebCrypto(crypto: Crypto): void;
}
