import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { allowedOrigins } from "../app.js";

/**
 * Real-time invalidation channel. Events carry no patient data — clients refetch
 * through the permission-checked REST API when they receive them.
 */
let io: Server | null = null;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });
}

export const emit = (event: "queue:changed" | "appointments:changed", data: { doctorId?: string } = {}) => io?.emit(event, data);
