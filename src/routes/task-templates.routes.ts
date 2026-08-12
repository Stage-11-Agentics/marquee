import { z } from "@hono/zod-openapi";

import type { TaskTemplateRow } from "../db/schema";
import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { normalizeTaskFileConfig, readTaskFileConfig, TaskFileConfigError, type TaskFileConfig } from "../lib/task-template-config";

const eventParams = z.object({ eventId: z.string().min(1) });
const templateParams = eventParams.extend({ templateId: z.string().min(1) });
const fileConfigSchema = z.object({
  accept: z.array(z.string()),
  maxBytes: z.number().int().positive(),
});
const fileConfigResponseSchema = z.object({
  accept: z.array(z.string()).min(1),
  maxBytes: z.number().int().positive(),
});
const taskTemplateSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  kind: z.enum(["acknowledge", "file", "form"]),
  description: z.string(),
  position: z.number().int().nonnegative(),
  file_config: fileConfigResponseSchema.nullable(),
  updated_at: z.number(),
});
const taskTemplatesResponse = z.object({ data: z.array(taskTemplateSchema) });
const taskTemplateResponse = jsonResponse(z.object({ data: taskTemplateSchema }), "Updated task template");
const fileConfigBody = z.object({ file_config: fileConfigSchema.nullable() });

type TaskTemplateView = Pick<TaskTemplateRow, "id" | "event_id" | "name" | "kind" | "description" | "position" | "updated_at"> & {
  file_config: TaskFileConfig | null;
};

async function eventExists(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
  if (!event) throw ApiError.notFound("conference not found");
}

function templateView(row: Pick<TaskTemplateRow, "id" | "event_id" | "name" | "kind" | "description" | "position" | "file_config" | "updated_at">): TaskTemplateView {
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    position: row.position,
    file_config: readTaskFileConfig(row.file_config),
    updated_at: row.updated_at,
  };
}

function normalizeForWrite(value: unknown): TaskFileConfig {
  try {
    return normalizeTaskFileConfig(value);
  } catch (error) {
    if (error instanceof TaskFileConfigError) throw ApiError.unprocessable(error.message, error.field);
    throw error;
  }
}

async function templateFor(db: D1Database, eventId: string, templateId: string): Promise<TaskTemplateRow> {
  const template = await db.prepare(
    `SELECT id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at
     FROM task_templates WHERE id = ? AND event_id = ?`,
  ).bind(templateId, eventId).first<TaskTemplateRow>();
  if (!template) throw ApiError.notFound("task template not found");
  return template;
}

const listTaskTemplates = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/task-templates",
    operationId: "listTaskTemplates",
    summary: "List conference task templates",
    tags: ["Task templates"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(taskTemplatesResponse, "Conference task templates"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventExists(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      `SELECT id, event_id, name, kind, description, position, file_config, updated_at
       FROM task_templates WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<Pick<TaskTemplateRow, "id" | "event_id" | "name" | "kind" | "description" | "position" | "file_config" | "updated_at">>();
    return context.json({ data: rows.results.map(templateView) }, 200);
  },
);

const updateTaskTemplate = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/task-templates/{templateId}",
    operationId: "updateTaskTemplate",
    summary: "Update a file task template's upload policy",
    tags: ["Task templates"],
    request: { params: templateParams, body: { content: { "application/json": { schema: fileConfigBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: taskTemplateResponse, ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, templateId } = context.req.valid("param");
    const template = await templateFor(context.env.DB, eventId, templateId);
    if (template.kind !== "file") throw ApiError.unprocessable("only file task templates have upload settings", "file_config");
    const body = context.req.valid("json");
    const config = body.file_config === null ? null : normalizeForWrite(body.file_config);
    const now = Date.now();
    await context.env.DB.prepare(
      "UPDATE task_templates SET file_config = ?, updated_at = ? WHERE id = ? AND event_id = ?",
    ).bind(config === null ? null : JSON.stringify(config), now, templateId, eventId).run();
    const updated = await templateFor(context.env.DB, eventId, templateId);
    return context.json({ data: templateView(updated) }, 200);
  },
);

export const apiRoutes = [listTaskTemplates, updateTaskTemplate];
