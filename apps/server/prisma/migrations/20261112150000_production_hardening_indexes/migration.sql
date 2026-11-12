-- Recovery sweeps scan for stale RUNNING and QUEUED rows by status and time.
-- These indexes keep stale-worker and queue-recovery scans bounded as tables grow.
CREATE INDEX "automation_jobs_status_lockedAt_idx" ON "automation_jobs"("status", "lockedAt");
CREATE INDEX "automation_jobs_status_updatedAt_idx" ON "automation_jobs"("status", "updatedAt");
CREATE INDEX "notifications_status_updatedAt_idx" ON "notifications"("status", "updatedAt");
