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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          id: string
          modulo: string
          registro_id: string | null
          user_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          modulo: string
          registro_id?: string | null
          user_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          modulo?: string
          registro_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      anota_combo_item_map: {
        Row: {
          combo_ref: string
          created_at: string
          id: string
          nome: string | null
          product_id: string
          quantidade: number
          updated_at: string
        }
        Insert: {
          combo_ref: string
          created_at?: string
          id?: string
          nome?: string | null
          product_id: string
          quantidade?: number
          updated_at?: string
        }
        Update: {
          combo_ref?: string
          created_at?: string
          id?: string
          nome?: string | null
          product_id?: string
          quantidade?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anota_combo_item_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      anota_order_items: {
        Row: {
          anota_item_ref: string | null
          combo_ref: string | null
          created_at: string
          id: string
          is_combo: boolean
          mapeado: boolean
          nome: string | null
          order_id: string
          product_id: string | null
          quantidade: number
        }
        Insert: {
          anota_item_ref?: string | null
          combo_ref?: string | null
          created_at?: string
          id?: string
          is_combo?: boolean
          mapeado?: boolean
          nome?: string | null
          order_id: string
          product_id?: string | null
          quantidade?: number
        }
        Update: {
          anota_item_ref?: string | null
          combo_ref?: string | null
          created_at?: string
          id?: string
          is_combo?: boolean
          mapeado?: boolean
          nome?: string | null
          order_id?: string
          product_id?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "anota_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "anota_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anota_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      anota_orders: {
        Row: {
          check_status: number
          cliente: string | null
          created_at: string
          estoque_aplicado: boolean
          external_order_id: string
          id: string
          imported_at: string
          motoboy_id: string | null
          numero: string | null
          payload: Json | null
          pedido_em: string | null
          total: number
          updated_at: string
          whatsapp_keywords_notified: string[]
          whatsapp_notified_at: string | null
          whatsapp_ready_notified_at: string | null
          whatsapp_statuses_notified: string[]
        }
        Insert: {
          check_status?: number
          cliente?: string | null
          created_at?: string
          estoque_aplicado?: boolean
          external_order_id: string
          id?: string
          imported_at?: string
          motoboy_id?: string | null
          numero?: string | null
          payload?: Json | null
          pedido_em?: string | null
          total?: number
          updated_at?: string
          whatsapp_keywords_notified?: string[]
          whatsapp_notified_at?: string | null
          whatsapp_ready_notified_at?: string | null
          whatsapp_statuses_notified?: string[]
        }
        Update: {
          check_status?: number
          cliente?: string | null
          created_at?: string
          estoque_aplicado?: boolean
          external_order_id?: string
          id?: string
          imported_at?: string
          motoboy_id?: string | null
          numero?: string | null
          payload?: Json | null
          pedido_em?: string | null
          total?: number
          updated_at?: string
          whatsapp_keywords_notified?: string[]
          whatsapp_notified_at?: string | null
          whatsapp_ready_notified_at?: string | null
          whatsapp_statuses_notified?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "anota_orders_motoboy_id_fkey"
            columns: ["motoboy_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      anota_product_map: {
        Row: {
          anota_item_ref: string
          created_at: string
          id: string
          nome: string | null
          product_id: string | null
          updated_at: string
        }
        Insert: {
          anota_item_ref: string
          created_at?: string
          id?: string
          nome?: string | null
          product_id?: string | null
          updated_at?: string
        }
        Update: {
          anota_item_ref?: string
          created_at?: string
          id?: string
          nome?: string | null
          product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anota_product_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          banco_horas: number | null
          cargo: string | null
          celular: string | null
          cpf: string | null
          created_at: string
          data_admissao: string | null
          deleted_at: string | null
          em_turno: boolean
          email: string | null
          endereco: string | null
          escala: string | null
          foto_url: string | null
          horario: string | null
          id: string
          nome: string
          observacoes: string | null
          rg: string | null
          status: string
          telefone: string | null
          turno: string | null
          updated_at: string
        }
        Insert: {
          banco_horas?: number | null
          cargo?: string | null
          celular?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          deleted_at?: string | null
          em_turno?: boolean
          email?: string | null
          endereco?: string | null
          escala?: string | null
          foto_url?: string | null
          horario?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          rg?: string | null
          status?: string
          telefone?: string | null
          turno?: string | null
          updated_at?: string
        }
        Update: {
          banco_horas?: number | null
          cargo?: string | null
          celular?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          deleted_at?: string | null
          em_turno?: boolean
          email?: string | null
          endereco?: string | null
          escala?: string | null
          foto_url?: string | null
          horario?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          rg?: string | null
          status?: string
          telefone?: string | null
          turno?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      filling_movements: {
        Row: {
          created_at: string
          filling_id: string
          id: string
          motivo: string | null
          observacoes: string | null
          quantidade: number
          ref_order_id: string | null
          saldo_anterior: number | null
          saldo_novo: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          filling_id: string
          id?: string
          motivo?: string | null
          observacoes?: string | null
          quantidade?: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          filling_id?: string
          id?: string
          motivo?: string | null
          observacoes?: string | null
          quantidade?: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo?: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filling_movements_filling_id_fkey"
            columns: ["filling_id"]
            isOneToOne: false
            referencedRelation: "fillings"
            referencedColumns: ["id"]
          },
        ]
      }
      filling_recipe_items: {
        Row: {
          created_at: string
          filling_id: string
          id: string
          ingredient_id: string
          quantidade: number
          unidade: string | null
        }
        Insert: {
          created_at?: string
          filling_id: string
          id?: string
          ingredient_id: string
          quantidade?: number
          unidade?: string | null
        }
        Update: {
          created_at?: string
          filling_id?: string
          id?: string
          ingredient_id?: string
          quantidade?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filling_recipe_items_filling_id_fkey"
            columns: ["filling_id"]
            isOneToOne: false
            referencedRelation: "fillings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filling_recipe_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      fillings: {
        Row: {
          codigo: string | null
          created_at: string
          deleted_at: string | null
          estoque_ideal: number
          estoque_maximo: number
          estoque_minimo: number
          id: string
          nome: string
          observacoes: string | null
          quantidade_atual: number
          unidade: string
          updated_at: string
        }
        Insert: {
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          id?: string
          nome: string
          observacoes?: string | null
          quantidade_atual?: number
          unidade?: string
          updated_at?: string
        }
        Update: {
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          id?: string
          nome?: string
          observacoes?: string | null
          quantidade_atual?: number
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingredient_movements: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          motivo: string | null
          observacoes: string | null
          quantidade: number
          ref_order_id: string | null
          saldo_anterior: number | null
          saldo_novo: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          motivo?: string | null
          observacoes?: string | null
          quantidade: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          motivo?: string | null
          observacoes?: string | null
          quantidade?: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo?: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          ativo: boolean
          categoria: string | null
          codigo: string | null
          created_at: string
          deleted_at: string | null
          estoque_ideal: number
          estoque_maximo: number
          estoque_minimo: number
          id: string
          localizacao: string | null
          lote: string | null
          nome: string
          observacoes: string | null
          preco_medio: number
          preco_ultima_compra: number
          quantidade_atual: number
          supplier_id: string | null
          unidade: string
          updated_at: string
          validade: string | null
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          id?: string
          localizacao?: string | null
          lote?: string | null
          nome: string
          observacoes?: string | null
          preco_medio?: number
          preco_ultima_compra?: number
          quantidade_atual?: number
          supplier_id?: string | null
          unidade?: string
          updated_at?: string
          validade?: string | null
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          id?: string
          localizacao?: string | null
          lote?: string | null
          nome?: string
          observacoes?: string | null
          preco_medio?: number
          preco_ultima_compra?: number
          quantidade_atual?: number
          supplier_id?: string | null
          unidade?: string
          updated_at?: string
          validade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_movements: {
        Row: {
          created_at: string
          destino: string | null
          id: string
          observacoes: string | null
          product_id: string
          quantidade: number
          ref_order_id: string | null
          saldo_anterior: number | null
          saldo_novo: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destino?: string | null
          id?: string
          observacoes?: string | null
          product_id: string
          quantidade: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destino?: string | null
          id?: string
          observacoes?: string | null
          product_id?: string
          quantidade?: number
          ref_order_id?: string | null
          saldo_anterior?: number | null
          saldo_novo?: number | null
          tipo?: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          auto_gerada: boolean
          created_at: string
          deleted_at: string | null
          filling_id: string | null
          fim: string | null
          id: string
          inicio: string | null
          kind: Database["public"]["Enums"]["order_kind"]
          massadas: number
          numero: number
          observacoes: string | null
          perdas: number | null
          previsao: string | null
          prioridade: Database["public"]["Enums"]["order_priority"]
          product_id: string | null
          quantidade_atual: number
          quantidade_estimada: number
          quantidade_ideal: number
          quantidade_necessaria: number
          quantidade_produzida: number | null
          responsavel: string | null
          status: Database["public"]["Enums"]["order_status"]
          tipo_massa: Database["public"]["Enums"]["massa_tipo"] | null
          updated_at: string
        }
        Insert: {
          auto_gerada?: boolean
          created_at?: string
          deleted_at?: string | null
          filling_id?: string | null
          fim?: string | null
          id?: string
          inicio?: string | null
          kind?: Database["public"]["Enums"]["order_kind"]
          massadas?: number
          numero?: never
          observacoes?: string | null
          perdas?: number | null
          previsao?: string | null
          prioridade?: Database["public"]["Enums"]["order_priority"]
          product_id?: string | null
          quantidade_atual?: number
          quantidade_estimada?: number
          quantidade_ideal?: number
          quantidade_necessaria?: number
          quantidade_produzida?: number | null
          responsavel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tipo_massa?: Database["public"]["Enums"]["massa_tipo"] | null
          updated_at?: string
        }
        Update: {
          auto_gerada?: boolean
          created_at?: string
          deleted_at?: string | null
          filling_id?: string | null
          fim?: string | null
          id?: string
          inicio?: string | null
          kind?: Database["public"]["Enums"]["order_kind"]
          massadas?: number
          numero?: never
          observacoes?: string | null
          perdas?: number | null
          previsao?: string | null
          prioridade?: Database["public"]["Enums"]["order_priority"]
          product_id?: string | null
          quantidade_atual?: number
          quantidade_estimada?: number
          quantidade_ideal?: number
          quantidade_necessaria?: number
          quantidade_produzida?: number | null
          responsavel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tipo_massa?: Database["public"]["Enums"]["massa_tipo"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_filling_id_fkey"
            columns: ["filling_id"]
            isOneToOne: false
            referencedRelation: "fillings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          categoria: string | null
          codigo: string | null
          created_at: string
          deleted_at: string | null
          estoque_ideal: number
          estoque_maximo: number
          estoque_minimo: number
          foto_url: string | null
          id: string
          nome: string
          peso: number
          peso_massa: number
          peso_recheio: number
          quantidade_atual: number
          quantidade_reservada: number
          status: boolean
          tipo: Database["public"]["Enums"]["massa_tipo"]
          unidade: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          foto_url?: string | null
          id?: string
          nome: string
          peso?: number
          peso_massa?: number
          peso_recheio?: number
          quantidade_atual?: number
          quantidade_reservada?: number
          status?: boolean
          tipo?: Database["public"]["Enums"]["massa_tipo"]
          unidade?: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          deleted_at?: string | null
          estoque_ideal?: number
          estoque_maximo?: number
          estoque_minimo?: number
          foto_url?: string | null
          id?: string
          nome?: string
          peso?: number
          peso_massa?: number
          peso_recheio?: number
          quantidade_atual?: number
          quantidade_reservada?: number
          status?: boolean
          tipo?: Database["public"]["Enums"]["massa_tipo"]
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          nome?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          auto_gerada: boolean
          created_at: string
          deleted_at: string | null
          id: string
          ingredient_id: string
          numero: number
          observacoes: string | null
          preco_medio: number
          prioridade: Database["public"]["Enums"]["order_priority"]
          quantidade_necessaria: number
          responsavel: string | null
          status: Database["public"]["Enums"]["order_status"]
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          auto_gerada?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          ingredient_id: string
          numero?: never
          observacoes?: string | null
          preco_medio?: number
          prioridade?: Database["public"]["Enums"]["order_priority"]
          quantidade_necessaria?: number
          responsavel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_gerada?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          ingredient_id?: string
          numero?: never
          observacoes?: string | null
          preco_medio?: number
          prioridade?: Database["public"]["Enums"]["order_priority"]
          quantidade_necessaria?: number
          responsavel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          created_at: string
          filling_id: string | null
          id: string
          ingredient_id: string | null
          product_id: string
          quantidade: number
          unidade: string | null
        }
        Insert: {
          created_at?: string
          filling_id?: string | null
          id?: string
          ingredient_id?: string | null
          product_id: string
          quantidade?: number
          unidade?: string | null
        }
        Update: {
          created_at?: string
          filling_id?: string | null
          id?: string
          ingredient_id?: string | null
          product_id?: string
          quantidade?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_filling_id_fkey"
            columns: ["filling_id"]
            isOneToOne: false
            referencedRelation: "fillings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          ativo: boolean
          contato: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          nome: string
          observacoes: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          contato?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          contato?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_keyword_rules: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          imagem_url: string | null
          mensagem: string
          nome: string
          palavras_chave: string
          regra: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          mensagem?: string
          nome?: string
          palavras_chave?: string
          regra: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          mensagem?: string
          nome?: string
          palavras_chave?: string
          regra?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_notifications: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          imagem_url: string | null
          mensagem: string
          regra: string
          status: number | null
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          mensagem?: string
          regra: string
          status?: number | null
          titulo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          mensagem?: string
          regra?: string
          status?: number | null
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_processed_messages: {
        Row: {
          created_at: string
          id: string
          message_id: string
          phone: string | null
          regra: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          phone?: string | null
          regra?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          phone?: string | null
          regra?: string | null
        }
        Relationships: []
      }
      whatsapp_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_anota_order_stock: {
        Args: { p_order: string; p_user?: string }
        Returns: undefined
      }
      complete_production_order: {
        Args: {
          p_obs?: string
          p_order: string
          p_perdas?: number
          p_produzida: number
          p_user?: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      receive_purchase_order: {
        Args: {
          p_order: string
          p_preco?: number
          p_quantidade: number
          p_user?: string
        }
        Returns: undefined
      }
      revert_anota_order_stock: {
        Args: { p_order: string; p_user?: string }
        Returns: undefined
      }
      start_production_order: {
        Args: { p_order: string; p_user?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "producao"
        | "estoque"
        | "compras"
        | "financeiro"
        | "rh"
        | "operacional"
      massa_tipo: "frito" | "assado"
      movement_type: "entrada" | "saida" | "ajuste" | "perda" | "inventario"
      order_kind: "producao" | "recheio" | "compra"
      order_priority: "baixa" | "media" | "alta" | "urgente"
      order_status: "pendente" | "em_andamento" | "concluida" | "cancelada"
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
    Enums: {
      app_role: [
        "admin",
        "producao",
        "estoque",
        "compras",
        "financeiro",
        "rh",
        "operacional",
      ],
      massa_tipo: ["frito", "assado"],
      movement_type: ["entrada", "saida", "ajuste", "perda", "inventario"],
      order_kind: ["producao", "recheio", "compra"],
      order_priority: ["baixa", "media", "alta", "urgente"],
      order_status: ["pendente", "em_andamento", "concluida", "cancelada"],
    },
  },
} as const
