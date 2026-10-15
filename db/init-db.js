const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');
const { databaseConfig } = require('./config');

async function initializeDatabase() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    const statements = schema
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
    const pool = mysql.createPool(databaseConfig);

    try {
        const connection = await pool.getConnection();
        try {
            for (const statement of statements) {
                await connection.query(statement);
            }
        } finally {
            connection.release();
        }
        console.log(`Initialized ${statements.length} schema statements in ${databaseConfig.database}.`);
    } finally {
        await pool.end();
    }
}

initializeDatabase().catch((error) => {
    console.error('Database initialization stopped:', error.message);
    process.exitCode = 1;
});
