-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin','staff')) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EQUIPMENT
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  total_quantity INTEGER NOT NULL CHECK (total_quantity >= 0),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  client_name TEXT NOT NULL,
  venue TEXT,
  person_in_charge TEXT,
  status TEXT CHECK (status IN ('draft','confirmed','cancelled')) NOT NULL DEFAULT 'draft',
  shipping_type TEXT CHECK (shipping_type IN ('near','far','carry')),
  shipping_date TIMESTAMPTZ,
  usage_start TIMESTAMPTZ NOT NULL,
  usage_end TIMESTAMPTZ,
  arrival_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROJECT ITEMS (在庫ロック対象)
CREATE TABLE IF NOT EXISTS project_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, equipment_id)
);

-- CHECKLIST TEMPLATES
CREATE TABLE IF NOT EXISTS checklist_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TEMPLATE ITEMS
CREATE TABLE IF NOT EXISTS checklist_template_items (
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE RESTRICT,
  default_quantity INTEGER NOT NULL CHECK (default_quantity > 0),
  PRIMARY KEY (template_id, equipment_id)
);

-- インデックス（高速化）
CREATE INDEX IF NOT EXISTS idx_project_items_project ON project_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_items_equipment ON project_items(equipment_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_usage_start ON projects(usage_start);
