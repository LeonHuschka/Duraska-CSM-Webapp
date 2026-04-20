export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          global_role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          global_role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          global_role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      personas: {
        Row: {
          id: string;
          name: string;
          slug: string;
          avatar_url: string | null;
          brand_color: string;
          platforms: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          avatar_url?: string | null;
          brand_color?: string;
          platforms?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          avatar_url?: string | null;
          brand_color?: string;
          platforms?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      persona_members: {
        Row: {
          persona_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          persona_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          persona_id?: string;
          user_id?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "persona_members_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "persona_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      content_types: {
        Row: {
          id: string;
          persona_id: string;
          name: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          persona_id: string;
          name: string;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          persona_id?: string;
          name?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_types_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
      content_requests: {
        Row: {
          id: string;
          persona_id: string;
          title: string;
          description: string | null;
          inspo_links: string[] | null;
          inspo_link: string | null;
          reference_image_urls: string[] | null;
          content_type_id: string | null;
          status: string;
          priority: string;
          due_date: string | null;
          created_by: string | null;
          assigned_to: string | null;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          persona_id: string;
          title: string;
          description?: string | null;
          inspo_links?: string[] | null;
          inspo_link?: string | null;
          reference_image_urls?: string[] | null;
          content_type_id?: string | null;
          status?: string;
          priority?: string;
          due_date?: string | null;
          created_by?: string | null;
          assigned_to?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          persona_id?: string;
          title?: string;
          description?: string | null;
          inspo_links?: string[] | null;
          inspo_link?: string | null;
          reference_image_urls?: string[] | null;
          content_type_id?: string | null;
          status?: string;
          priority?: string;
          due_date?: string | null;
          created_by?: string | null;
          assigned_to?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_requests_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
      content_assets: {
        Row: {
          id: string;
          request_id: string;
          stage: string;
          file_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          duration_seconds: number | null;
          width: number | null;
          height: number | null;
          thumbnail_path: string | null;
          uploaded_by: string | null;
          uploaded_at: string;
          notes: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          request_id: string;
          stage?: string;
          file_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          duration_seconds?: number | null;
          width?: number | null;
          height?: number | null;
          thumbnail_path?: string | null;
          uploaded_by?: string | null;
          uploaded_at?: string;
          notes?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          request_id?: string;
          stage?: string;
          file_path?: string;
          file_name?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          duration_seconds?: number | null;
          width?: number | null;
          height?: number | null;
          thumbnail_path?: string | null;
          uploaded_by?: string | null;
          uploaded_at?: string;
          notes?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_assets_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "content_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_slots: {
        Row: {
          id: string;
          request_id: string | null;
          asset_id: string | null;
          persona_id: string;
          platform: string;
          caption: string | null;
          scheduled_for: string;
          status: string;
          posted_at: string | null;
          post_url: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id?: string | null;
          asset_id?: string | null;
          persona_id: string;
          platform?: string;
          caption?: string | null;
          scheduled_for: string;
          status?: string;
          posted_at?: string | null;
          post_url?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string | null;
          asset_id?: string | null;
          persona_id?: string;
          platform?: string;
          caption?: string | null;
          scheduled_for?: string;
          status?: string;
          posted_at?: string | null;
          post_url?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_slots_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
      posting_timeslots: {
        Row: {
          id: string;
          persona_id: string;
          time_utc: string;
          label: string | null;
          platform: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          persona_id: string;
          time_utc: string;
          label?: string | null;
          platform?: string;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          persona_id?: string;
          time_utc?: string;
          label?: string | null;
          platform?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posting_timeslots_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: {
          id: string;
          persona_id: string;
          request_id: string | null;
          user_id: string;
          action: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          persona_id: string;
          request_id?: string | null;
          user_id: string;
          action: string;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          persona_id?: string;
          request_id?: string | null;
          user_id?: string;
          action?: string;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_id_by_email: {
        Args: { email_input: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type UserProfile =
  Database["public"]["Tables"]["user_profiles"]["Row"];
export type Persona = Database["public"]["Tables"]["personas"]["Row"];
export type PersonaMember =
  Database["public"]["Tables"]["persona_members"]["Row"];
export type ContentRequest =
  Database["public"]["Tables"]["content_requests"]["Row"];
export type ContentAsset =
  Database["public"]["Tables"]["content_assets"]["Row"];
export type ScheduleSlot =
  Database["public"]["Tables"]["schedule_slots"]["Row"];
export type ActivityLog =
  Database["public"]["Tables"]["activity_log"]["Row"];

export type GlobalRole = "owner" | "manager" | "model" | "va";
export type PersonaRole = "owner" | "manager" | "model" | "va";
export type RequestStatus = "requested" | "shooted" | "edited" | "scheduled" | "posted" | "archived";
export type AssetStage = "raw" | "edited" | "final";
export type Effort = "easy" | "medium" | "high" | "heavy";
export type ContentType = Database["public"]["Tables"]["content_types"]["Row"];
export type SlotStatus = "planned" | "ready" | "posted" | "failed";
export type Platform = "instagram" | "fansly" | "tiktok" | "other";

export type PostingTimeslot =
  Database["public"]["Tables"]["posting_timeslots"]["Row"];
export type PersonaWithRole = Persona & { role: PersonaRole };
