import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracao/email")({
  component: () => {
    const { email: currentEmail, userId } = useAuth();
    const navigate = useNavigate();
    const [newEmail, setNewEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setSuccess(false);

      if (!newEmail || !password) {
        setError("Todos os campos são obrigatórios");
        return;
      }

      if (newEmail === currentEmail) {
        setError("O novo email deve ser diferente do atual");
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        setError("Email inválido");
        return;
      }

      setIsLoading(true);

      try {
        // Verify current password
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user?.email) {
          throw new Error("Erro ao obter usuário");
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userData.user.email,
          password,
        });

        if (signInError) {
          throw new Error("Senha incorreta");
        }

        // Update email
        const { error: updateError } = await supabase.auth.updateUser({
          email: newEmail,
        });

        if (updateError) {
          throw updateError;
        }

        setSuccess(true);
        toast.success("Email alterado com sucesso! Verifique sua nova caixa de entrada para confirmar.");
        
        // Refresh auth state
        setTimeout(() => {
          navigate({ to: "/configuracao" });
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao alterar email");
      } finally {
        setIsLoading(false);
      }
    };

    if (success) {
      return (
        <div className="max-w-xl mx-auto space-y-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
            <Mail className="size-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Email alterado!</h1>
            <p className="text-muted-foreground mt-2">
              Um email de confirmação foi enviado para <strong>{newEmail}</strong>.
              Por favor, verifique sua caixa de entrada e clique no link de confirmação.
            </p>
          </div>
          <Button variant="outline" asChild onClick={() => navigate({ to: "/configuracao" })}>
            Voltar às configurações
          </Button>
        </div>
      );
    }

    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alterar email</h1>
          <p className="text-muted-foreground mt-1">
            Atualize seu endereço de email de acesso
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Novo email</CardTitle>
            <CardDescription>
              Você precisará confirmar o novo email através de um link que será enviado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email-atual">Email atual</Label>
                <Input
                  id="email-atual"
                  type="email"
                  value={currentEmail || ""}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="novo-email">Novo email</Label>
                <Input
                  id="novo-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="novo@email.com"
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha-confirmacao">Senha atual (para confirmar)</Label>
                <div className="relative">
                  <Input
                    id="senha-confirmacao"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha atual"
                    className="pr-10"
                    disabled={isLoading}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <svg className="size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><path d="M2 12l20 20"/></svg>
                    )}
                  </Button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Alterar email"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  },
});