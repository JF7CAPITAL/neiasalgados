import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";


export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/painel" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/painel" });
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin, data: { nome } },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Você já pode entrar.");
    navigate({ to: "/painel" });
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      return toast.error("Não foi possível entrar com Google.");
    }
    if (result.redirected) return;
    navigate({ to: "/painel" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/neia-logo.png" alt="Neia Salgados" className="mb-4 h-24 w-auto object-contain" />
          <p className="mt-1 text-sm text-muted-foreground">
            Gestão industrial para fábricas de salgados
          </p>
        </div>


        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="l-email">Email</Label>
                  <Input id="l-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@fabrica.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="l-pass">Senha</Label>
                  <Input id="l-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Entrar
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="s-nome">Nome</Label>
                  <Input id="s-nome" value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Seu nome" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-email">Email</Label>
                  <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@fabrica.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-pass">Senha</Label>
                  <Input id="s-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Criar conta
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            Continuar com Google
          </Button>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            O primeiro usuário cadastrado torna-se Administrador automaticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
