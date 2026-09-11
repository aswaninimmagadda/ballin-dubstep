import 'server-only';
import { notFound } from 'next/navigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id a server action was submitted with, proven to be a UUID.
 *
 * Actions take the member id from a hidden field and then build two things
 * out of it: the URL they redirect back to on a validation error, and the
 * `path` of the draft cookie that carries what was typed. Both were built by
 * string concatenation from whatever the field contained, and a hidden field
 * is a client-supplied value like any other — a hand-rolled POST can put
 * anything in it.
 *
 * A semicolon was enough to inject an attribute into the Set-Cookie header:
 *
 *   memberId = "<uuid>; Domain=example.test"
 *   Set-Cookie: gymflow_draft_payment=…; Path=/members/<uuid>; Domain=example.test/payment; …
 *
 * Widening Domain to a registrable parent would send a cookie holding the
 * member details somebody just typed to every host under it. A CR/LF instead
 * answered 500, and `../..` produced a redirect the browser resolved
 * somewhere else on the site.
 *
 * The id is always a UUID when the form came from this app, so anything else
 * is a forgery or a bug, and neither deserves a page.
 */
export function submittedId(formData: FormData, field = 'memberId'): string {
  const value = String(formData.get(field) ?? '');
  if (!UUID_RE.test(value)) notFound();
  return value;
}
