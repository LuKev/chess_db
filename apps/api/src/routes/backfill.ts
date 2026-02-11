import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import type {
  OpeningBackfillQueue,
  PositionBackfillQueue,
} from "../infrastructure/queue.js";

export async function registerBackfillRoutes(
  app: FastifyInstance,
  positionBackfillQueue: PositionBackfillQueue,
  openingBackfillQueue: OpeningBackfillQueue
): Promise<void> {
  app.post(
    "/api/backfill/positions",
    { preHandler: requireUser },
    async (request, reply) => {
      try {
        await positionBackfillQueue.enqueuePositionBackfill({
          userId: request.user!.id,
        });
        return reply.status(202).send({
          status: "queued",
          queue: "position_backfill",
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to enqueue position backfill" });
      }
    }
  );

  app.post(
    "/api/backfill/openings",
    { preHandler: requireUser },
    async (request, reply) => {
      try {
        await openingBackfillQueue.enqueueOpeningBackfill({
          userId: request.user!.id,
        });
        return reply.status(202).send({
          status: "queued",
          queue: "opening_aggregate_backfill",
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to enqueue opening backfill" });
      }
    }
  );
}

