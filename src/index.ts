import { Container, getContainer } from "@cloudflare/containers";

/** Runs the existing Dockerfile (FastAPI + built React app) on port 8000. */
export class ImpactTracker extends Container {
  defaultPort = 8000;
  sleepAfter = "30m"; // stop after 30 idle minutes; next request cold-starts and reseeds
}

interface Env {
  IMPACT_TRACKER: DurableObjectNamespace<ImpactTracker>;
}

export default {
  // One shared instance so every visitor sees the same SQLite database.
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.IMPACT_TRACKER).fetch(request);
  },
};
