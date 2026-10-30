import type { ToolResultLike } from './parse';

/**
 * The minimal surface the report runner needs from Canva. Implemented by the
 * real MCP client (mcpClient.ts) and by the offline mock (mock.ts).
 */
export interface CanvaTools {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResultLike>;
  /** POST raw bytes to a single-use upload URL; resolves with the response body. */
  upload(url: string, bytes: Buffer): Promise<string>;
}

export const USER_INTENT = 'Crear un reporte de paciente de DR·QUIRO a partir de la plantilla';
