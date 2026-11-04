import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { Key, Mail, Lock, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/configuracao")({
  component: () => {
    const configItems = [
      {
        label: "Alterar senha",
        description: "Altere sua senha de acesso à plataforma",
        icon: Key,
        href: "/configuracao/senha",
      },
      {
        label: "Alterar email",
        description: "Atualize seu endereço de email",
        icon: Mail,
        href: "/configuracao/email",
      },
      {
        label: "Senha do financeiro",
        description: "Configure a senha de acesso ao módulo financeiro",
        icon: Lock,
        href: "/configuracao/financeiro",
      },
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Configuração</h1>
            <p className="text-muted-foreground mt-1">
              Gerencie suas configurações de conta e acesso
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {configItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="group block"
            >
              <Card className="transition-all hover:shadow-md hover:border-primary/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                      <item.icon className="size-5" />
                    </div>
                    <CardTitle className="text-lg">{item.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Separator />

        <div className="flex items-center gap-4">
          <Button variant="outline" asChild>
            <Link to="/painel">
              <LayoutDashboard className="mr-2 size-4" />
              Voltar ao painel
            </Link>
          </Button>
        </div>
      </div>
    );
  },
});