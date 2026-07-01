import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useRealtime } from "@/hooks/useRealtime";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/historico")({
  component: HistoricoPage,
});

type Log = {
  id: string; modulo: string; acao: string; registro_id: string | null;
  created_at: string; user_id: string | null;
};

function HistoricoPage() {
  const [search, setSearch] = useState("");
  useRealtime(["activity_logs"], ["activity_logs"]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome");
      if (error) throw error;
      return data;
    },
  });
  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.nome || "Sistema";

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["activity_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, modulo, acao, registro_id, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Log[];
    },
  });

  const filtered = rows.filter((r) =>
    [r.modulo, r.acao, nameOf(r.user_id)].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Histórico de Atividades" subtitle="Trilha de auditoria de todo o sistema" icon={History} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por módulo, ação, usuário..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={History} title="Nenhum registro" />
        : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data/Hora</TableHead><TableHead>Usuário</TableHead>
                <TableHead>Módulo</TableHead><TableHead>Ação</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular text-muted-foreground">{fmtDateTime(r.created_at)}</TableCell>
                    <TableCell>{nameOf(r.user_id)}</TableCell>
                    <TableCell className="capitalize">{r.modulo}</TableCell>
                    <TableCell>{r.acao}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );
}
