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
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracao/senha")({
  component: () => {
    const { userId } = useAuth();
    const navigate = useNavigate();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (!currentPassword || !newPassword || !confirmPassword) {
        setError("Todos os campos são obrigatórios");
        return;
      }

      if (newPassword.length < 6) {
        setError("A nova senha deve ter pelo menos 6 caracteres");
        return;
      }

      if (newPassword !== confirmPassword) {
        setError("As senhas não coincidem");
        return;
      }

      if (currentPassword === newPassword) {
        setError("A nova senha deve ser diferente da atual");
        return;
      }

      setIsLoading(true);

      try {
        // First verify current password by signing in
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user?.email) {
          throw new Error("Erro ao obter usuário");
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userData.user.email,
          password: currentPassword,
        });

        if (signInError) {
          throw new Error("Senha atual incorreta");
        }

        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (updateError) {
          throw updateError;
        }

        toast.success("Senha alterada com sucesso!");
        navigate({ to: "/configuracao" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao alterar senha");
      } finally {
        setIsLoading(false);
      }
    };

    const PasswordInput = ({
      value,
      onChange,
      type,
      show,
      onToggleShow,
      label,
      placeholder,
      error: fieldError,
    }: {
      value: string;
      onChange: (v: string) => void;
      type: "password" | "text";
      show: boolean;
      onToggleShow: () => void;
      label: string;
      placeholder: string;
      error?: string;
    }) => (
      <div className="space-y-1.5">
        <Label htmlFor={label.toLowerCase().replace(" ", "-")}>{label}</Label>
        <div className="relative">
          <Input
            id={label.toLowerCase().replace(" ", "-")}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-10"
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
            onClick={onToggleShow}
            disabled={isLoading}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
      </div>
    );

    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alterar senha</h1>
          <p className="text-muted-foreground mt-1">
            Atualize sua senha de acesso à plataforma
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Nova senha</CardTitle>
            <CardDescription>
              Sua nova senha deve ser diferente da atual e ter pelo menos 6 caracteres.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <PasswordInput
                value={currentPassword}
                onChange={setCurrentPassword}
                type="password"
                show={showCurrent}
                onToggleShow={() => setShowCurrent(!showCurrent)}
                label="Senha atual"
                placeholder="Digite sua senha atual"
              />

              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                type="password"
                show={showNew}
                onToggleShow={() => setShowNew(!showNew)}
                label="Nova senha"
                placeholder="Digite a nova senha"
                fieldError={newPassword && newPassword.length < 6 ? "Mínimo 6 caracteres" : undefined}
              />

              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                type="password"
                show={showConfirm}
                onToggleShow={() => setShowConfirm(!showConfirm)}
                label="Confirmar nova senha"
                placeholder="Confirme a nova senha"
                fieldError={confirmPassword && newPassword !== confirmPassword ? "As senhas não coincidem" : undefined}
              />

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  },
});