import Link from 'next/link';
import type { TranslationTree } from '@gymflow/i18n';
import { Card } from './ui';

/**
 * What to do on day one.
 *
 * A freshly provisioned gym gets a branch, settings and an owner login — but
 * no membership plans. The dashboard was therefore a grid of zeroes, and the
 * obvious first move (New member, then Sell membership) walked into a plan
 * chooser with nothing in it and a validation error that did not say why.
 *
 * Disappears on its own once both steps are done, so an established gym
 * never sees it.
 */
export function SetupChecklist({
  tr,
  hasPlans,
  hasMembers,
}: {
  tr: TranslationTree;
  hasPlans: boolean;
  hasMembers: boolean;
}) {
  if (hasPlans && hasMembers) return null;

  const steps = [
    {
      done: hasPlans,
      href: '/plans',
      label: hasPlans ? tr.dashboard.setupPlansDone : tr.dashboard.setupPlans,
      hint: tr.dashboard.setupPlansHint,
      extra: null,
    },
    {
      done: hasMembers,
      href: '/members/new',
      label: hasMembers ? tr.dashboard.setupMembersDone : tr.dashboard.setupMembers,
      hint: tr.dashboard.setupMembersHint,
      extra: { href: '/members/import', label: tr.dashboard.setupImport },
    },
    {
      // No "done" state: settings always have values, and nothing here can
      // tell whether the owner has actually looked at them.
      done: false,
      href: '/settings',
      label: tr.dashboard.setupSettings,
      hint: tr.dashboard.setupSettingsHint,
      extra: null,
    },
  ];

  return (
    <Card className="mb-6 border-primary/30 bg-green-50">
      <h2 className="text-lg font-semibold text-slate-900">{tr.dashboard.setupTitle}</h2>
      <p className="mt-1 text-sm text-slate-700">{tr.dashboard.setupIntro}</p>
      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.href} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={
                step.done
                  ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white'
                  : 'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-slate-300'
              }
            >
              {step.done ? '✓' : ''}
            </span>
            <span className="min-w-0">
              {step.done ? (
                <span className="text-sm font-semibold text-slate-600">{step.label}</span>
              ) : (
                <Link href={step.href} className="text-sm font-semibold text-primary underline">
                  {step.label}
                </Link>
              )}
              <span className="block text-xs text-slate-600">{step.hint}</span>
              {step.extra && !step.done ? (
                <Link
                  href={step.extra.href}
                  className="mt-1 inline-block text-xs font-semibold text-primary underline"
                >
                  {step.extra.label}
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
