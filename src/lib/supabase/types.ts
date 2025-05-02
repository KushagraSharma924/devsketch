export type Database = {
  public: {
    Tables: {
      // Define your tables here as needed
      // For example:
      profiles: {
        Row: {
          id: string
          updated_at: string | null
          username: string | null
          full_name: string | null
          avatar_url: string | null
        }
        Insert: {
          id: string
          updated_at?: string | null
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
        }
        Update: {
          id?: string
          updated_at?: string | null
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
        }
      },
      designs: {
        Row: {
          id: string
          user_id: string
          excalidraw_data: any
          code: string | null
          created_at: string
          updated_at: string
          session_id: string
          created_by_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          excalidraw_data: any
          code?: string | null
          created_at?: string
          updated_at?: string
          session_id: string
          created_by_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          excalidraw_data?: any
          code?: string | null
          updated_at?: string
          session_id?: string
          created_by_id?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
} 