import Fastify from "fastify";
import routes from "./routes";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  app.register(routes);

  return app;
}

export async function startServer(port: number = 3000) {
  const app = buildApp();

  try {
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Server listening on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}
