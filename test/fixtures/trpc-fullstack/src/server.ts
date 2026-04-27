import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

const app = express();

app.use(
  "/trpc",
  createExpressMiddleware({
    // Minimal shape for detection fixture only.
    router: {} as never,
    createContext: () => ({}),
  }),
);

app.listen(3001);
