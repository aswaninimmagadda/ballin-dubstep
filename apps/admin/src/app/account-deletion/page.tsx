import type { Metadata } from 'next';
import { PRODUCT } from '@gymflow/config';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your GymFlow member account and what happens to your data.',
};

/**
 * Public, no-login page. Google Play requires a web URL where users can find
 * out how to delete their account without installing the app; Apple expects
 * the same information to be discoverable. Linked from both store listings.
 */
export default function AccountDeletionPage() {
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
      <p className="mt-2 text-sm">
        Ask your gym’s reception to delete your app account, or contact them using the phone number
        on your receipt. They can do it for you at the desk.
      </p>

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
