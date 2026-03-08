/**
 * Stable Tenant IDs for system-level tenants.
 *
 * These are the ONLY tenants with fixed IDs because they are shared singletons:
 *   - PLATFORM_TENANT_ID: Used by Super Admins (the company running this platform)
 *   - CITIZEN_TENANT_ID:  Shared by all public passengers / citizen users
 *
 * All other tenants (operator companies, government bodies) are created dynamically
 * with randomized TENANT-<UUID> IDs at registration time.
 */

export const PLATFORM_TENANT_ID = 'TENANT-9f4e2b1a-3c7d-4a8e-b5f6-d2e1c0a9b8f7';
export const CITIZEN_TENANT_ID = 'TENANT-1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6';

export const PLATFORM_TENANT_NAME = 'Transit Platform';
export const CITIZEN_TENANT_NAME = 'General Passengers';
