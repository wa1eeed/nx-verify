import { buildApp } from './app.js';
import { buildContext } from './context.js';

/** Entry point. The context is assembled once and shared by every request. */
async function main(): Promise<void> {
  const context = buildContext();
  const app = await buildApp({ context, logger: true });
  const port = Number(process.env['PORT'] ?? 3000);

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
