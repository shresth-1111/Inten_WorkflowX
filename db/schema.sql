-- ============================================================
-- Database Schema for Teslonic WorkflowX
-- Select the target database in your MySQL client before importing this file.
-- ============================================================

-- ------------------------------------------------------------
-- Table: users
-- Stores registered user accounts with authentication details
-- and a role assignment (developer or admin).
-- ------------------------------------------------------------
CREATE TABLE users (
    id       INT          AUTO_INCREMENT PRIMARY KEY,
    email    VARCHAR(255) UNIQUE NOT NULL,       -- unique login identifier
    password VARCHAR(255) NOT NULL,              -- hashed password string
    role     ENUM('developer', 'admin') DEFAULT 'developer' -- access level
);

-- ------------------------------------------------------------
-- Table: projects
-- Represents top-level project entities created by users.
-- Each project has a human-readable name, optional description,
-- and a reference to the creator's email.
-- ------------------------------------------------------------
CREATE TABLE projects (
    id          INT          AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,            -- project display name
    description TEXT,                             -- optional project summary
    creator     VARCHAR(255) NOT NULL             -- email of the user who created the project
);

-- ------------------------------------------------------------
-- Table: project_members
-- Junction / association table linking users to projects.
-- Enables many-to-many membership; cascades on project deletion.
-- ------------------------------------------------------------
CREATE TABLE project_members (
    project_id INT,
    user_email VARCHAR(255),
    PRIMARY KEY (project_id, user_email),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- Table: tasks
-- Individual work items belonging to a project.
-- Tracks title, description, priority label, workflow status,
-- and the last user who modified the task.
-- ------------------------------------------------------------
CREATE TABLE tasks (
    id               INT          AUTO_INCREMENT PRIMARY KEY,
    project_id       INT,
    title            VARCHAR(255) NOT NULL,                          -- short task heading
    description      TEXT,                                           -- detailed task body
    priority         VARCHAR(50),                                    -- e.g. low, medium, high
    status           ENUM('todo', 'progress', 'done') DEFAULT 'todo', -- kanban column
    last_modified_by VARCHAR(255),                                   -- email of last editor
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
