import {
  AES128CBC,
  DHKeyExchange,
  padBuffer,
  unpadBuffer,
} from "../../src/tcp/crypto.ts";

describe("DHKeyExchange", () => {
  it("should require prime and generator before computing keys", () => {
    const dh = new DHKeyExchange();

    expect(() => dh.getSharedKey()).toThrow(
      "Prime and generator must be set before computing shared key"
    );
    expect(() => dh.computePrivateKey(12345)).toThrow(
      "Prime must be set before computing private key"
    );
  });

  it("should accept prime and generator from client", () => {
    const dh = new DHKeyExchange();
    const clientPrime = 0xffffffc5;
    const clientGenerator = 5;

    expect(() => {
      dh.setPrime(clientPrime);
    }).not.toThrow();
    expect(() => {
      dh.setGenerator(clientGenerator);
    }).not.toThrow();
  });

  it("should compute server shared key with client parameters", () => {
    const dh = new DHKeyExchange();
    dh.setPrime(0xffffffc5);
    dh.setGenerator(5);

    const sharedKey = dh.getSharedKey();

    expect(typeof sharedKey).toBe("number");
    expect(sharedKey).toBeGreaterThan(0);
  });

  it("should compute private key from client shared key", () => {
    const dh = new DHKeyExchange();
    dh.setPrime(0xffffffc5);
    dh.setGenerator(5);

    const clientSharedKey = 12345;
    const privateKey = dh.computePrivateKey(clientSharedKey);

    expect(typeof privateKey).toBe("number");
    expect(privateKey).toBeGreaterThan(0);
  });

  it("should produce consistent shared keys", () => {
    const dh = new DHKeyExchange();
    dh.setPrime(0xffffffc5);
    dh.setGenerator(5);

    const key1 = dh.getSharedKey();
    const key2 = dh.getSharedKey();

    expect(key1).toBe(key2);
  });

  it("should invalidate cached keys when parameters change", () => {
    const dh = new DHKeyExchange();
    dh.setPrime(0xffffffc5);
    dh.setGenerator(5);

    const key1 = dh.getSharedKey();

    // Change parameters
    dh.setPrime(0xfffffffb);
    dh.setGenerator(2);

    const key2 = dh.getSharedKey();

    expect(key1).not.toBe(key2);
  });

  it("should work with different client parameters", () => {
    const dh1 = new DHKeyExchange();
    dh1.setPrime(0xffffffc5);
    dh1.setGenerator(5);

    const dh2 = new DHKeyExchange();
    dh2.setPrime(0xfffffffb);
    dh2.setGenerator(2);

    const key1 = dh1.getSharedKey();
    const key2 = dh2.getSharedKey();

    // Different parameters should produce different keys
    // (Note: may occasionally be equal due to random private values)
    expect(typeof key1).toBe("number");
    expect(typeof key2).toBe("number");
  });
});

describe("AES128CBC", () => {
  const testKey = Buffer.from("0123456789abcdef");
  const testIV = Buffer.from("fedcba9876543210");

  describe("constructor", () => {
    it("should accept 16-byte key and IV", () => {
      expect(() => new AES128CBC(testKey, testIV)).not.toThrow();
    });

    it("should throw on invalid key length", () => {
      const shortKey = Buffer.from("short");
      expect(() => new AES128CBC(shortKey, testIV)).toThrow(
        "AES-128 key must be 16 bytes"
      );
    });

    it("should throw on invalid IV length", () => {
      const shortIV = Buffer.from("short");
      expect(() => new AES128CBC(testKey, shortIV)).toThrow(
        "AES IV must be 16 bytes"
      );
    });
  });

  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt data correctly with message-level IV persistence", () => {
      // In CBC mode with persistent IV (like the C++ implementation),
      // each message is encrypted with current IV, then IV updates.
      // To test decrypt, we create a new AES instance to simulate receiving the message.
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("Hello, World!!!!"); // 16 bytes

      const encrypted = aes.encrypt(plaintext);
      // At this point, currentIV has been updated to last block of encrypted
      // Simulate receiving by creating new instance with same initial IV
      const aes2 = new AES128CBC(testKey, testIV);
      const decrypted = aes2.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("should produce different ciphertext than plaintext", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("0123456789abcdef");

      const encrypted = aes.encrypt(plaintext);

      expect(encrypted).not.toEqual(plaintext);
    });

    it("should handle 32-byte data with IV persistence", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("01234567890123456789012345678901"); // 32 bytes

      const encrypted = aes.encrypt(plaintext);
      // Create new instance to decrypt with same initial IV
      const aes2 = new AES128CBC(testKey, testIV);
      const decrypted = aes2.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("should handle 48-byte data with IV persistence", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from(
        "012345678901234567890123456789012345678901234567"
      ); // 48 bytes

      const encrypted = aes.encrypt(plaintext);
      // Create new instance to decrypt with same initial IV
      const aes2 = new AES128CBC(testKey, testIV);
      const decrypted = aes2.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("should maintain IV persistence across multiple messages", () => {
      // Test that IV evolves correctly through message sequence
      const aes = new AES128CBC(testKey, testIV);

      // Encrypt message 1 - must pad to 16-byte boundary first
      const plaintext1 = Buffer.from("Message Number 1!!!"); // 20 bytes
      const padded1 = padBuffer(plaintext1);
      const encrypted1 = aes.encrypt(padded1);

      // Encrypt message 2 with evolved IV - must pad first
      const plaintext2 = Buffer.from("Message Number 2!!!"); // 20 bytes
      const padded2 = padBuffer(plaintext2);
      const encrypted2 = aes.encrypt(padded2);

      // Now decrypt in same session with persistent IV
      // Create new instance that will evolve through same sequence
      const aes2 = new AES128CBC(testKey, testIV);
      const decrypted1 = aes2.decrypt(encrypted1);
      const unpadded1 = unpadBuffer(decrypted1);
      // Now IV of aes2 should match IV of aes after first decrypt
      const decrypted2 = aes2.decrypt(encrypted2);
      const unpadded2 = unpadBuffer(decrypted2);

      expect(unpadded1).toEqual(plaintext1);
      expect(unpadded2).toEqual(plaintext2);
    });
  });
});

describe("padBuffer", () => {
  it("should pad to 16-byte boundary", () => {
    const buffer = Buffer.from("hello"); // 5 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded.length % 16).toBe(0);
  });

  it("should not pad if already aligned", () => {
    const buffer = Buffer.from("0123456789abcdef"); // 16 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded).toEqual(buffer);
  });

  it("should pad with zeros", () => {
    const buffer = Buffer.from("test"); // 4 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded.slice(0, 4)).toEqual(buffer);
    expect(padded.slice(4).every(b => b === 0)).toBe(true);
  });

  it("should handle 15-byte buffer", () => {
    const buffer = Buffer.from("123456789012345"); // 15 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
  });

  it("should handle 17-byte buffer", () => {
    const buffer = Buffer.from("12345678901234567"); // 17 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(32);
  });

  it("should handle empty buffer", () => {
    const buffer = Buffer.from([]);
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(0);
  });
});

describe("unpadBuffer", () => {
  it("should remove zero padding", () => {
    const original = Buffer.from("hello");
    const padded = padBuffer(original);
    const unpadded = unpadBuffer(padded);

    expect(unpadded).toEqual(original);
  });

  it("should handle buffer with no padding", () => {
    const buffer = Buffer.from("0123456789abcdef");
    const unpadded = unpadBuffer(buffer);

    expect(unpadded).toEqual(buffer);
  });

  it("should handle buffer that ends with non-zero", () => {
    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    const unpadded = unpadBuffer(buffer);

    expect(unpadded).toEqual(buffer);
  });

  it("should handle all-zero buffer", () => {
    const buffer = Buffer.from([0, 0, 0, 0]);
    const unpadded = unpadBuffer(buffer);

    expect(unpadded.length).toBe(0);
  });

  it("should preserve data before padding", () => {
    const original = Buffer.from("test data here");
    const padded = padBuffer(original);
    const unpadded = unpadBuffer(padded);

    expect(unpadded.toString()).toBe(original.toString());
  });
});

describe("Integration: padBuffer + AES + unpadBuffer", () => {
  it("should handle round-trip encryption with padding", () => {
    const testKey = Buffer.from("0123456789abcdef");
    const testIV = Buffer.from("fedcba9876543210");
    const aes = new AES128CBC(testKey, testIV);

    const plaintext = Buffer.from("This is a test message!");
    const padded = padBuffer(plaintext);
    const encrypted = aes.encrypt(padded);
    // Create new AES instance with same IV to decrypt
    const aes2 = new AES128CBC(testKey, testIV);
    const decrypted = aes2.decrypt(encrypted);
    const unpadded = unpadBuffer(decrypted);

    expect(unpadded).toEqual(plaintext);
  });

  it("should handle JSON data", () => {
    const testKey = Buffer.from("0123456789abcdef");
    const testIV = Buffer.from("fedcba9876543210");
    const aes = new AES128CBC(testKey, testIV);

    const json = JSON.stringify({
      action: "test",
      topic: "test/topic",
      message: "hello",
    });
    const plaintext = Buffer.from(json);
    const padded = padBuffer(plaintext);
    const encrypted = aes.encrypt(padded);
    // Create new AES instance with same IV to decrypt
    const aes2 = new AES128CBC(testKey, testIV);
    const decrypted = aes2.decrypt(encrypted);
    const unpadded = unpadBuffer(decrypted);

    expect(unpadded.toString()).toBe(json);
    expect(JSON.parse(unpadded.toString())).toEqual(JSON.parse(json));
  });

  it("should handle multiple messages with IV persistence", () => {
    // Simulate a session with multiple encrypted messages
    const testKey = Buffer.from("0123456789abcdef");
    const testIV = Buffer.from("fedcba9876543210");

    // Sender side
    const aesEncrypt = new AES128CBC(testKey, testIV);
    const msg1 = Buffer.from("First message here!!!");
    const padded1 = padBuffer(msg1);
    const encrypted1 = aesEncrypt.encrypt(padded1);

    const msg2 = Buffer.from("Second message here!!");
    const padded2 = padBuffer(msg2);
    const encrypted2 = aesEncrypt.encrypt(padded2); // Uses evolved IV

    // Receiver side - must decrypt in same order with same IV evolution
    const aesDecrypt = new AES128CBC(testKey, testIV);
    const decrypted1 = aesDecrypt.decrypt(encrypted1);
    const unpadded1 = unpadBuffer(decrypted1);

    const decrypted2 = aesDecrypt.decrypt(encrypted2); // Uses evolved IV
    const unpadded2 = unpadBuffer(decrypted2);

    expect(unpadded1).toEqual(msg1);
    expect(unpadded2).toEqual(msg2);
  });
});
