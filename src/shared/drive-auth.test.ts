import { createDriveAuth } from './index';

const mockGetClient = jest.fn();

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn(() => ({ getClient: mockGetClient })),
  Impersonated: jest.fn((options: Record<string, unknown>) => ({
    impersonated: true,
    ...options,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const { GoogleAuth, Impersonated } = require('google-auth-library');

describe('createDriveAuth', () => {
  const scopes = ['https://www.googleapis.com/auth/drive.readonly'];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DRIVE_IDENTITY_EMAIL;
  });

  afterAll(() => {
    delete process.env.DRIVE_IDENTITY_EMAIL;
  });

  it('impersonates the identity named by DRIVE_IDENTITY_EMAIL', async () => {
    process.env.DRIVE_IDENTITY_EMAIL =
      'staging-drive-writer-sa@test-project.iam.gserviceaccount.com';
    const sourceClient = { source: true };
    mockGetClient.mockResolvedValue(sourceClient);

    const auth = await createDriveAuth(scopes);

    expect(GoogleAuth).toHaveBeenCalledTimes(1);
    expect(Impersonated).toHaveBeenCalledWith({
      sourceClient,
      targetPrincipal:
        'staging-drive-writer-sa@test-project.iam.gserviceaccount.com',
      targetScopes: scopes,
    });
    expect(auth).toEqual(expect.objectContaining({ impersonated: true }));
  });

  it('reuses one client per identity and scope set', async () => {
    process.env.DRIVE_IDENTITY_EMAIL =
      'staging-drive-organizer-sa@test-project.iam.gserviceaccount.com';
    mockGetClient.mockResolvedValue({ source: true });
    const fullScopes = ['https://www.googleapis.com/auth/drive'];

    const first = await createDriveAuth(fullScopes);
    const second = await createDriveAuth(fullScopes);

    expect(second).toBe(first);
    expect(Impersonated).toHaveBeenCalledTimes(1);
  });

  it('fails before touching credentials when DRIVE_IDENTITY_EMAIL is unset', async () => {
    await expect(createDriveAuth(scopes)).rejects.toThrow(
      'Missing required environment variable: DRIVE_IDENTITY_EMAIL'
    );

    expect(GoogleAuth).not.toHaveBeenCalled();
    expect(Impersonated).not.toHaveBeenCalled();
  });
});
