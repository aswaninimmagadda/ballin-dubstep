import type { Metadata } from 'next';
import { PRODUCT } from '@gymflow/config';
import { asAnonymous } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your GymFlow member account and what happens to your data.',
};

/**
 * Public, no-login page. Google Play requires a web URL where users can find
 * out how to delete their account without installing the app; Apple expects
 * the same information to be discoverable. Linked from both store listings.
 */
interface GymContact {
  gym_name: string;
  support_phone: string | null;
  support_whatsapp: string | null;
}

/**
 * Look up a gym's public support contact. Reachable without a login, so it
 * goes through one narrow SECURITY DEFINER function that returns only the
 * business contact details the gym already prints on its receipts.
 */
async function lookupGym(slug: string | undefined): Promise<GymContact | null> {
  const code = (slug ?? '').trim();
  if (!code || !/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/i.test(code)) return null;
  try {
    return await asAnonymous(async (tx) => {
      const r = await tx.query(`SELECT * FROM app.public_gym_contact($1)`, [code]);
      return ((r as { rows: GymContact[] }).rows[0] as GymContact | undefined) ?? null;
    });
  } catch {
    // A public page must render even when the database is unreachable —
    // the store reviewer is not interested in our uptime.
    return null;
  }
}

export const dynamic = 'force-dynamic';

export default async function AccountDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ gym?: string }>;
}) {
  const { gym: gymCode } = await searchParams;
  const gym = await lookupGym(gymCode);
  const supportEmail = process.env.SUPPORT_EMAIL?.trim();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-slate-800">
      <h1 className="text-2xl font-bold text-slate-900">Delete your {PRODUCT.name} account</h1>

      <h2 className="mt-8 text-lg font-semibold">From the app</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>Open the member app and sign in.</li>
        <li>
          Go to <strong>Overview</strong> (the last tab).
        </li>
        <li>
          Tap <strong>Delete my account</strong> and confirm.
        </li>
      </ol>
      <p className="mt-2 text-sm">
        Your login is removed immediately and you are signed out on every device.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Without the app</h2>
      {gym ? (
        <div className="mt-2 text-sm">
          <p>
            Ask <strong>{gym.gym_name}</strong> to delete your app account. They can do it at the
            desk while you wait.
          </p>
          <ul className="mt-3 space-y-2">
            {gym.support_phone ? (
              <li>
                Call{' '}
                <a
                  className="font-semibold text-green-700 underline"
                  href={`tel:${gym.support_phone}`}
                >
                  {gym.support_phone}
                </a>
              </li>
            ) : null}
            {gym.support_whatsapp ? (
              <li>
                <a
                  className="font-semibold text-green-700 underline"
                  href={`https://wa.me/${gym.support_whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    'Please delete my gym app account.',
                  )}`}
                >
                  Message them on WhatsApp
                </a>
              </li>
            ) : null}
            {!gym.support_phone && !gym.support_whatsapp ? (
              <li>Use the phone number on your receipt or membership card.</li>
            ) : null}
          </ul>
        </div>
      ) : (
        <div className="mt-2 text-sm">
          <p>
            Enter your gym code — it is the code you use to sign in, and it is printed on your
            receipt — and we will show you how to reach them.
          </p>
          <form method="get" className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="gym">
              Gym code
            </label>
            <input
              id="gym"
              name="gym"
              required
              placeholder="e.g. apfitness"
              defaultValue={gymCode ?? ''}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button className="min-h-[44px] rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">
              Show contact
            </button>
          </form>
          {gymCode ? (
            <p role="alert" className="mt-2 text-sm text-amber-700">
              We could not find a gym with the code “{gymCode}”. Check the code on your receipt.
            </p>
          ) : null}
          {supportEmail ? (
            <p className="mt-3">
              Still stuck? Email{' '}
              <a className="font-semibold text-green-700 underline" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>{' '}
              and we will pass your request to your gym.
            </p>
          ) : null}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">What is deleted, and what is kept</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        <li>
          <strong>Deleted straight away:</strong> your app login and password, your active sessions,
          and your digital entry pass.
        </li>
        <li>
          <strong>Erased by your gym on request:</strong> contact details and other personal
          information they no longer need. Your request is recorded for them automatically.
        </li>
        <li>
          <strong>Kept:</strong> membership, payment and receipt records. Gyms are required to
          retain financial records for a statutory period, so these cannot be erased on request —
          they are kept by your gym, which is the controller of that data.
        </li>
      </ul>

      <p className="mt-8 text-xs text-slate-500">
        Your gym decides its own retention periods within the law. For the full policy, ask your gym
        for their privacy notice.
      </p>
    </main>
  );
}
