import * as crypto from "crypto";

/**
 * Diffie-Hellman key exchange implementation
 * Matches homed-server-cloud protocol where client provides p and g
 */
export class DHKeyExchange {
  private prime!: number;
  private generator!: number;
  private privateValue: number = 12345; // FIXME: Use fixed value for debugging
  private publicValue: number | null = null;

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
   * Uses Diffie-Hellman: (clientSharedKey^privateValue) mod prime
   */
  computePrivateKey(clientSharedKey: number): number {
    if (!this.prime) {
      throw new Error("Prime must be set before computing private key");
    }
    // Proper DH computation: clientSharedKey^privateValue mod prime
    const sharedSecret = this.modPow(
      clientSharedKey,
      this.privateValue,
      this.prime
    );
    return sharedSecret;
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
   * Uses binary exponentiation for efficiency
   */
  private modPow(base: number, exp: number, modulus: number): number {
    if (modulus === 1) return 0;

    // Use BigInt for safe arbitrary-precision arithmetic during modular exponentiation
    // This prevents floating-point precision loss and integer overflow in JavaScript
    const baseBig = BigInt(base >>> 0);
    const expBig = BigInt(exp >>> 0);
    const modulusBig = BigInt(modulus >>> 0);

    // Compute base^exp mod modulus using BigInt
    let result = 1n;
    let b = baseBig % modulusBig;
    let e = expBig;

    while (e > 0n) {
      if ((e & 1n) === 1n) {
        result = (result * b) % modulusBig;
      }
      e = e >> 1n;
      b = (b * b) % modulusBig;
    }

    // Convert back to unsigned 32-bit integer
    return Number(result) >>> 0;
  }
}

/**
 * AES-128-CBC encryption/decryption
 */
export class AES128CBC {
  private key: Buffer;
  private iv: Buffer;
  private currentIV: Buffer; // Track IV state across messages for CBC chaining

  constructor(key: Buffer, iv: Buffer) {
    if (key.length !== 16) {
      throw new Error("AES-128 key must be 16 bytes");
    }
    if (iv.length !== 16) {
      throw new Error("AES IV must be 16 bytes");
    }

    this.key = key;
    this.iv = iv;
    // Initialize current IV with the provided IV
    this.currentIV = Buffer.from(iv);
  }

  /**
   * Encrypt data using AES-128-CBC with persistent IV state
   * CRITICAL: IV evolves across the session. After encrypting each 16-byte block,
   * the ciphertext of that block becomes the IV for the next message's first block.
   * This matches the C++ homed-service-cloud implementation exactly.
   *
   * For correct operation:
   * - Each message is encrypted with the current IV
   * - After encryption, currentIV is updated to the last ciphertext block
   * - Next message will use that as its starting IV
   */
  encrypt(data: Buffer): Buffer {
    const cipher = crypto.createCipheriv(
      "aes-128-cbc",
      this.key,
      this.currentIV
    );
    cipher.setAutoPadding(false); // Manual padding required

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    // Update currentIV to the last ciphertext block for next message's encryption
    // In CBC mode, the last ciphertext block of message N becomes the IV for message N+1
    if (encrypted.length >= 16) {
      this.currentIV = Buffer.from(
        encrypted.slice(encrypted.length - 16, encrypted.length)
      );
    }

    return encrypted;
  }

  /**
   * Decrypt data using AES-128-CBC with persistent IV state
   * CRITICAL: In CBC decryption, you need the ciphertext block as IV, not plaintext.
   * The IV for decryption should be the last ciphertext block of the previous message.
   *
   * For correct operation in a session:
   * - When receiving multiple encrypted messages
   * - Each message's first plaintext byte depends on: ciphertext_byte XOR previous_ciphertext_block
   * - The currentIV is the last ciphertext block from the previous message
   *
   * NOTE: Do NOT update currentIV after decryption of a received message in a normal flow,
   * because the last ciphertext block of this message will be used as IV for NEXT received message.
   */
  decrypt(data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv(
      "aes-128-cbc",
      this.key,
      this.currentIV
    );
    decipher.setAutoPadding(false); // Manual padding required

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    // Update currentIV to the last ciphertext block for next message's decryption
    // The last block of received ciphertext becomes IV for next message
    if (data.length >= 16) {
      this.currentIV = Buffer.from(data.slice(data.length - 16, data.length));
    }

    return decrypted;
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
