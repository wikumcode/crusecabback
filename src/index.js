// Server Entry Point
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(process.cwd(), '.env');
console.log(`[Env] Looking for .env at: ${envPath}`);
const result = dotenv.config();
if (result.error) {
    console.warn(`[Env] .env file not found or could not be read at ${envPath}`);
} else {
    console.log(`[Env] .env loaded successfully from ${envPath}`);
}

// DATABASE_URL must be a PostgreSQL connection string, e.g. postgresql://user:pass@host:5432/dbname
if (!process.env.DATABASE_URL && process.env.POSTGRES_URL) {
    process.env.DATABASE_URL = process.env.POSTGRES_URL;
    console.log('[Env] Aliased POSTGRES_URL to DATABASE_URL');
}
// Legacy: older deployments used MONGODB_URI as Prisma datasource name
if (!process.env.DATABASE_URL && process.env.MONGODB_URI) {
    process.env.DATABASE_URL = process.env.MONGODB_URI;
    console.log('[Env] Aliased MONGODB_URI to DATABASE_URL (legacy env name)');
}

process.env.TZ = 'Asia/Colombo';
const { ensureIndexes } = require('./utils/ensure-indexes');

// Bootstrap critical DB indexes for performance
ensureIndexes();

const prisma = require('./lib/prisma');

const app = express();
app.use(compression());
const PORT = process.env.PORT || 5000;

console.log('--- Environment Check ---');
console.log('JWT_SECRET loaded:', !!process.env.JWT_SECRET);
console.log('DATABASE_URL loaded:', !!process.env.DATABASE_URL);
console.log('-------------------------');

const allowedOrigins = new Set([
    'https://cruisecabs.rentix.lk',
    'https://api-cruisecabs.rentix.lk',
    'https://tourmi-sl.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
]);

function isDevLanOrigin(origin) {
    // Allow local dev over LAN/IP with any port (Vite picks ports dynamically).
    // Examples: http://192.168.1.6:5175, http://10.0.0.12:5174
    try {
        const { protocol, hostname } = new URL(origin);
        if (protocol !== 'http:') return false;
        if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
        // Basic private IPv4 ranges
        const isPrivateIp =
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
        return isPrivateIp;
    } catch {
        return false;
    }
}

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser requests (curl, etc)
        if (!origin) return callback(null, true);

        // Check if origin is in the allowed set or matches dev patterns
        if (allowedOrigins.has(origin) || isDevLanOrigin(origin)) {
            return callback(null, true);
        }

        // Resilient check for Vercel/Render subdomains and custom domains
        if (
            origin.includes('vercel.app') ||
            origin.includes('onrender.com') ||
            origin.includes('localhost') ||
            origin.includes('rentix.lk') ||
            origin.includes('rentix.online')
        ) {
            console.log('Resilient CORS Allow:', origin);
            return callback(null, true);
        }

        console.error('CORS blocked for origin:', origin);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));



// Serve static files from the uploads directory
// NOTE: Uploads are written under `server/uploads` by `upload.routes.js` and controllers.
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
const authRoutes = require('./routes/auth.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const driverRoutes = require('./routes/driver.routes');
const userRoutes = require('./routes/user.routes');
const clientRoutes = require('./routes/client.routes');
const vendorRoutes = require('./routes/vendor.routes');
const settingsRoutes = require('./routes/settings.routes');
const emailSettingsRoutes = require('./routes/emailSettings.routes');
const emailTemplatesRoutes = require('./routes/emailTemplates.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const agreementRoutes = require('./routes/agreement.routes');

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/settings', settingsRoutes);
app.use('/api/email-settings', emailSettingsRoutes);
app.use('/api/email-templates', emailTemplatesRoutes);
app.use('/api/fleet', require('./routes/fleet.routes'));
app.use('/api/permission-groups', require('./routes/permissionGroup.routes'));
app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/contracts', require('./routes/contract.routes'));
app.use('/api/quotations', require('./routes/quotation.routes'));
const quotationController = require('./controllers/quotation.controller');
app.get('/api/q/:shareToken', quotationController.getSharedQuotationByShortToken);
app.use('/api/advance-receipts', require('./routes/advanceReceipt.routes'));
app.use('/api/invoices', invoiceRoutes);
app.use('/api/agreements', agreementRoutes);
const agreementControllerForShortLink = require('./controllers/agreement.controller');
app.get('/api/a/:shareToken', agreementControllerForShortLink.getSharedAgreementByShortToken);
app.use('/api/locations', require('./routes/location.routes'));
app.use('/api/odometers', require('./routes/odometer.routes'));
app.use('/api/system', require('./routes/system.routes'));
app.use('/api/maintenances', require('./routes/maintenance.routes'));
app.use('/api/expenses', require('./routes/expense.routes'));
app.use('/api/payment-schedules', require('./routes/paymentSchedule.routes'));
app.use('/api/vendor-bills', require('./routes/vendorBill.routes'));
app.use('/api/reports', require('./routes/report.routes'));
app.use('/api/upload', require('./routes/upload.routes'));

app.get('/api/debug-auth', (req, res) => {
    res.json({
        headers: req.headers,
        hasToken: !!req.headers['authorization'],
        tokenStart: (req.headers['authorization'] ? req.headers['authorization'].substring(0, 15) : '') + '...',
        method: req.method,
        url: req.url
    });
});

app.get('/api/debug-db', async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        res.json({
            status: 'connected',
            userCount,
            dbUrlExists: !!process.env.DATABASE_URL,
            dbUrlMasked: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^@]+)@/, ':****@') : ''
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
});

app.get('/api', (req, res) => {
    res.json({
        message: 'Rentix API is running',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            vehicles: '/api/vehicles',
            quotationShare: '/api/q/:shareToken (short) — legacy: /api/quotations/share/:id?token=...',
            agreementShare: '/api/a/:shareToken (short) — legacy: /api/agreements/share/:id?token=...'
        }
    });
});

app.get('/', (req, res) => {
    res.send('Rentix API is running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Global Express Error Handler
app.use((err, req, res, next) => {
    console.error('--- UNHANDLED EXPRESS ERROR ---');
    console.error('Path:', req.path);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    console.error('--------------------------------');
    
    res.status(500).json({
        message: 'Internal Server Error',
        error: err.message
    });
});

// Only start the HTTP server in local dev or Render - Vercel handles this in serverless mode
if (!process.env.VERCEL || process.env.RENDER) {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    server.on('error', (error) => {
        console.error('Server error:', error);
    });

    // Self-ping keep-alive — prevents Render free tier from sleeping (fires every 14 min)
    // Only runs when SELF_PING_URL is set in Render env vars (e.g. https://your-app.onrender.com/health)
    if (process.env.SELF_PING_URL) {
        const https = require('https');
        const http = require('http');
        setInterval(() => {
            const url = process.env.SELF_PING_URL;
            const lib = url.startsWith('https') ? https : http;
            lib.get(url, (res) => {
                console.log(`[keep-alive] ping ${url} → ${res.statusCode}`);
            }).on('error', (err) => {
                console.warn('[keep-alive] ping failed:', err ? err.message : 'unknown error');
            });
        }, 14 * 60 * 1000); // 14 minutes
    }
}

// Global error handlers for debugging unhandled crashes
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

module.exports = app;
