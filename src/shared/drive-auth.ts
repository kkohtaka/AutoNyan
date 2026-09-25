import { GoogleAuth, Impersonated } from 'google-auth-library';
import type { google } from 'googleapis';

/**
 * An authenticated client accepted by googleapis as its `auth` option.
 *
 * googleapis resolves its own nested copy of google-auth-library, and
 * TypeScript treats the two copies' OAuth2Client classes as unrelated because
 * of their private members. The client is the same shape at runtime, so it is
 * typed once here as the client googleapis expects, not cast at every call site.
 */
export type DriveAuth = InstanceType<typeof google.auth.OAuth2>;

const clients = new Map<string, DriveAuth>();

/**
 * Build Drive API credentials by impersonating the environment's Drive
 * identity, the one account the Drive folders are shared with. The function's
 * own runtime account holds no Drive access; it mints tokens for the identity
 * named by DRIVE_IDENTITY_EMAIL through the token-creator binding Terraform
 * declares in the function's module.
 *
 * Deliberately no fallback to the runtime account's own credentials: a missing
 * variable must fail here, not surface later as the silent empty listing Drive
 * returns for an unshared folder.
 *
 * Clients are kept for the life of the instance: minting an impersonated token
 * is a call to the IAM Credentials API, and the client refreshes its own token
 * before expiry, so one client per identity and scope set is enough.
 * @param scopes Drive API scopes to request for the impersonated token
 * @returns Credentials for the Drive identity
 */
export async function createDriveAuth(scopes: string[]): Promise<DriveAuth> {
  const targetPrincipal = process.env.DRIVE_IDENTITY_EMAIL;
  if (!targetPrincipal) {
    throw new Error(
      'Missing required environment variable: DRIVE_IDENTITY_EMAIL'
    );
  }

  const key = `${targetPrincipal} ${[...scopes].sort().join(' ')}`;
  const cached = clients.get(key);
  if (cached) {
    return cached;
  }

  const sourceClient = await new GoogleAuth().getClient();
  const impersonated = new Impersonated({
    sourceClient,
    targetPrincipal,
    targetScopes: scopes,
  });
  const client = impersonated as unknown as DriveAuth;
  clients.set(key, client);
  return client;
}
