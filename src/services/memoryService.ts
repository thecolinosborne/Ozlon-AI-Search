import { supabase } from "@/integrations/supabase/client";

export type MemoryType = 'fact' | 'preference' | 'context' | 'pattern' | 'goal' | 'value';

export interface WisdomMemory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  content: string;
  summary: string | null;
  salience: number;
  confidence: number;
  recurrence_count: number;
  last_accessed_at: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateMemoryInput {
  memory_type: MemoryType;
  content: string;
  summary?: string;
  salience?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

// Using any until types regenerate with wisdom_memories table
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memoriesTable = () => (supabase as any).from('wisdom_memories');

class MemoryService {
  async createMemory(input: CreateMemoryInput): Promise<WisdomMemory | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await memoriesTable()
      .insert({
        user_id: user.id,
        memory_type: input.memory_type,
        content: input.content,
        summary: input.summary || null,
        salience: input.salience ?? 0.5,
        confidence: input.confidence ?? 0.8,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) { console.error('Error creating memory:', error); return null; }
    return data as WisdomMemory;
  }

  async getMemoriesByType(type: MemoryType): Promise<WisdomMemory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .eq('memory_type', type)
      .order('updated_at', { ascending: false });

    if (error) { console.error('Error fetching memories:', error); return []; }
    return (data as WisdomMemory[]) ?? [];
  }

  async getAllMemories(): Promise<WisdomMemory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) { console.error('Error fetching all memories:', error); return []; }
    return (data as WisdomMemory[]) ?? [];
  }

  async deleteMemory(id: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await memoriesTable()
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) { console.error('Error deleting memory:', error); return false; }
    return true;
  }

  async clearAllMemories(): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await memoriesTable()
      .delete()
      .eq('user_id', user.id);

    if (error) { console.error('Error clearing memories:', error); return false; }
    return true;
  }

  async getRecentMemories(limit = 20): Promise<WisdomMemory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) { console.error('Error fetching recent memories:', error); return []; }
    return (data as WisdomMemory[]) ?? [];
  }
}

export const memoryService = new MemoryService();
