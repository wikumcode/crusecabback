// Server Entry Point
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const prisma = require('./lib/prisma');

const app = express();
const PORT = process.env.PORT || 5000;

console.log('--- Environment Check ---');
console.log('JWT_SECRET loaded:', !!process.env.JWT_SECRET);
console.log('DATABASE_URL loaded:', !!process.env.DATABASE_URL);
console.log('-------------------------');

// Middleware
const allowedOrigins = new Set([
    'https://rentix-front.vercel.app',
    'https://rentix.codebraze.com',
    'https://rentix-front-nozdp00ef-codebrazes-projects.vercel.app',
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
        // Allow non-browser requests (curl, server-to-server) where Origin is undefined
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin) || isDevLanOrigin(origin)) return callback(null, true);
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
app.use('/api/invoices', invoiceRoutes);
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
        tokenStart: req.headers['authorization']?.substring(0, 15) + '...',
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
            dbUrlMasked: process.env.DATABASE_URL?.replace(/:([^@]+)@/, ':****@')
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
            vehicles: '/api/vehicles'
        }
    });
});

app.get('/', (req, res) => {
    res.send('Rentix API is running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Only start the HTTP server in local dev - Vercel handles this in serverless mode
if (!process.env.VERCEL) {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
    server.on('error', (error) => {
        console.error('Server error:', error);
    });
}

// Global error handlers for debugging unhandled crashes
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

module.exports = app;
