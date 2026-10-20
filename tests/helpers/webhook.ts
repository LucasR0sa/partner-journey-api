import type { Express } from "express";
import request from "supertest";
import { sign } from "../../src/shared/security/hmac.js";

// Envia um webhook assinado do jeito que o provedor real faria.
export function postSigned(app: Express, path: string, body: unknown, secret = process.env.WEBHOOK_SECRET!) {
  const raw = JSON.stringify(body);
  return request(app).post(path).set("content-type", "application/json").set("x-signature", `sha256=${sign(raw, secret)}`).send(raw);
}
