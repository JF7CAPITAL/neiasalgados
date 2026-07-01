import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "admin"
  | "producao"
  | "estoque"
  | "compras"
  | "financeiro"
  | "rh"
  | "operacional";

export interface Profile {
  id: string;
  nome: string;
  email: string | null;
  avatar_url: string | null;
}

export interface AuthState {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  roles: AppRole[];
  isLoading: boolean;
}

export function useAuth(): AuthState {
  const { data, isLoading } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return { user: null, profile: null, roles: [] as AppRole[] };

      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase.from("profiles").select("id, nome, email, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      return {
        user,
        profile: (profile as Profile) ?? null,
        roles: (roleRows ?? []).map((r) => r.role as AppRole),
      };
    },
    staleTime: 30_000,
  });

  return {
    userId: data?.user?.id ?? null,
    email: data?.user?.email ?? null,
    profile: data?.profile ?? null,
    roles: data?.roles ?? [],
    isLoading,
  };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  producao: "Produção",
  estoque: "Estoque",
  compras: "Compras",
  financeiro: "Financeiro",
  rh: "RH",
  operacional: "Operacional",
};

export function hasAccess(roles: AppRole[], allowed: AppRole[]): boolean {
  if (roles.includes("admin")) return true;
  return roles.some((r) => allowed.includes(r));
}
