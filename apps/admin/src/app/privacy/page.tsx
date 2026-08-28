import type { Metadata } from 'next';
import { PRODUCT } from '@gymflow/config';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What the GymFlow member app collects, why, and how to have it deleted.',
};

/**
 * The member app's own privacy policy, on a public no-login URL.
 *
 * Google Play and the App Store both require a working privacy-policy URL for
 * the app itself. docs/PRIVACY.md is a different document with a different
 * author: it is a template for the GYM to publish as data controller, written
 * in the gym's voice and carrying "[Gym name]" placeholders. Handing a store
 * reviewer a markdown file with unfilled placeholders is a rejection, so the
 * app ships its own policy here.
 *
 * Deliberately factual and short: everything below is checkable against the
 * code, and nothing is claimed that the product does not do.
 */
export default function PrivacyPage() {
  const support = process.env.SUPPORT_EMAIL?.trim();
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-slate-800">
      <h1 className="text-2xl font-bold text-slate-900">{PRODUCT.name} privacy policy</h1>
      <p className="mt-2 text-sm text-slate-500">Applies to the {PRODUCT.name} member app.</p>

      <h2 className="mt-8 text-lg font-semibold">Who holds your data</h2>
      <p className="mt-2 text-sm">
        Your gym is the controller of your membership record: they collected it when you joined and
        they decide how long to keep it. {PRODUCT.name} is the software the gym uses, and processes
        that data on their instructions. Your gym’s own privacy notice governs how they use it.
      </p>

      <h2 className="mt-8 text-lg font-semibold">What the app collects</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        <li>
          <strong>Your name and mobile number</strong> — to identify your account. You do not create
          the account; your gym does, at the desk.
        </li>
        <li>
          <strong>Your membership, payments and receipts</strong> — so you can see what you have
          paid and when your membership ends.
        </li>
        <li>
          <strong>Your gym visits</strong> — the date and time of each check-in, shown to you in the
          app and to your gym at the desk.
        </li>
        <li>
          <strong>Your personal-training sessions</strong> — sessions booked, used and remaining,
          where your gym sells training packages.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">What the app does not do</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        <li>No advertising, no advertising SDKs and no tracking across other apps or websites.</li>
        <li>
          No location collection. The entry pass is a code on your screen, not a location check.
        </li>
        <li>No access to your contacts, photos, camera, microphone or files.</li>
        <li>Your data is never sold, and is never shared with another gym.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">How it is protected</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        <li>All traffic between the app and the gym’s system is encrypted in transit (HTTPS).</li>
        <li>
          Passwords are stored only as a scrypt hash — nobody at your gym or at {PRODUCT.name} can
          read your password.
        </li>
        <li>
          Each gym’s data is isolated in the database itself, so one gym cannot see another gym’s
          members even if the application had a bug.
        </li>
        <li>Tokens on your phone are held in the device’s secure storage.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Deleting your account</h2>
      <p className="mt-2 text-sm">
        In the app: <strong>Overview → Delete my account</strong>. That removes your login,
        password, sessions and entry pass immediately, and files a data-deletion request with your
        gym. Your gym keeps membership, payment and receipt records, because the law requires
        businesses to retain financial records for a statutory period. Full details, including how
        to do it without the app, are at{' '}
        <a className="font-semibold text-green-700 underline" href="/account-deletion">
          /account-deletion
        </a>
        .
      </p>

      <h2 className="mt-8 text-lg font-semibold">Your rights</h2>
      <p className="mt-2 text-sm">
        You can ask your gym for a copy of what they hold about you, ask them to correct it, or ask
        them to erase what they are not legally required to keep. Ask at the desk — they can act on
        all three from their own screen.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <p className="mt-2 text-sm">
        For anything about your membership, contact your gym.
        {support ? (
          <>
            {' '}
            For questions about the app itself, email{' '}
            <a className="font-semibold text-green-700 underline" href={`mailto:${support}`}>
              {support}
            </a>
            .
          </>
        ) : null}
      </p>

      <p className="mt-8 text-xs text-slate-500">
        If this policy changes, the updated version appears at this address.
      </p>
    </main>
  );
}
