import { redirect } from 'next/navigation';

/**
 * Verification settings open on the connection to the data source until the settings of
 * screen 05 land in front of it (handoff phase 7).
 */
export default function VerificationSettingsPage(): never {
  redirect('/operator/verification/integration');
}
