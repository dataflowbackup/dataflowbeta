import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface PageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, backHref, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {backHref && (
          <Link href={backHref}>
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-description">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
