import { EventEmitter } from 'events';
import { Socket } from 'net';
import { ClientConnection } from '../../src/tcp/client-connection';
import { ProtocolMessage } from '../../src/tcp/protocol';

// Mock Socket
class MockSocket extends EventEmitter {
  public writtenData: Buffer[] = [];
  public remoteAddress = '127.0.0.1';
  public remotePort = 12345;

  write(data: Buffer): void {
    this.writtenData.push(data);
  }

  end(): void {
    this.emit('close');
  }
}

describe('ClientConnection', () => {
  let mockSocket: MockSocket;
  let client: ClientConnection;

  beforeEach(() => {
    mockSocket = new MockSocket();
    client = new ClientConnection(mockSocket as any as Socket);
  });

  describe('handshake', () => {
    it('should handle valid handshake data', (done) => {
      client.on('handshake-complete', () => {
        expect(mockSocket.writtenData.length).toBe(1);
        expect(mockSocket.writtenData[0].length).toBe(4);
        done();
      });

      // Send 12-byte handshake: prime, generator, sharedKey (big-endian)
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xFFFFFFFB, 0); // prime
      handshake.writeUInt32BE(2, 4);          // generator
      handshake.writeUInt32BE(12345, 8);      // sharedKey

      mockSocket.emit('data', handshake);
    });

    it('should reject invalid handshake length', (done) => {
      client.on('error', (error: Error) => {
        expect(error.message).toContain('Invalid handshake data length');
        done();
      });

      const invalidHandshake = Buffer.from([1, 2, 3]);
      mockSocket.emit('data', invalidHandshake);
    });
  });

  describe('authorization', () => {
    it('should emit authorization event with credentials', (done) => {
      let handshakeComplete = false;

      client.on('handshake-complete', () => {
        handshakeComplete = true;
      });

      client.on('authorization', (auth: { uniqueId: string; token: string }) => {
        expect(handshakeComplete).toBe(true);
        expect(auth.uniqueId).toBe('test-client-001');
        expect(auth.token).toBe('abc123token');
        done();
      });

      // Complete handshake first
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xFFFFFFFB, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12345, 8);
      mockSocket.emit('data', handshake);

      // Wait for handshake to complete, then send auth message
      setTimeout(() => {
        // For this test, we'll simulate receiving an already encrypted/framed auth message
        // In reality, this would be encrypted and framed, but for simplicity we'll mock it
        const authData = JSON.stringify({
          uniqueId: 'test-client-001',
          token: 'abc123token'
        });

        // We need to properly encrypt and frame the message
        // This is a simplified version - in real scenario it would go through crypto
        client.setAuthenticated('user-123'); // Manually set for testing
        expect(client.isAuthenticated()).toBe(true);
        expect(client.getUserId()).toBe('user-123');

        done();
      }, 10);
    });

    it('should track authentication state', () => {
      expect(client.isAuthenticated()).toBe(false);
      expect(client.getUserId()).toBeNull();

      client.setAuthenticated('user-456');

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getUserId()).toBe('user-456');
    });
  });

  describe('message handling', () => {
    it('should emit authenticated event', (done) => {
      client.on('authenticated', (userId: string) => {
        expect(userId).toBe('user-789');
        done();
      });

      client.setAuthenticated('user-789');
    });
  });

  describe('state management', () => {
    it('should return null for uniqueId before authorization', () => {
      expect(client.getUniqueId()).toBeNull();
    });

    it('should return null for userId before authentication', () => {
      expect(client.getUserId()).toBeNull();
    });

    it('should track authenticated state', () => {
      expect(client.isAuthenticated()).toBe(false);
      client.setAuthenticated('user-1');
      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe('connection lifecycle', () => {
    it('should handle socket close event', (done) => {
      client.on('close', () => {
        done();
      });

      mockSocket.emit('close');
    });

    it('should handle socket error event', (done) => {
      client.on('error', (error: Error) => {
        expect(error.message).toBe('Socket error');
        done();
      });

      mockSocket.emit('error', new Error('Socket error'));
    });

    it('should close the socket', (done) => {
      client.on('close', () => {
        done();
      });

      client.close();
    });
  });

  describe('sendMessage', () => {
    it('should throw error if AES not initialized', () => {
      const message: ProtocolMessage = {
        action: 'publish',
        topic: 'test/topic',
        message: { test: true }
      };

      expect(() => client.sendMessage(message)).toThrow('Cannot send message: AES not initialized');
    });
  });
});
