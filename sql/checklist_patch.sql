-- sql/checklist_patch.sql
ALTER TABLE project_items ADD COLUMN IF NOT EXISTS checked BOOLEAN NOT NULL DEFAULT false;