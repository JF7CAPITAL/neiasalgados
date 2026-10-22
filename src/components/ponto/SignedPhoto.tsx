import { useQuery } from "@tanstack/react-query";
import { ImageOff, Loader2 } from "lucide-react";
import { getSignedPontoFotoUrl } from "@/lib/ponto-db";
import { cn } from "@/lib/utils";

export function SignedPhoto({
  path,
  alt,
  className,
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const {
    data: url,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["ponto-foto", path],
    queryFn: () => (path ? getSignedPontoFotoUrl(path) : null),
    enabled: Boolean(path),
    staleTime: 45 * 60 * 1000,
  });

  if (!path || isError || (!isLoading && !url)) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  if (isLoading || !url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded bg-muted text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <img src={url} alt={alt} className={cn("rounded object-cover", className)} loading="lazy" />
  );
}
