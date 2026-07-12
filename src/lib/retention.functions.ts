import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Tabelas de histórico sujeitas à política de retenção. */
const HISTORY_TABLES = [
  "product_movements",
  "ingredient_movements",
  "filling_movements",
  "activity_logs",
] as const;

type HistoryTable = (typeof HISTORY_TABLES)[number];

/** Registros mantidos por 3 anos. */
const RETENTION_YEARS = 3;
/** Limite de volume total (indicador de "espaço" de memória). */
export const VOLUME_LIMIT = 200_000;

function cutoffISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - RETENTION_YEARS);
  return d.toISOString();
}

export interface RetentionStatus {
  cutoff: string;
  volumeLimit: number;
  totalRecords: number;
  oldRecords: number;
  overVolume: boolean;
  hasOld: boolean;
  warn: boolean;
  tables: { table: HistoryTable; total: number; old: number }[];
}

export const getRetentionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RetentionStatus> => {
    const cutoff = cutoffISO();
    const tables: RetentionStatus["tables"] = [];
    let totalRecords = 0;
    let oldRecords = 0;

    for (const table of HISTORY_TABLES) {
      const totalRes = await context.supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      const oldRes = await context.supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .lt("created_at", cutoff);
      const total = totalRes.count ?? 0;
      const old = oldRes.count ?? 0;
      tables.push({ table, total, old });
      totalRecords += total;
      oldRecords += old;
    }

    const overVolume = totalRecords > VOLUME_LIMIT;
    const hasOld = oldRecords > 0;

    return {
      cutoff,
      volumeLimit: VOLUME_LIMIT,
      totalRecords,
      oldRecords,
      overVolume,
      hasOld,
      warn: overVolume || hasOld,
      tables,
    };
  });

export interface ArchivableRecords {
  cutoff: string;
  rows: Record<HistoryTable, Record<string, unknown>[]>;
}

/** Retorna os registros que serão removidos (mais antigos que 3 anos) para exportação. */
export const fetchArchivableRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ArchivableRecords> => {
    const cutoff = cutoffISO();
    const rows = {} as Record<HistoryTable, Record<string, unknown>[]>;
    for (const table of HISTORY_TABLES) {
      const { data } = await context.supabase
        .from(table)
        .select("*")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(50_000);
      rows[table] = (data ?? []) as Record<string, unknown>[];
    }
    return { cutoff, rows };
  });

export interface PurgeResult {
  deleted: number;
  perTable: { table: HistoryTable; deleted: number }[];
}

/** Remove definitivamente os registros com mais de 3 anos. Apenas administradores. */
export const purgeOldRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PurgeResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem liberar espaço.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = cutoffISO();
    const perTable: PurgeResult["perTable"] = [];
    let deleted = 0;

    for (const table of HISTORY_TABLES) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .delete()
        .lt("created_at", cutoff)
        .select("id");
      if (error) throw new Error(error.message);
      const n = data?.length ?? 0;
      perTable.push({ table, deleted: n });
      deleted += n;
    }

    return { deleted, perTable };
  });
