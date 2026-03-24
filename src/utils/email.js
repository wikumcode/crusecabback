const { sendTemplateEmail } = require('../services/email/email.service');

// Wrapper: send customer welcome email after client creation.
// It must never block registration.
exports.sendWelcomeEmail = async (email, name) => {
    try {
        const customerName = name || 'Customer';
        await sendTemplateEmail('WELCOME', email, { customer_name: customerName });
    } catch (error) {
        // Errors are already logged into email_logs by the email service.
        console.error('Error sending welcome email:', error?.message || error);
    }
};
