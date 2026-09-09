import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainText: string, encryptionKey = process.env.JARVIS_SECRET_KEY ?? ""): string {
  if (!encryptionKey) {
    throw new Error("JARVIS_SECRET_KEY is required to encrypt provider secrets.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(cipherText: string, encryptionKey = process.env.JARVIS_SECRET_KEY ?? ""): string {
  if (!encryptionKey) {
    throw new Error("JARVIS_SECRET_KEY is required to decrypt provider secrets.");
  }

  const [version, iv, tag, encrypted] = cipherText.split(":");
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted secret format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(encryptionKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) {
    return null;
  }
  if (secret.length <= 8) {
    return "****";
  }
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
