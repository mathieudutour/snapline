-- Read-only sharing: member roles and an optional "anyone with the link can view" token.
ALTER TABLE project_members ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE projects ADD COLUMN view_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS projects_view_token ON projects(view_token);
