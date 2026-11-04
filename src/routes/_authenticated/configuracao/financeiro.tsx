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
import { Loader2, Lock, Unlock, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracao/financeiro")({
  component: () => {
    const { userId, profile } = useAuth();
    const navigate = useNavigate();
    const [currentFinancePassword, setCurrentFinancePassword] = useState("");
    const [newFinancePassword, setNewFinancePassword] = useState("");
    const [confirmFinancePassword, setConfirmFinancePassword] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [hasFinancePassword, setHasFinancePassword] = useState(false);
    const [isChecking, setIsChecking] = useState(true);

    // Check if user already has a financial password
    const checkFinancePassword = async () => {
      if (!userId) return;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("finance_password_hash")
          .eq("id", userId)
          .maybeSingle();
        
        if (error) throw error;
        setHasFinancePassword(!!data?.finance_password_hash);
      } catch {
        // If column doesn't exist yet, treat as no password
        setHasFinancePassword(false);
      } finally {
        setIsChecking(false);
      }
    };

    // Run check on mount
    if (typeof window !== "undefined") {
      checkFinancePassword();
    }

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (hasFinancePassword && !currentFinancePassword) {
        setError("Digite a senha financeira atual");
        return;
      }

      if (!newFinancePassword || !confirmFinancePassword) {
        setError("Todos os campos são obrigatórios");
        return;
      }

      if (newFinancePassword.length < 4) {
        setError("A senha financeira deve ter pelo menos 4 dígitos");
        return;
      }

      if (!/^\d+$/.test(newFinancePassword)) {
        setError("A senha financeira deve conter apenas números");
        return;
      }

      if (newFinancePassword !== confirmFinancePassword) {
        setError("As senhas não coincidem");
        return;
      }

      if (hasFinancePassword && currentFinancePassword === newFinancePassword) {
        setError("A nova senha deve ser diferente da atual");
        return;
      }

      setIsLoading(true);

      try {
        // Hash the new password (in production, use proper hashing like bcrypt)
        // For now, we'll store a simple hash - in production this should be done server-side
        const encoder = new TextEncoder();
        const data = encoder.encode(newFinancePassword + "neia-salt-" + userId);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const passwordHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

        if (hasFinancePassword) {
          // Verify current password
          const encoder2 = new TextEncoder();
          const data2 = encoder2.encode(currentFinancePassword + "neia-salt-" + userId);
          const hashBuffer2 = await crypto.subtle.digest("SHA-256", data2);
          const hashArray2 = Array.from(new Uint8Array(hashBuffer2));
          const currentHash = hashArray2.map(b => b.toString(16).padStart(2, "0")).join("");

          const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("finance_password_hash")
            .eq("id", userId)
            .maybeSingle();

          if (profileError) throw profileError;
          if (profileData?.finance_password_hash !== currentHash) {
            throw new Error("Senha financeira atual incorreta");
          }
        }

        // Update financial password
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ finance_password_hash: passwordHash })
          .eq("id", userId);

        if (updateError) {
          // Check if column exists
          if (updateError.message.includes("finance_password_hash")) {
            throw new Error("A coluna para senha financeira não existe. Execute a migration primeiro.");
          }
          throw updateError;
        }

        toast.success(hasFinancePassword ? "Senha financeira alterada com sucesso!" : "Senha financeira configurada com sucesso!");
        navigate({ to: "/configuracao" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao configurar senha financeira");
      } finally {
        setIsLoading(false);
      }
    };

    const PasswordInput = ({
      value,
      onChange,
      show,
      onToggleShow,
      label,
      placeholder,
      required = true,
      disabled = false,
      fieldError,
    }: {
      value: string;
      onChange: (v: string) => void;
      show: boolean;
      onToggleShow: () => void;
      label: string;
      placeholder: string;
      required?: boolean;
      disabled?: boolean;
      fieldError?: string;
    }) => (
      <div className="space-y-1.5">
        <Label htmlFor={label.toLowerCase().replace(" ", "-")}>
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        <div className="relative">
          <Input
            id={label.toLowerCase().replace(" ", "-")}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-10"
            disabled={disabled}
            required={required}
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
            onClick={onToggleShow}
            disabled={disabled}
          >
            {show ? (
              <svg className="size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg className="size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><path d="M2 12l20 20"/></svg>
            )}
          </Button>
        </div>
        {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
      </div>
    );

    if (isChecking) {
      return (
        <div className="max-w-xl mx-auto space-y-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="size-5" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Senha do financeiro</h1>
              <p className="text-muted-foreground mt-1">
                {hasFinancePassword ? "Altere sua senha numérica de acesso ao módulo financeiro" : "Configure uma senha numérica para acessar o módulo financeiro"}
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="size-5 text-primary" />
              <CardTitle>{hasFinancePassword ? "Alterar senha financeira" : "Criar senha financeira"}</CardTitle>
            </div>
            <CardDescription>
              {hasFinancePassword 
                ? "A senha financeira é um código numérico de 4+ dígitos usado para acessar o módulo financeiro." 
                : "Configure uma senha numérica (mínimo 4 dígitos) para proteger o acesso ao módulo financeiro."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {hasFinancePassword && (
                <PasswordInput
                  value={currentFinancePassword}
                  onChange={setCurrentFinancePassword}
                  show={showCurrent}
                  onToggleShow={() => setShowCurrent(!showCurrent)}
                  label="Senha financeira atual"
                  placeholder="Digite a senha atual"
                  fieldError={hasFinancePassword && currentFinancePassword && currentFinancePassword.length < 4 ? "Mínimo 4 dígitos" : undefined}
                />
              )}

              <PasswordInput
                value={newFinancePassword}
                onChange={setNewFinancePassword}
                show={showNew}
                onToggleShow={() => setShowNew(!showNew)}
                label={hasFinancePassword ? "Nova senha financeira" : "Senha financeira"}
                placeholder="Digite a nova senha (apenas números)"
                fieldError={newFinancePassword && (newFinancePassword.length < 4 || !/^\d+$/.test(newFinancePassword)) ? "Mínimo 4 dígitos numéricos" : undefined}
              />

              <PasswordInput
                value={confirmFinancePassword}
                onChange={setConfirmFinancePassword}
                show={showConfirm}
                onToggleShow={() => setShowConfirm(!showConfirm)}
                label="Confirmar senha financeira"
                placeholder="Confirme a senha"
                fieldError={confirmFinancePassword && newFinancePassword !== confirmFinancePassword ? "As senhas não coincidem" : undefined}
              />

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">Importante:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Use apenas números (0-9)</li>
                      <li>Mínimo 4 dígitos</li>
                      <li>Não compartilhe esta senha</li>
                      <li>Esta senha dá acesso a dados financeiros sensíveis</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : hasFinancePassword ? (
                  "Alterar senha financeira"
                ) : (
                  <>
                    <Lock className="mr-2 size-4" />
                    Criar senha financeira
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card variant="outline">
          <CardContent className="pt-6">
            <Button variant="outline" asChild>
              <Unlock className="mr-2 size-4" />
              <Link to="/configuracao">Voltar às configurações</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  },
});