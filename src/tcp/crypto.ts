import * as crypto from "crypto";

/**
 * Diffie-Hellman key exchange implementation
 * Matches homed-server-cloud protocol where client provides p and g
 */
export class DHKeyExchange {
  private prime!: number;
  private generator!: number;
  private privateValue: number;
  private publicValue: number | null = null;

  constructor() {
    // Generate private value (random number)
    // Client will provide prime and generator via setPrime/setGenerator
    this.privateValue = crypto.randomInt(1, 0x7fffffff);
  }

  /**
   * Set the prime modulus (provided by client in handshake)
   */
  setPrime(value: number): void {
    this.prime = value;
    this.publicValue = null; // Invalidate cached public key
  }

  /**
   * Set the generator (provided by client in handshake)
   */
  setGenerator(value: number): void {
    this.generator = value;
    this.publicValue = null; // Invalidate cached public key
  }

  /**
   * Compute private key from client's shared key
   */
  computePrivateKey(clientSharedKey: number): number {
    if (!this.prime) {
      throw new Error("Prime must be set before computing private key");
    }
    // Compute shared secret: clientPublic^private mod p
    return this.modPow(clientSharedKey, this.privateValue, this.prime);
  }

  /**
   * Get server's shared key (public key) as uint32
   * Computed as: g^privateValue mod p
   */
  getSharedKey(): number {
    if (!this.prime || !this.generator) {
      throw new Error(
        "Prime and generator must be set before computing shared key"
      );
    }
    if (this.publicValue === null) {
      this.publicValue = this.modPow(
        this.generator,
        this.privateValue,
        this.prime
      );
    }
    return this.publicValue;
  }

  /**
   * Modular exponentiation: (base^exp) mod modulus
   */
  private modPow(base: number, exp: number, modulus: number): number {
    if (modulus === 1) return 0;

    let result = 1;
    base = base % modulus;

    while (exp > 0) {
      if (exp % 2 === 1) {
        result = (result * base) % modulus;
      }
      exp = Math.floor(exp / 2);
      base = (base * base) % modulus;
    }

    return result;
  }
}

/**
 * AES-128-CBC encryption/decryption
 */
export class AES128CBC {
  private key: Buffer;
  private iv: Buffer;

  constructor(key: Buffer, iv: Buffer) {
    if (key.length !== 16) {
      throw new Error("AES-128 key must be 16 bytes");
    }
    if (iv.length !== 16) {
      throw new Error("AES IV must be 16 bytes");
    }

    this.key = key;
    this.iv = iv;
  }

  /**
   * Encrypt data using AES-128-CBC
   */
  encrypt(data: Buffer): Buffer {
    const cipher = crypto.createCipheriv("aes-128-cbc", this.key, this.iv);
    cipher.setAutoPadding(false); // Manual padding required

    return Buffer.concat([cipher.update(data), cipher.final()]);
  }

  /**
   * Decrypt data using AES-128-CBC
   */
  decrypt(data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
    decipher.setAutoPadding(false); // Manual padding required

    return Buffer.concat([decipher.update(data), decipher.final()]);
  }
}

/**
 * Pad buffer to 16-byte boundary (PKCS#7-like padding with zeros)
 */
export function padBuffer(buffer: Buffer): Buffer {
  const paddingLength = 16 - (buffer.length % 16);
  if (paddingLength === 16) {
    return buffer; // Already aligned
  }

  const padded = Buffer.allocUnsafe(buffer.length + paddingLength);
  buffer.copy(padded);
  padded.fill(0, buffer.length); // Zero padding

  return padded;
}

/**
 * Remove zero padding from buffer
 */
export function unpadBuffer(buffer: Buffer): Buffer {
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) {
    end--;
  }
  return buffer.slice(0, end);
}
