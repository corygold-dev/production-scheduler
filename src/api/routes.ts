import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { inputSchema } from "../types/schemas";
import { schedule } from "../core/scheduler";
import { ZodError } from "zod";

export default async function routes(fastify: FastifyInstance) {
  fastify.post(
    "/schedule",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const input = inputSchema.parse(request.body);
        const result = schedule(input);
        return reply.send(result);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({
            version: "1.0.0",
            success: false,
            error: "Invalid input",
            why: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
          });
        }

        fastify.log.error(error);
        return reply.status(500).send({
          version: "1.0.0",
          success: false,
          error: "Internal server error",
          why: ["An unexpected error occurred"],
        });
      }
    }
  );

  fastify.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok", version: "1.0.0" });
  });
}
