export type Status = { kind: 'ok' | 'error'; text: string } | null;

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p class={`status status--${status.kind}`} role="status">
      {status.text}
    </p>
  );
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
