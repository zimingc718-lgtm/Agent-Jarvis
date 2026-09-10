import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ConfigWarningProps = {
  title: string;
  missing: string[];
  hint?: string;
};

/** Shared "this environment variable is missing" block used by every config gate. */
export function ConfigWarning({ title, missing, hint }: ConfigWarningProps) {
  return (
    <Alert className="auth-config-warning" role="status">
      <AlertTriangle aria-hidden="true" className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-1">
        {missing.length > 0 ? (
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {missing.join(", ")}
          </code>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
