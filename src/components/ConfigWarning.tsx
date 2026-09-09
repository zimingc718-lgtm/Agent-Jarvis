type ConfigWarningProps = {
  title: string;
  missing: string[];
  hint?: string;
};

/** Shared "this environment variable is missing" block used by every config gate. */
export function ConfigWarning({ title, missing, hint }: ConfigWarningProps) {
  return (
    <div className="auth-config-warning" role="status">
      <strong>{title}</strong>
      {missing.length > 0 ? <code>{missing.join(", ")}</code> : null}
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}
