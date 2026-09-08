/**
 * The single place where the PostgreSQL version is pinned.
 *
 * Rule 11: tests run against real PostgreSQL at the same version as production. Test
 * containers, the migration verifier and the deployment target all read this constant,
 * so the version cannot drift between what is tested and what is shipped.
 */
export const POSTGRES_MAJOR_VERSION = 16;

export const POSTGRES_IMAGE = `postgres:${POSTGRES_MAJOR_VERSION}`;
