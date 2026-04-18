export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string
          id: string
          summary: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clickup_integration_state: {
        Row: {
          ai_reply_mode: string | null
          allow_subtask_creation: boolean | null
          allow_task_updates: boolean | null
          auto_reply_enabled: boolean | null
          cooldown_seconds: number | null
          created_at: string | null
          custom_triggers: string[] | null
          default_list_id: string | null
          id: string
          last_error: string | null
          last_successful_ai_reply_at: string | null
          last_tested_at: string | null
          last_webhook_event_at: string | null
          max_reply_length: number | null
          reply_trigger_mode: string | null
          team_id: string
          updated_at: string | null
          user_id: string | null
          webhook_id: string | null
          webhook_status: string | null
        }
        Insert: {
          ai_reply_mode?: string | null
          allow_subtask_creation?: boolean | null
          allow_task_updates?: boolean | null
          auto_reply_enabled?: boolean | null
          cooldown_seconds?: number | null
          created_at?: string | null
          custom_triggers?: string[] | null
          default_list_id?: string | null
          id?: string
          last_error?: string | null
          last_successful_ai_reply_at?: string | null
          last_tested_at?: string | null
          last_webhook_event_at?: string | null
          max_reply_length?: number | null
          reply_trigger_mode?: string | null
          team_id: string
          updated_at?: string | null
          user_id?: string | null
          webhook_id?: string | null
          webhook_status?: string | null
        }
        Update: {
          ai_reply_mode?: string | null
          allow_subtask_creation?: boolean | null
          allow_task_updates?: boolean | null
          auto_reply_enabled?: boolean | null
          cooldown_seconds?: number | null
          created_at?: string | null
          custom_triggers?: string[] | null
          default_list_id?: string | null
          id?: string
          last_error?: string | null
          last_successful_ai_reply_at?: string | null
          last_tested_at?: string | null
          last_webhook_event_at?: string | null
          max_reply_length?: number | null
          reply_trigger_mode?: string | null
          team_id?: string
          updated_at?: string | null
          user_id?: string | null
          webhook_id?: string | null
          webhook_status?: string | null
        }
        Relationships: []
      }
      clickup_processed_comments: {
        Row: {
          comment_id: string
          created_at: string | null
          error_message: string | null
          event_type: string | null
          handled_at: string | null
          id: string
          response_comment_id: string | null
          status: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          handled_at?: string | null
          id?: string
          response_comment_id?: string | null
          status?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          handled_at?: string | null
          id?: string
          response_comment_id?: string | null
          status?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      creative_reference_assets: {
        Row: {
          analysis: Json | null
          asset_type: string | null
          created_at: string
          id: string
          metadata: Json | null
          notes: string | null
          source_url: string | null
          user_id: string
        }
        Insert: {
          analysis?: Json | null
          asset_type?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          source_url?: string | null
          user_id: string
        }
        Update: {
          analysis?: Json | null
          asset_type?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          source_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      credential_audit_log: {
        Row: {
          action: string
          connection_id: string | null
          created_at: string
          detail: string | null
          id: string
          ip_hash: string | null
          provider: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          connection_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          ip_hash?: string | null
          provider?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          connection_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          ip_hash?: string | null
          provider?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_audit_log_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      descript_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          input_prompt: string | null
          job_id: string
          job_type: string
          output_data: Json | null
          project_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_prompt?: string | null
          job_id: string
          job_type?: string
          output_data?: Json | null
          project_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_prompt?: string | null
          job_id?: string
          job_type?: string
          output_data?: Json | null
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      discovered_events: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          end_date: string | null
          event_date: string | null
          id: string
          location: string | null
          metadata: Json | null
          source: string | null
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date?: string | null
          id?: string
          location?: string | null
          metadata?: Json | null
          source?: string | null
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date?: string | null
          id?: string
          location?: string | null
          metadata?: Json | null
          source?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          auth_type: string
          created_at: string
          credential_ref: string | null
          external_account_id: string | null
          external_account_label: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          last_validated_at: string | null
          metadata: Json | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_type?: string
          created_at?: string
          credential_ref?: string | null
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_type?: string
          created_at?: string
          credential_ref?: string | null
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_credentials: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          last_used_at: string | null
          last4: string | null
          rotated_at: string | null
          secret_ciphertext: string
          secret_name: string
          secret_nonce: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          last4?: string | null
          rotated_at?: string | null
          secret_ciphertext: string
          secret_name?: string
          secret_nonce: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          last4?: string | null
          rotated_at?: string | null
          secret_ciphertext?: string
          secret_name?: string
          secret_nonce?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          completed_at: string | null
          connection_id: string
          created_at: string
          direction: string
          error_message: string | null
          id: string
          records_processed: number
          started_at: string | null
          status: string
          sync_type: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          records_processed?: number
          started_at?: string | null
          status?: string
          sync_type?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          records_processed?: number
          started_at?: string | null
          status?: string
          sync_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          category: string
          content: string
          created_at: string
          domain: string
          embedding: string | null
          id: string
          source_id: string | null
          source_material: string | null
          source_person: string
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          domain?: string
          embedding?: string | null
          id?: string
          source_id?: string | null
          source_material?: string | null
          source_person: string
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          domain?: string
          embedding?: string | null
          id?: string
          source_id?: string | null
          source_material?: string | null
          source_person?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          created_at: string
          entry_count: number
          id: string
          person: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_count?: number
          id?: string
          person: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_count?: number
          id?: string
          person?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      model_calls: {
        Row: {
          created_at: string
          est_cost: number | null
          id: string
          lane: string | null
          latency_ms: number | null
          metadata: Json | null
          model: string
          session_id: string | null
          tokens_in: number | null
          tokens_out: number | null
          tool_used: string | null
          user_id: string
          user_reaction: string | null
        }
        Insert: {
          created_at?: string
          est_cost?: number | null
          id?: string
          lane?: string | null
          latency_ms?: number | null
          metadata?: Json | null
          model: string
          session_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          tool_used?: string | null
          user_id: string
          user_reaction?: string | null
        }
        Update: {
          created_at?: string
          est_cost?: number | null
          id?: string
          lane?: string | null
          latency_ms?: number | null
          metadata?: Json | null
          model?: string
          session_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          tool_used?: string | null
          user_id?: string
          user_reaction?: string | null
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_id: string
          available_balance: number | null
          created_at: string
          current_balance: number | null
          id: string
          iso_currency_code: string | null
          mask: string | null
          name: string | null
          official_name: string | null
          plaid_item_id: string
          subtype: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          mask?: string | null
          name?: string | null
          official_name?: string | null
          plaid_item_id: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          mask?: string | null
          name?: string | null
          official_name?: string | null
          plaid_item_id?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          connection_id: string | null
          created_at: string
          cursor: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          item_id: string
          last_error: string | null
          last_synced_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_transactions: {
        Row: {
          account_id: string
          amount: number
          authorized_date: string | null
          category_detailed: string | null
          category_primary: string | null
          created_at: string
          id: string
          iso_currency_code: string | null
          merchant_name: string | null
          name: string | null
          pending: boolean | null
          plaid_item_id: string
          posted_date: string | null
          raw_json: Json | null
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          authorized_date?: string | null
          category_detailed?: string | null
          category_primary?: string | null
          created_at?: string
          id?: string
          iso_currency_code?: string | null
          merchant_name?: string | null
          name?: string | null
          pending?: boolean | null
          plaid_item_id: string
          posted_date?: string | null
          raw_json?: Json | null
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          authorized_date?: string | null
          category_detailed?: string | null
          category_primary?: string | null
          created_at?: string
          id?: string
          iso_currency_code?: string | null
          merchant_name?: string | null
          name?: string | null
          pending?: boolean | null
          plaid_item_id?: string
          posted_date?: string | null
          raw_json?: Json | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_transactions_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auto_play_responses: boolean | null
          avatar_url: string | null
          created_at: string
          elevenlabs_voice_id: string | null
          first_name: string | null
          full_name: string | null
          id: string
          is_premium: boolean | null
          last_name: string | null
          onboarding_complete: boolean
          playht_voice_id: string | null
          system_name: string | null
          tts_provider: string | null
          updated_at: string
          user_id: string
          username: string | null
          voice_cloning_status: string | null
          voice_enabled: boolean | null
          voice_id: string | null
        }
        Insert: {
          auto_play_responses?: boolean | null
          avatar_url?: string | null
          created_at?: string
          elevenlabs_voice_id?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_premium?: boolean | null
          last_name?: string | null
          onboarding_complete?: boolean
          playht_voice_id?: string | null
          system_name?: string | null
          tts_provider?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
          voice_cloning_status?: string | null
          voice_enabled?: boolean | null
          voice_id?: string | null
        }
        Update: {
          auto_play_responses?: boolean | null
          avatar_url?: string | null
          created_at?: string
          elevenlabs_voice_id?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_premium?: boolean | null
          last_name?: string | null
          onboarding_complete?: boolean
          playht_voice_id?: string | null
          system_name?: string | null
          tts_provider?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
          voice_cloning_status?: string | null
          voice_enabled?: boolean | null
          voice_id?: string | null
        }
        Relationships: []
      }
      reflection_notes: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          importance: number | null
          metadata: Json | null
          note_type: string
          source_ids: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance?: number | null
          metadata?: Json | null
          note_type?: string
          source_ids?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance?: number | null
          metadata?: Json | null
          note_type?: string
          source_ids?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      research_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          query: string
          report: string | null
          sources: Json | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          query: string
          report?: string | null
          sources?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          query?: string
          report?: string | null
          sources?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      seo_snapshots: {
        Row: {
          created_at: string
          data: Json
          date_range_end: string
          date_range_start: string
          dimensions: string[]
          id: string
          site_url: string
          snapshot_date: string
          totals: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          date_range_end: string
          date_range_start: string
          dimensions?: string[]
          id?: string
          site_url: string
          snapshot_date?: string
          totals?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          date_range_end?: string
          date_range_start?: string
          dimensions?: string[]
          id?: string
          site_url?: string
          snapshot_date?: string
          totals?: Json
          user_id?: string
        }
        Relationships: []
      }
      standing_orders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          priority: number
          rule: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          priority?: number
          rule: string
          scope?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          priority?: number
          rule?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_evolution_proposals: {
        Row: {
          created_at: string
          description: string
          id: string
          metadata: Json | null
          patch_text: string | null
          proposal_type: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
          patch_text?: string | null
          proposal_type?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
          patch_text?: string | null
          proposal_type?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      user_goals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          progress_notes: Json
          status: string
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          progress_notes?: Json
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          progress_notes?: Json
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_personality: {
        Row: {
          about_me: string | null
          created_at: string
          house_rules: string[]
          id: string
          identity: Json
          reference_persona: string | null
          tone_settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          about_me?: string | null
          created_at?: string
          house_rules?: string[]
          id?: string
          identity?: Json
          reference_persona?: string | null
          tone_settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          about_me?: string | null
          created_at?: string
          house_rules?: string[]
          id?: string
          identity?: Json
          reference_persona?: string | null
          tone_settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      video_tasks: {
        Row: {
          aspect_ratio: string
          created_at: string
          edit_instructions: string | null
          edit_plan: Json
          edit_plan_status: string
          id: string
          output_url: string | null
          render_history: Json
          render_progress: number
          render_status: string
          requested_output: string
          source_asset_url: string | null
          source_content: string | null
          source_type: string
          target_duration: number | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          work_task_id: string
        }
        Insert: {
          aspect_ratio?: string
          created_at?: string
          edit_instructions?: string | null
          edit_plan?: Json
          edit_plan_status?: string
          id?: string
          output_url?: string | null
          render_history?: Json
          render_progress?: number
          render_status?: string
          requested_output?: string
          source_asset_url?: string | null
          source_content?: string | null
          source_type?: string
          target_duration?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          work_task_id: string
        }
        Update: {
          aspect_ratio?: string
          created_at?: string
          edit_instructions?: string | null
          edit_plan?: Json
          edit_plan_status?: string
          id?: string
          output_url?: string | null
          render_history?: Json
          render_progress?: number
          render_status?: string
          requested_output?: string
          source_asset_url?: string | null
          source_content?: string | null
          source_type?: string
          target_duration?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          work_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_tasks_work_task_id_fkey"
            columns: ["work_task_id"]
            isOneToOne: true
            referencedRelation: "work_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      viral_creative_sessions: {
        Row: {
          angle_outputs: Json | null
          content_goal: string | null
          created_at: string
          hook_outputs: Json | null
          id: string
          output_metadata: Json | null
          platform: string | null
          prompt_candidates: Json | null
          request_text: string | null
          score_data: Json | null
          selected_prompts: Json | null
          source_context: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          angle_outputs?: Json | null
          content_goal?: string | null
          created_at?: string
          hook_outputs?: Json | null
          id?: string
          output_metadata?: Json | null
          platform?: string | null
          prompt_candidates?: Json | null
          request_text?: string | null
          score_data?: Json | null
          selected_prompts?: Json | null
          source_context?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          angle_outputs?: Json | null
          content_goal?: string | null
          created_at?: string
          hook_outputs?: Json | null
          id?: string
          output_metadata?: Json | null
          platform?: string | null
          prompt_candidates?: Json | null
          request_text?: string | null
          score_data?: Json | null
          selected_prompts?: Json | null
          source_context?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wisdom_memories: {
        Row: {
          confidence: number | null
          content: string
          created_at: string
          embedding: string | null
          id: string
          last_accessed_at: string | null
          memory_type: string
          metadata: Json | null
          recurrence_count: number | null
          salience: number | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          last_accessed_at?: string | null
          memory_type?: string
          metadata?: Json | null
          recurrence_count?: number | null
          salience?: number | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          last_accessed_at?: string | null
          memory_type?: string
          metadata?: Json | null
          recurrence_count?: number | null
          salience?: number | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      work_tasks: {
        Row: {
          ai_activity_log: Json
          ai_status: string
          archived_at: string | null
          assigned_to: string | null
          attachments: Json
          board_position: number
          comments: Json
          completed_at: string | null
          created_at: string
          description: string | null
          draft_output: string | null
          final_deliverable: string | null
          id: string
          intent_type: string
          last_activity_at: string
          next_action: string
          priority: string
          revision_notes: string | null
          source_chat_session_id: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_activity_log?: Json
          ai_status?: string
          archived_at?: string | null
          assigned_to?: string | null
          attachments?: Json
          board_position?: number
          comments?: Json
          completed_at?: string | null
          created_at?: string
          description?: string | null
          draft_output?: string | null
          final_deliverable?: string | null
          id?: string
          intent_type?: string
          last_activity_at?: string
          next_action?: string
          priority?: string
          revision_notes?: string | null
          source_chat_session_id?: string | null
          status?: string
          task_type?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_activity_log?: Json
          ai_status?: string
          archived_at?: string | null
          assigned_to?: string | null
          attachments?: Json
          board_position?: number
          comments?: Json
          completed_at?: string | null
          created_at?: string
          description?: string | null
          draft_output?: string | null
          final_deliverable?: string | null
          id?: string
          intent_type?: string
          last_activity_at?: string
          next_action?: string
          priority?: string
          revision_notes?: string | null
          source_chat_session_id?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      youtube_channels: {
        Row: {
          channel_id: string
          connection_id: string
          created_at: string
          description: string | null
          fetched_at: string
          id: string
          raw: Json | null
          subscriber_count: number | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          channel_id: string
          connection_id: string
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          raw?: Json | null
          subscriber_count?: number | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          channel_id?: string
          connection_id?: string
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          raw?: Json | null
          subscriber_count?: number | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_channels_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_videos: {
        Row: {
          channel_id: string
          comment_count: number | null
          connection_id: string
          created_at: string
          description: string | null
          fetched_at: string
          id: string
          like_count: number | null
          published_at: string | null
          raw: Json | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_id: string
          view_count: number | null
        }
        Insert: {
          channel_id: string
          comment_count?: number | null
          connection_id: string
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          like_count?: number | null
          published_at?: string | null
          raw?: Json | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_id: string
          view_count?: number | null
        }
        Update: {
          channel_id?: string
          comment_count?: number | null
          connection_id?: string
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          like_count?: number | null
          published_at?: string | null
          raw?: Json | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_videos_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_secret: {
        Args: {
          _connection_id: string
          _encryption_key?: string
          _secret_name?: string
          _user_id: string
        }
        Returns: string
      }
      match_knowledge: {
        Args: {
          filter_category?: string
          filter_domain?: string
          filter_user_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          domain: string
          id: string
          similarity: number
          source_material: string
          source_person: string
          tags: string[]
          title: string
        }[]
      }
      match_reflections: {
        Args: {
          filter_note_type?: string
          filter_user_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          importance: number
          metadata: Json
          note_type: string
          similarity: number
          source_ids: Json
        }[]
      }
      match_wisdom_memories: {
        Args: {
          filter_memory_type?: string
          filter_user_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          confidence: number
          content: string
          id: string
          last_accessed_at: string
          memory_type: string
          metadata: Json
          recurrence_count: number
          salience: number
          similarity: number
          summary: string
          updated_at: string
        }[]
      }
      store_user_secret: {
        Args: {
          _connection_id: string
          _encryption_key: string
          _plaintext: string
          _secret_name?: string
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
