/** Códigos de recuperação (aparecem uma vez só): lista para copiar ou anotar. */
export function RecoveryCodesList({ codes }: { codes: string[] }) {
  return (
    <ul
      data-testid="recovery-codes"
      className="grid grid-cols-2 gap-1 rounded-md border bg-background p-2 font-mono text-sm"
    >
      {codes.map((c) => (
        <li key={c} className="text-center">
          {c}
        </li>
      ))}
    </ul>
  );
}
