const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const requiredVariables = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) missingVariables.push('DB_PASSWORD');

if (missingVariables.length > 0) {
    throw new Error(`Missing database environment variable(s): ${missingVariables.join(', ')}`);
}

const databaseConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0
};

if (process.env.DB_SSL === 'true') {
    databaseConfig.ssl = {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {})
    };
}

module.exports = { databaseConfig };