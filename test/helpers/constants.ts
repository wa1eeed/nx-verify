/** Fixed credentials for the throwaway test container. Nothing here reaches any other environment. */
export const TEST_ROLE_PASSWORDS = {
  nx_migrator: 'test_migrator',
  nx_app: 'test_app',
  nx_retention: 'test_retention',
  nx_operator: 'test_operator',
} as const;

export const TEMPLATE_DATABASE = 'nx_template';
