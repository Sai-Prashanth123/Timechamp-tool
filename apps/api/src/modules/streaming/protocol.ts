export enum FrameType {
  SCREEN_DELTA = 0x01,
  SCREEN_FULL = 0x02,
  CAMERA = 0x03,
  AUDIO = 0x04,
  HEARTBEAT = 0x05,
  ACK = 0x06,
  CONTROL = 0x07,
}

const FRAME_VERSION = 0x01;
const HEADER_SIZE = 8;

export function parseFrame(buf: Buffer): { type: FrameType; payload: Buffer } {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`Frame too short: ${buf.length} bytes`);
  }
  const type = buf[1] as FrameType;
  const payloadLen = buf.readUInt32BE(4);
  if (buf.length < HEADER_SIZE + payloadLen) {
    throw new Error(`Incomplete frame: expected ${HEADER_SIZE + payloadLen}, got ${buf.length}`);
  }
  return { type, payload: buf.slice(HEADER_SIZE, HEADER_SIZE + payloadLen) };
}

export function buildFrame(type: FrameType, payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header[0] = FRAME_VERSION;
  header[1] = type;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

export function buildControlFrame(data: Record<string, unknown>): Buffer {
  return buildFrame(FrameType.CONTROL, Buffer.from(JSON.stringify(data)));
}

export function buildHeartbeatFrame(): Buffer {
  return buildFrame(FrameType.HEARTBEAT, Buffer.alloc(0));
}
