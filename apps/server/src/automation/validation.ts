import { z } from "zod";
import {
  AUTOMATION_JOB_STATUS_FILTERS,
  AUTOMATION_JOB_TYPE_FILTERS,
  NOTIFICATION_STATUS_FILTERS,
  NOTIFICATION_TYPE_FILTERS,
} from "@subscript/shared";

export const automationJobListQuerySchema = z
  .object({
    status: z.enum(AUTOMATION_JOB_STATUS_FILTERS).default("ALL"),
    type: z.enum(AUTOMATION_JOB_TYPE_FILTERS).default("ALL"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const automationNotificationListQuerySchema = z
  .object({
    status: z.enum(NOTIFICATION_STATUS_FILTERS).default("ALL"),
    type: z.enum(NOTIFICATION_TYPE_FILTERS).default("ALL"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const automationJobParamsSchema = z.object({
  jobId: z.string().uuid("Choose a valid automation job."),
});

export const automationNotificationParamsSchema = z.object({
  notificationId: z.string().uuid("Choose a valid notification."),
});
