import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import chatRoute from "./routes/chat";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("/api/*", cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

// Routes
app.get("/health", (c) => c.json({ status: "ok", service: "bing-backend" }));
app.route("/api/chat", chatRoute);

const port = Number(process.env.PORT) || 3001;
console.log(`🚀 Dedicated Backend listening on port ${port}`);

serve({ fetch: app.fetch, port });
