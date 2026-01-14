import * as crypto from "crypto";

/**
 * Diffie-Hellman key exchange implementation
 * Simplified version using crypto primitives
 */
export class DHKeyExchange {
  private prime: number;
  private generator: number;
  private privateValue: number;
  private publicValue: number;

  constructor() {
    // Use standard DH parameters
    // Prime (p) and generator (g) for DH key exchange
    this.prime = 0xfffffffb; // Large prime number (4294967291)
    this.generator = 2;

    // Generate private value (random number)
    this.privateValue = crypto.randomInt(1000, 0xffffff);

    // Compute public value: g^private mod p
    // For simplicity, use a simpler computation that works with 32-bit numbers
    this.publicValue = this.modPow(
      this.generator,
      this.privateValue,
      this.prime
    );
  }

  /**
   * Generate DH parameters for handshake
   */
  generateParameters(): {
    prime: number;
    generator: number;
    sharedKey: number;
  } {
    return {
      prime: this.prime,
      generator: this.generator,
      sharedKey: this.publicValue,
    };
  }

  /**
   * Compute private key from client's shared key
   */
  computePrivateKey(clientSharedKey: number): number {
    // Compute shared secret: clientPublic^private mod p
    return this.modPow(clientSharedKey, this.privateValue, this.prime);
  }

  /**
   * Get server's shared key (public key) as uint32
   */
  getSharedKey(): number {
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
 * Derive MD5-based AES key from private key
 */
export function deriveMD5Key(privateKey: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(privateKey, 0);
  return crypto.createHash("md5").update(buffer).digest();
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
