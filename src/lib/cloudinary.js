const cloudinary = require('cloudinary').v2;

// Cloudinary will automatically use the CLOUDINARY_URL environment variable if present.
// Alternatively, we can manually configure it.
if (process.env.CLOUDINARY_URL) {
    cloudinary.config();
} else if (process.env.CLOUDINARY_API_KEY) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dpzlmufop',
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

module.exports = cloudinary;
