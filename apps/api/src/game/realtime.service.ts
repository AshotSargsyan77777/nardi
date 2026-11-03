import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Decouples services from the Socket.IO gateway (avoids circular dependencies). */
@Injectable()
export class RealtimeService {
  server: Server | null = null;
  private online = new Map<string, number>();

  toUser(userId: string, event: string, data: unknown) {
    this.server?.to(`user:${userId}`).emit(event, data);
  }
  toChannel(channel: string, event: string, data: unknown) {
    this.server?.to(channel).emit(event, data);
  }
  markOnline(userId: string, delta: 1 | -1) {
    const n = (this.online.get(userId) ?? 0) + delta;
    if (n <= 0) this.online.delete(userId);
    else this.online.set(userId, n);
    return n > 0;
  }
  isOnline(userId: string) {
    return (this.online.get(userId) ?? 0) > 0;
  }
  onlineCount() {
    return this.online.size;
  }
}
