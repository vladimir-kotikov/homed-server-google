/**
 * Binary message protocol implementation for Homed TCP communication
 *
 * Protocol:
 * - Start marker: 0x42
 * - End marker: 0x43
 * - Escape marker: 0x44
 * - Escape sequences: 0x42 -> 0x44,0x62 | 0x43 -> 0x44,0x63 | 0x44 -> 0x44,0x64
 * - Payload: AES-128-CBC encrypted JSON
 */

const START_MARKER = 0x42;
const END_MARKER = 0x43;
const ESCAPE_MARKER = 0x44;

/**
 * Protocol message interface
 */
export interface ProtocolMessage {
  action: 'subscribe' | 'publish';
  topic: string;
  message?: any;
}

/**
 * Message framing/unframing for binary protocol
 */
export class MessageFramer {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Frame a message with start/end markers and escape sequences
   */
  frame(data: Buffer): Buffer {
    const escaped = this.escape(data);
    const framed = Buffer.allocUnsafe(escaped.length + 2);

    framed[0] = START_MARKER;
    escaped.copy(framed, 1);
    framed[framed.length - 1] = END_MARKER;

    return framed;
  }

  /**
   * Unframe messages from accumulated buffer
   * Returns array of complete message buffers
   */
  unframe(chunk: Buffer): Buffer[] {
    // Append new data to buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const messages: Buffer[] = [];
    let start = -1;

    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === START_MARKER && start === -1) {
        start = i;
      } else if (this.buffer[i] === END_MARKER && start !== -1) {
        // Found complete message
        const escapedData = this.buffer.slice(start + 1, i);
        const unescapedData = this.unescape(escapedData);
        messages.push(unescapedData);

        // Remove processed message from buffer
        this.buffer = this.buffer.slice(i + 1);
        i = -1; // Reset search
        start = -1;
      }
    }

    // If we found a start but no end, keep it in buffer
    if (start !== -1 && start > 0) {
      this.buffer = this.buffer.slice(start);
    }

    return messages;
  }

  /**
   * Clear the internal buffer
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Escape special bytes in data
   */
  private escape(data: Buffer): Buffer {
    const escaped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      if (byte === START_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x62);
      } else if (byte === END_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x63);
      } else if (byte === ESCAPE_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x64);
      } else {
        escaped.push(byte);
      }
    }

    return Buffer.from(escaped);
  }

  /**
   * Unescape special byte sequences in data
   */
  private unescape(data: Buffer): Buffer {
    const unescaped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] === ESCAPE_MARKER && i + 1 < data.length) {
        const next = data[i + 1];

        if (next === 0x62) {
          unescaped.push(START_MARKER);
          i++; // Skip next byte
        } else if (next === 0x63) {
          unescaped.push(END_MARKER);
          i++;
        } else if (next === 0x64) {
          unescaped.push(ESCAPE_MARKER);
          i++;
        } else {
          // Invalid escape sequence, keep as-is
          unescaped.push(data[i]);
        }
      } else {
        unescaped.push(data[i]);
      }
    }

    return Buffer.from(unescaped);
  }
}
