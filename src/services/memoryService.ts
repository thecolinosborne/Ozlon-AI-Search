import { supabase } from "@/integrations/supabase/client";

export type MemoryType = 'fact' | 'preference' | 'context' | 'pattern' | 'relationship';

export interface Memory {
  id: string;
  user_id: string;
  type: MemoryType;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryInput {
  type: MemoryType;
  key: string;
  value: Record<string, unknown>;
  confidence?: number;
}

// Using any temporarily until Supabase types regenerate
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memoriesTable = () => (supabase as any).from('memories');

class MemoryService {
  /**
   * Store a new memory for the current user
   */
  async createMemory(input: CreateMemoryInput): Promise<Memory | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No authenticated user');
      return null;
    }

    const { data, error } = await memoriesTable()
      .insert({
        user_id: user.id,
        type: input.type,
        key: input.key,
        value: input.value,
        confidence: input.confidence ?? 0.8,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating memory:', error);
      return null;
    }

    return data as Memory;
  }

  /**
   * Update an existing memory (upsert by key)
   */
  async upsertMemory(input: CreateMemoryInput): Promise<Memory | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No authenticated user');
      return null;
    }

    const { data, error } = await memoriesTable()
      .upsert(
        {
          user_id: user.id,
          type: input.type,
          key: input.key,
          value: input.value,
          confidence: input.confidence ?? 0.8,
        },
        { onConflict: 'user_id,key' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting memory:', error);
      return null;
    }

    return data as Memory;
  }

  /**
   * Get a specific memory by key
   */
  async getMemory(key: string): Promise<Memory | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .eq('key', key)
      .maybeSingle();

    if (error) {
      console.error('Error fetching memory:', error);
      return null;
    }

    return data as Memory | null;
  }

  /**
   * Get all memories of a specific type
   */
  async getMemoriesByType(type: MemoryType): Promise<Memory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .eq('type', type)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching memories by type:', error);
      return [];
    }

    return (data as Memory[]) ?? [];
  }

  /**
   * Get all user memories
   */
  async getAllMemories(): Promise<Memory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching all memories:', error);
      return [];
    }

    return (data as Memory[]) ?? [];
  }

  /**
   * Delete a memory by key
   */
  async deleteMemory(key: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await memoriesTable()
      .delete()
      .eq('user_id', user.id)
      .eq('key', key);

    if (error) {
      console.error('Error deleting memory:', error);
      return false;
    }

    return true;
  }

  /**
   * Clear all memories for the current user
   */
  async clearAllMemories(): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await memoriesTable()
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('Error clearing memories:', error);
      return false;
    }

    return true;
  }

  /**
   * Get recent memories for context injection
   */
  async getRecentMemories(limit: number = 20): Promise<Memory[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await memoriesTable()
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent memories:', error);
      return [];
    }

    return (data as Memory[]) ?? [];
  }
}

export const memoryService = new MemoryService();
