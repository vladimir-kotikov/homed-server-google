import { AES128CBC } from "../../../src/homed/crypto.ts";

describe("AES128CBC", () => {
  describe("constructor", () => {
    it("should create AES cipher from shared secret buffer", () => {
      const sharedSecret = Buffer.from("shared-secret-key");
      expect(() => new AES128CBC(sharedSecret)).not.toThrow();
    });

    it("should derive different keys from different shared secrets", () => {
      const secret1 = Buffer.from("secret1");
      const secret2 = Buffer.from("secret2");

      const aes1 = new AES128CBC(secret1);
      const aes2 = new AES128CBC(secret2);

      // Encrypt same data with different secrets should produce different results
      const data = Buffer.from("test data here  "); // 16 bytes
      const encrypted1 = aes1.encrypt(data);
      const encrypted2 = aes2.encrypt(data);

      expect(encrypted1).not.toEqual(encrypted2);
    });
  });

  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt 16-byte (block-aligned) data", () => {
      const sharedSecret = Buffer.from("test-secret-16b-");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      const plaintext = Buffer.from("0123456789abcdef"); // 16 bytes
      const encrypted = aes1.encrypt(plaintext);

      expect(encrypted.length).toBe(16);
      expect(encrypted).not.toEqual(plaintext);

      const decrypted = aes2.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it("should handle unaligned data by padding to 16-byte boundary", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      const plaintext = Buffer.from("Hello!"); // 6 bytes
      const encrypted = aes1.encrypt(plaintext);

      // Should be padded to 16 bytes
      expect(encrypted.length % 16).toBe(0);
      expect(encrypted.length).toBe(16);

      const decrypted = aes2.decrypt(encrypted);
      // After decryption, padding should be stripped to get exact original
      expect(decrypted).toEqual(plaintext);
      expect(decrypted.length).toBe(6);
    });

    it("should produce different ciphertext from plaintext", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes = new AES128CBC(sharedSecret);
      const plaintext = Buffer.from("0123456789abcdef");

      const encrypted = aes.encrypt(plaintext);

      expect(encrypted).not.toEqual(plaintext);
    });

    it("should handle 32-byte data", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      const plaintext = Buffer.from("01234567890123456789012345678901"); // 32 bytes
      const encrypted = aes1.encrypt(plaintext);

      expect(encrypted.length).toBe(32);

      const decrypted = aes2.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it("should handle 48-byte data", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      const plaintext = Buffer.from(
        "012345678901234567890123456789012345678901234567"
      ); // 48 bytes
      const encrypted = aes1.encrypt(plaintext);

      expect(encrypted.length).toBe(48);

      const decrypted = aes2.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe("fromHandshake - Diffie-Hellman key exchange", () => {
    it("should create AES from DH handshake data", () => {
      // Client sends: [prime(4), generator(4), clientPublic(4)]
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0); // prime
      handshake.writeUInt32BE(2, 4); // generator
      handshake.writeUInt32BE(12_345, 8); // clientPublic

      const [aes, serverPublic] = AES128CBC.fromHandshake(handshake);

      expect(aes).toBeInstanceOf(AES128CBC);
      expect(serverPublic).toHaveLength(4); // 4-byte public key
      expect(serverPublic).toBeInstanceOf(Buffer);
    });

    it("should derive different keys from different client public keys", () => {
      // Different client public keys should lead to different shared secrets
      const handshake1 = Buffer.allocUnsafe(12);
      handshake1.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake1.writeUInt32BE(2, 4);
      handshake1.writeUInt32BE(100, 8);

      const handshake2 = Buffer.allocUnsafe(12);
      handshake2.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake2.writeUInt32BE(2, 4);
      handshake2.writeUInt32BE(200, 8);

      const [aes1] = AES128CBC.fromHandshake(handshake1);
      const [aes2] = AES128CBC.fromHandshake(handshake2);

      const plaintext = Buffer.from("0123456789abcdef");
      const encrypted1 = aes1.encrypt(plaintext);
      const encrypted2 = aes2.encrypt(plaintext);

      // Should produce different ciphertexts
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it("should produce 4-byte server public key in big-endian format", () => {
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);

      const result = AES128CBC.fromHandshake(handshake);
      const serverPublic = result[1];

      expect(serverPublic.length).toBe(4);
      // Reading it back should give a UInt32
      const value = serverPublic.readUInt32BE(0);
      expect(typeof value).toBe("number");
    });

    it("should handle different prime and generator values", () => {
      const handshake1 = Buffer.allocUnsafe(12);
      handshake1.writeUInt32BE(0xff_ff_ff_c5, 0);
      handshake1.writeUInt32BE(5, 4);
      handshake1.writeUInt32BE(54_321, 8);

      const handshake2 = Buffer.allocUnsafe(12);
      handshake2.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake2.writeUInt32BE(2, 4);
      handshake2.writeUInt32BE(54_321, 8);

      const [aes1] = AES128CBC.fromHandshake(handshake1);
      const [aes2] = AES128CBC.fromHandshake(handshake2);

      // Both should be valid AES instances
      expect(aes1).toBeInstanceOf(AES128CBC);
      expect(aes2).toBeInstanceOf(AES128CBC);

      // They should produce different encryption results
      const plaintext = Buffer.from("0123456789abcdef");
      const encrypted1 = aes1.encrypt(plaintext);
      const encrypted2 = aes2.encrypt(plaintext);

      expect(encrypted1).not.toEqual(encrypted2);
    });
  });

  describe("encryption round-trip", () => {
    it("should correctly encrypt and decrypt JSON message", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      const message = {
        action: "publish",
        topic: "test/topic",
        message: { data: "hello" },
      };

      const plaintext = Buffer.from(JSON.stringify(message));

      // Encrypt automatically pads to 16-byte boundary
      const encrypted = aes1.encrypt(plaintext);
      expect(encrypted.length % 16).toBe(0);

      // Decrypt automatically strips padding
      const decrypted = aes2.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);

      const recoveredMessage = JSON.parse(decrypted.toString());
      expect(recoveredMessage).toEqual(message);
    });

    it("should handle various unaligned data sizes", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      // Test different sizes that require padding
      const testSizes = [1, 5, 7, 10, 13, 15, 17, 20, 25, 31, 33, 42];

      testSizes.forEach(size => {
        const plaintext = Buffer.alloc(size, "A");
        const encrypted = aes1.encrypt(plaintext);
        const decrypted = aes2.decrypt(encrypted);

        expect(decrypted).toEqual(plaintext);
        expect(decrypted.length).toBe(size);
      });
    });

    it("should handle JSON with null bytes in the middle", () => {
      const sharedSecret = Buffer.from("test-secret-key!");
      const aes1 = new AES128CBC(sharedSecret);
      const aes2 = new AES128CBC(sharedSecret);

      // Create data that has null bytes in the middle but not at the end
      const plaintext = Buffer.from("data\u0000with\u0000nulls");
      const encrypted = aes1.encrypt(plaintext);
      const decrypted = aes2.decrypt(encrypted);

      // Should preserve null bytes in the middle, only strip trailing padding
      expect(decrypted).toEqual(plaintext);
    });
  });
});
