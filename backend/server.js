// ============================================================
//  WorkFlowX — Backend API Server
//  Express.js + mysql2 connection pool
// ============================================================

const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { databaseConfig } = require('../db/config');

const app  = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must be set to a private value of at least 32 characters.');
}

// ── Middlewares ──────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5500,http://127.0.0.1:5500')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS.'));
    }
}));
app.use(express.json());

// ── MySQL Connection Pool ───────────────────────────────────
const pool = mysql.createPool(databaseConfig);

// ─────────────────────────────────────────────────────────────
//  Root — Health check (so the browser doesn't show "Cannot GET /")
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    console.log('[API Hit] Root health check');
    res.json({ status: 'online', server: 'WorkFlowX API', port: PORT });
});

function authenticate(req, res, next) {
    const authorization = req.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
}

async function canAccessProject(user, projectId) {
    if (user.role === 'admin') return true;

    const [members] = await pool.query(
        'SELECT 1 FROM project_members WHERE project_id = ? AND user_email = ?',
        [projectId, user.email]
    );
    return members.length > 0;
}

// ─────────────────────────────────────────────────────────────
//  1. POST /api/auth/login
//     Authenticate a user against the 'users' table.
// ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT id, email, password, role FROM users WHERE email = ?',
            [email.trim()]
        );

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const user = rows[0];
        const hasBcryptHash = /^\$2[aby]\$/.test(user.password);
        const passwordMatches = hasBcryptHash
            ? await bcrypt.compare(password, user.password)
            : password === user.password;

        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        if (!hasBcryptHash) {
            const passwordHash = await bcrypt.hash(password, 12);
            await pool.query('UPDATE users SET password = ? WHERE id = ?', [passwordHash, user.id]);
        }

        const token = jwt.sign(
            { sub: String(user.id), email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        return res.json({ success: true, email: user.email, role: user.role, token });
    } catch (err) {
        console.error('[ERROR]  Login query failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

app.use('/api', authenticate);

// ─────────────────────────────────────────────────────────────
//  2. POST /api/admin/onboard
//     Admin-only: insert a new developer user into 'users'.
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/onboard', async (req, res) => {
    const { email, password } = req.body;
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin privileges required.' });
    }
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 12) {
        return res.status(400).json({ success: false, message: 'Enter a valid email and a password with at least 12 characters.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
            [email.trim(), passwordHash, 'developer']
        );
        return res.json({ success: true, message: `User ${email.trim()} onboarded successfully.` });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            console.error(`[WARN]   Duplicate email: ${email}`);
            return res.status(409).json({ success: false, message: 'Email already exists.' });
        }
        console.error('[ERROR]  Onboard query failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// ─────────────────────────────────────────────────────────────
//  3. POST /api/projects/create
//     Admin creates a project and seeds its member list.
// ─────────────────────────────────────────────────────────────
app.post('/api/projects/create', async (req, res) => {
    const { name, description, members } = req.body;
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin privileges required.' });
    }
    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Project name is required.' });
    }

    let connection;
    try {
        // Use a dedicated connection for the transaction
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Insert the project row
        const [result] = await connection.query(
            'INSERT INTO projects (name, description, creator) VALUES (?, ?, ?)',
            [name.trim(), description || null, req.user.email]
        );

        const projectId = result.insertId;

        // Build a unique member set (always include the creator)
        const memberEmails = new Set(Array.isArray(members) ? members.filter((email) => typeof email === 'string').map((email) => email.trim()) : []);
        memberEmails.add(req.user.email);

        // Insert each member into the junction table
        for (const email of memberEmails) {
            await connection.query(
                'INSERT INTO project_members (project_id, user_email) VALUES (?, ?)',
                [projectId, email]
            );
        }

        await connection.commit();
        return res.json({ success: true, projectId, message: 'Project created successfully.' });
    } catch (err) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('[ERROR]  Project creation failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    } finally {
        if (connection) connection.release();
    }
});

// ─────────────────────────────────────────────────────────────
//  4. GET /api/projects/fetch/:email/:role
//     Admin  → all projects.
//     Developer → only projects the user is a member of.
// ─────────────────────────────────────────────────────────────
app.get('/api/projects/fetch/:email/:role', async (req, res) => {
    try {
        let rows;

        if (req.user.role === 'admin') {
            // Admin sees everything
            [rows] = await pool.query('SELECT * FROM projects');
            console.log(`[DB]     Admin fetch — ${rows.length} project(s) returned.`);
        } else {
            // Developer sees only assigned projects via INNER JOIN
            [rows] = await pool.query(
                `SELECT p.*
                   FROM projects p
                   INNER JOIN project_members pm ON p.id = pm.project_id
                  WHERE pm.user_email = ?`,
                [req.user.email]
            );
        }

        return res.json({ success: true, projects: rows });
    } catch (err) {
        console.error('[ERROR]  Project fetch failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// ─────────────────────────────────────────────────────────────
//  5. POST /api/tasks/create
//     Insert an agile task ticket into a project workspace.
// ─────────────────────────────────────────────────────────────
app.post('/api/tasks/create', async (req, res) => {
    const { project_id, title, description, priority } = req.body;
    if (!Number.isInteger(Number(project_id)) || !await canAccessProject(req.user, Number(project_id))) {
        return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
    }
    if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Task title is required.' });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO tasks (project_id, title, description, priority, status, last_modified_by)
             VALUES (?, ?, ?, ?, 'todo', ?)`,
            [project_id, title.trim(), description || null, priority || null, req.user.email]
        );

        return res.json({ success: true, taskId: result.insertId, message: 'Task created successfully.' });
    } catch (err) {
        console.error('[ERROR]  Task creation failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// ─────────────────────────────────────────────────────────────
//  6. PATCH /api/tasks/:taskId/transition
//     Transition a task's status and log the modifier.
// ─────────────────────────────────────────────────────────────
app.patch('/api/tasks/:taskId/transition', async (req, res) => {
    const { taskId } = req.params;
    const { status } = req.body;

    const validStatuses = ['todo', 'progress', 'done'];
    if (!validStatuses.includes(status)) {
        console.log(`[WARN]   Invalid status value: ${status}`);
        return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    try {
        const [tasks] = await pool.query('SELECT project_id FROM tasks WHERE id = ?', [taskId]);
        if (tasks.length === 0) {
            return res.status(404).json({ success: false, message: 'Task not found.' });
        }
        if (!await canAccessProject(req.user, tasks[0].project_id)) {
            return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
        }

        const [result] = await pool.query(
            'UPDATE tasks SET status = ?, last_modified_by = ? WHERE id = ?',
            [status, req.user.email, taskId]
        );

        if (result.affectedRows === 0) {
            console.log(`[WARN]   Task ${taskId} not found.`);
            return res.status(404).json({ success: false, message: 'Task not found.' });
        }

        console.log(`[DB]     Task ${taskId} transitioned to "${status}" by ${userEmail}`);
        return res.json({ success: true, message: `Task ${taskId} updated to "${status}".` });
    } catch (err) {
        console.error('[ERROR]  Task transition failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// ─────────────────────────────────────────────────────────────
//  7. GET /api/projects/:projectId/tasks
//     Fetch all task rows linked to a specific project.
// ─────────────────────────────────────────────────────────────
app.get('/api/projects/:projectId/tasks', async (req, res) => {
    const { projectId } = req.params;

    try {
        const [projects] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (projects.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found.' });
        }
        if (!await canAccessProject(req.user, projectId)) {
            return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
        }

        const [rows] = await pool.query(
            'SELECT * FROM tasks WHERE project_id = ?',
            [projectId]
        );

        console.log(`[DB]     ${rows.length} task(s) returned for project ${projectId}.`);
        return res.json({ success: true, tasks: rows });
    } catch (err) {
        console.error('[ERROR]  Task fetch failed:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// ── Start Server ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════');
    console.log(`  WorkFlowX API Server running on port ${PORT}`);
    console.log('  Network Traffic Audit Log — ACTIVE');
    console.log('═══════════════════════════════════════════════');
});
