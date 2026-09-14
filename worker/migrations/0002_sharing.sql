-- Project sharing: optimistic versioning on projects and a members table.
ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, email)
);
CREATE INDEX IF NOT EXISTS project_members_email ON project_members(email);
