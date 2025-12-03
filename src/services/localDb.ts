import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'ozlon_local';

export interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  synced: boolean;
}

class LocalDatabase {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isNative: boolean;
  private initialized = false;

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
    this.isNative = Capacitor.isNativePlatform();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // For web, fall back to localStorage
    if (!this.isNative) {
      console.log('LocalDB: Using localStorage fallback (web platform)');
      this.initialized = true;
      return;
    }

    try {
      // Check connection consistency
      const retCC = await this.sqlite.checkConnectionsConsistency();
      const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;

      if (retCC.result && isConn) {
        this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
      } else {
        this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      }

      await this.db.open();

      // Create messages table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          synced INTEGER DEFAULT 0
        );
      `);

      // Create index for faster queries
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      `);

      this.initialized = true;
      console.log('LocalDB: SQLite initialized successfully');
    } catch (error) {
      console.error('LocalDB: Failed to initialize SQLite:', error);
      // Fall back to localStorage
      this.isNative = false;
      this.initialized = true;
    }
  }

  async saveMessage(message: LocalMessage): Promise<void> {
    await this.init();

    if (!this.isNative) {
      // localStorage fallback
      const messages = this.getMessagesFromStorage();
      const existingIndex = messages.findIndex(m => m.id === message.id);
      if (existingIndex >= 0) {
        messages[existingIndex] = message;
      } else {
        messages.push(message);
      }
      // Keep last 500 messages
      const trimmed = messages.slice(-500);
      localStorage.setItem('ozlon_messages', JSON.stringify(trimmed));
      return;
    }

    if (!this.db) return;

    try {
      await this.db.run(
        `INSERT OR REPLACE INTO messages (id, role, content, timestamp, synced) VALUES (?, ?, ?, ?, ?)`,
        [message.id, message.role, message.content, message.timestamp, message.synced ? 1 : 0]
      );
    } catch (error) {
      console.error('LocalDB: Failed to save message:', error);
    }
  }

  async getMessages(limit = 100): Promise<LocalMessage[]> {
    await this.init();

    if (!this.isNative) {
      // localStorage fallback
      const messages = this.getMessagesFromStorage();
      return messages.slice(-limit);
    }

    if (!this.db) return [];

    try {
      const result = await this.db.query(
        `SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`,
        [limit]
      );
      
      const messages = (result.values || []).map(row => ({
        id: row.id,
        role: row.role as 'user' | 'assistant',
        content: row.content,
        timestamp: row.timestamp,
        synced: row.synced === 1,
      }));

      // Return in chronological order
      return messages.reverse();
    } catch (error) {
      console.error('LocalDB: Failed to get messages:', error);
      return [];
    }
  }

  async clearMessages(): Promise<void> {
    await this.init();

    if (!this.isNative) {
      localStorage.removeItem('ozlon_messages');
      return;
    }

    if (!this.db) return;

    try {
      await this.db.execute('DELETE FROM messages');
    } catch (error) {
      console.error('LocalDB: Failed to clear messages:', error);
    }
  }

  private getMessagesFromStorage(): LocalMessage[] {
    try {
      const stored = localStorage.getItem('ozlon_messages');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const localDb = new LocalDatabase();
