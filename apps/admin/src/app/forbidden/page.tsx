import { Button } from '@/components/ui';

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold text-slate-900">No permission</h1>
      <p className="max-w-sm text-sm text-slate-500">
        Your account does not have access to this page. Ask the gym owner to grant the required
        permission if you need it.
      </p>
      <Button href="/" variant="secondary" type="button">
        Go to dashboard
      </Button>
    </main>
  );
}
