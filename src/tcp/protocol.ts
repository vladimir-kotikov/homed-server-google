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
  action: "subscribe" | "publish";
  topic: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: any;
}

export function readPacket(data: Buffer): [Buffer | null, Buffer] {
  // Extract packets: start with 0x42, end with 0x43
  const start = data.indexOf(START_MARKER);
  const end = data.indexOf(END_MARKER, start + 1);
  if (start === -1 || end === -1 || end <= start) {
    return [null, data];
  }

  return [data.subarray(start + 1, end), data.subarray(end + 1)];
}

export function unescapePacket(packet: Buffer): Buffer<ArrayBuffer> {
  const unescaped: number[] = [];
  for (let i = 0; i < packet.length; i++) {
    if (packet[i] === 0x44 && i + 1 < packet.length) {
      if (packet[i + 1] === 0x62) {
        unescaped.push(START_MARKER);
        i++;
      } else if (packet[i + 1] === 0x63) {
        unescaped.push(END_MARKER);
        i++;
      } else if (packet[i + 1] === 0x64) {
        unescaped.push(ESCAPE_MARKER);
        i++;
      } else {
        unescaped.push(packet[i]);
      }
    } else {
      unescaped.push(packet[i]);
    }
  }

  return Buffer.from(unescaped);
}

export function escapePacket(packet: Buffer): Buffer<ArrayBuffer> {
  const escaped: number[] = [];
  for (let i = 0; i < packet.length; i++) {
    if (packet[i] === START_MARKER) {
      escaped.push(ESCAPE_MARKER, 0x62);
    } else if (packet[i] === END_MARKER) {
      escaped.push(ESCAPE_MARKER, 0x63);
    } else if (packet[i] === ESCAPE_MARKER) {
      escaped.push(ESCAPE_MARKER, 0x64);
    } else {
      escaped.push(packet[i]);
    }
  }
  return Buffer.from(escaped);
}
