/**
 * Basic HTTP Authentication Middleware for Admin Routes
 */

const { validateAdmin } = require('../utils/database');

/**
 * Parse Basic Auth header
 * @param {string} header - Authorization header value
 * @returns {object|null} - { email, password } or null if invalid
 */
function parseBasicAuth(header) {
    if (!header || !header.startsWith('Basic ')) {
        return null;
    }

    try {
        const base64Credentials = header.slice(6);
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const [email, password] = credentials.split(':');

        if (!email || !password) {
            return null;
        }

        return { email, password };
    } catch (error) {
        return null;
    }
}

/**
 * Basic Auth middleware for protecting admin routes
 */
async function basicAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const credentials = parseBasicAuth(authHeader);

    if (!credentials) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).send('Authentication required');
    }

    try {
        const isValid = await validateAdmin(credentials.email, credentials.password);

        if (!isValid) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
            return res.status(401).send('Invalid credentials');
        }

        // Store authenticated user email in request for logging
        req.adminUser = credentials.email;
        next();
    } catch (error) {
        console.error('[Auth] Error validating credentials:', error.message);
        res.status(500).send('Authentication error');
    }
}

module.exports = basicAuthMiddleware;
