import * as crypto from "node:crypto";

function pow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base = base % modulus;
  while (exponent > 0n) {
    if (exponent % 2n === 1n) {
      result = (result * base) % modulus;
    }
    exponent = exponent >> 1n;
    base = (base * base) % modulus;
  }
  return result;
}

export class AES128CBC {
  private key: Buffer;
  private iv: Buffer;

  constructor(sharedSecret: Buffer) {
    this.key = crypto.createHash("md5").update(sharedSecret).digest();
    this.iv = crypto.createHash("md5").update(this.key).digest();
  }

  static fromHandshake(data: Buffer): [AES128CBC, Buffer] {
    const prime = BigInt(data.readUInt32BE(0));
    const generator = BigInt(data.readUInt32BE(4));
    const clientPublic = BigInt(data.readUInt32BE(8));

    const serverSeed = BigInt(Math.floor(Math.random() * 0x7f_ff_ff_ff));
    const serverPublic = pow(generator, serverSeed, prime);
    const sharedSecret = pow(clientPublic, serverSeed, prime);

    const serverPublicBuf = Buffer.alloc(4);
    serverPublicBuf.writeUInt32BE(Number(serverPublic & 0xff_ff_ff_ffn), 0);

    // Derive AES key/IV from shared secret (as 4-byte buffer)
    const sharedSecretBuf = Buffer.alloc(4);
    sharedSecretBuf.writeUInt32BE(Number(sharedSecret & 0xff_ff_ff_ffn), 0);

    return [new AES128CBC(sharedSecretBuf), serverPublicBuf];
  }

  encrypt(data: Buffer): Buffer {
    // Pad the buffer to a multiple of 16 bytes
    if (data.length % 16)
      data = Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]);

    const cipher = crypto.createCipheriv("aes-128-cbc", this.key, this.iv);
    cipher.setAutoPadding(false); // Manual padding required
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return encrypted;
  }

  decrypt(data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
    decipher.setAutoPadding(false); // Manual padding required
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    // Remove trailing zero padding
    const unpadded = decrypted.subarray(
      0,
      decrypted.includes(0x00) ? decrypted.lastIndexOf(0x00) : decrypted.length
    );
    return unpadded;
  }
}
