import { Role } from '../../domains/identity/models/user.model';

/**
 * Application sections/modules
 */
export enum AppSection {
    OVERVIEW = 'overview',
    VEHICLES = 'vehicles',
    DRIVERS = 'drivers',
    ROUTES = 'routes',
    SCHEDULES = 'schedules',
    TRIPS = 'trips',
    BRANCHES = 'branches',
    ANALYTICS = 'analytics',
    FINANCE = 'finance',
    FUEL_LOGS = 'fuel_logs',
    FLEET_CONFIG = 'fleet_config',
    SETTINGS = 'settings',
    ORGANIZATION = 'organization',
    USERS = 'users',
}

/**
 * Permission actions
 */
export enum PermissionAction {
    READ = 'read',
    WRITE = 'write',
    DELETE = 'delete',
    MANAGE = 'manage', // Full CRUD
}

/**
 * Combined permission string (e.g., 'vehicles.read', 'drivers.write')
 */
export type Permission = `${AppSection}.${PermissionAction}` | '*';

/**
 * Role-based permission mappings
 * 
 * Defines what permissions each role has across the application
 */
export const RolePermissions: Record<Role, Permission[]> = {
    [Role.SUPER_ADMIN]: ['*'], // All permissions

    [Role.OPERATOR_ADMIN]: [
        // Full access to fleet management
        `${AppSection.OVERVIEW}.${PermissionAction.READ}`,
        `${AppSection.VEHICLES}.${PermissionAction.MANAGE}`,
        `${AppSection.DRIVERS}.${PermissionAction.MANAGE}`,
        `${AppSection.ROUTES}.${PermissionAction.MANAGE}`,
        `${AppSection.SCHEDULES}.${PermissionAction.MANAGE}`,
        `${AppSection.TRIPS}.${PermissionAction.MANAGE}`,
        `${AppSection.BRANCHES}.${PermissionAction.MANAGE}`,
        `${AppSection.FUEL_LOGS}.${PermissionAction.MANAGE}`,
        `${AppSection.FLEET_CONFIG}.${PermissionAction.MANAGE}`,

        // Read access to analytics and finance
        `${AppSection.ANALYTICS}.${PermissionAction.READ}`,
        `${AppSection.FINANCE}.${PermissionAction.READ}`,

        // Can manage organization settings
        `${AppSection.ORGANIZATION}.${PermissionAction.MANAGE}`,
        `${AppSection.SETTINGS}.${PermissionAction.MANAGE}`,

        // Can create and manage users (with restrictions)
        `${AppSection.USERS}.${PermissionAction.MANAGE}`,
    ],

    [Role.GOVERNMENT]: [
        // Read-only access to analytics and compliance
        `${AppSection.OVERVIEW}.${PermissionAction.READ}`,
        `${AppSection.ANALYTICS}.${PermissionAction.READ}`,
        `${AppSection.TRIPS}.${PermissionAction.READ}`,
        `${AppSection.ROUTES}.${PermissionAction.READ}`,
        `${AppSection.DRIVERS}.${PermissionAction.READ}`,
        `${AppSection.VEHICLES}.${PermissionAction.READ}`,

        // Own profile settings
        `${AppSection.SETTINGS}.${PermissionAction.READ}`,
    ],

    [Role.DRIVER]: [
        // Limited to assigned trips and schedules
        `${AppSection.TRIPS}.${PermissionAction.READ}`,
        `${AppSection.SCHEDULES}.${PermissionAction.READ}`,
        `${AppSection.FUEL_LOGS}.${PermissionAction.WRITE}`, // Can log fuel

        // Own profile settings
        `${AppSection.SETTINGS}.${PermissionAction.MANAGE}`,
    ],

    [Role.INSPECTOR]: [
        // Access to inspection and compliance features
        `${AppSection.TRIPS}.${PermissionAction.READ}`,
        `${AppSection.VEHICLES}.${PermissionAction.READ}`,
        `${AppSection.DRIVERS}.${PermissionAction.READ}`,
        `${AppSection.ROUTES}.${PermissionAction.READ}`,

        // Own profile settings
        `${AppSection.SETTINGS}.${PermissionAction.READ}`,
    ],

    [Role.PASSENGER]: [
        // Basic booking and profile access
        `${AppSection.TRIPS}.${PermissionAction.READ}`,
        `${AppSection.ROUTES}.${PermissionAction.READ}`,

        // Own profile settings
        `${AppSection.SETTINGS}.${PermissionAction.MANAGE}`,
    ],
};

/**
 * User creation rules - defines which roles can create which other roles
 */
export const UserCreationRules: Record<Role, Role[]> = {
    [Role.SUPER_ADMIN]: [
        Role.SUPER_ADMIN,
        Role.OPERATOR_ADMIN,
        Role.GOVERNMENT,
        Role.DRIVER,
        Role.INSPECTOR,
        Role.PASSENGER,
    ],

    [Role.OPERATOR_ADMIN]: [
        Role.DRIVER,
        Role.INSPECTOR,
        Role.PASSENGER,
    ],

    [Role.GOVERNMENT]: [], // Cannot create users
    [Role.DRIVER]: [], // Cannot create users
    [Role.INSPECTOR]: [], // Cannot create users
    [Role.PASSENGER]: [], // Cannot create users
};

/**
 * Helper function to check if user has a specific permission
 */
export function hasPermission(userPermissions: Permission[], requiredPermission: Permission): boolean {
    // Check for wildcard permission
    if (userPermissions.includes('*')) {
        return true;
    }

    // Check for exact permission match
    if (userPermissions.includes(requiredPermission)) {
        return true;
    }

    // Check for MANAGE permission when READ/WRITE/DELETE is required
    if (requiredPermission.includes('.')) {
        const [section, action] = requiredPermission.split('.');
        if (action !== PermissionAction.MANAGE) {
            const managePermission = `${section}.${PermissionAction.MANAGE}` as Permission;
            if (userPermissions.includes(managePermission)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Helper function to get all permissions for a role
 */
export function getRolePermissions(role: Role): Permission[] {
    return RolePermissions[role] || [];
}

/**
 * Check if a role can create another role
 */
export function canCreateRole(creatorRole: Role, targetRole: Role): boolean {
    const allowedRoles = UserCreationRules[creatorRole] || [];
    return allowedRoles.includes(targetRole);
}

/**
 * Get user-friendly permission descriptions
 */
export const PermissionDescriptions: Record<AppSection, string> = {
    [AppSection.OVERVIEW]: 'View dashboard overview and key metrics',
    [AppSection.VEHICLES]: 'Manage fleet vehicles',
    [AppSection.DRIVERS]: 'Manage drivers',
    [AppSection.ROUTES]: 'Manage routes and schedules',
    [AppSection.SCHEDULES]: 'View and manage trip schedules',
    [AppSection.TRIPS]: 'Manage trips and bookings',
    [AppSection.BRANCHES]: 'Manage branch locations',
    [AppSection.ANALYTICS]: 'View analytics and reports',
    [AppSection.FINANCE]: 'View financial data and transactions',
    [AppSection.FUEL_LOGS]: 'Manage fuel logs and expenses',
    [AppSection.FLEET_CONFIG]: 'Configure fleet settings',
    [AppSection.SETTINGS]: 'Manage account settings',
    [AppSection.ORGANIZATION]: 'Manage organization profile',
    [AppSection.USERS]: 'Manage users and permissions',
};
