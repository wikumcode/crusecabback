const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const cloudinary = require('../lib/cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const hasCloudinaryConfig = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_API_KEY);

// Configure storage: Cloudinary when configured, otherwise local disk fallback.
const storage = hasCloudinaryConfig
    ? new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'rentix-uploads',
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
            resource_type: 'auto',
        },
    })
    : multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    });

const upload = multer({ storage });

// Single file upload endpoint
router.post('/', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Return URL based on active storage backend.
        const fileUrl = hasCloudinaryConfig
            ? (req.file.path || req.file.secure_url)
            : `/uploads/${req.file.filename}`;

        res.status(200).json({
            message: 'File uploaded successfully',
            url: fileUrl
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ message: 'File upload failed', error: error.message });
    }
});

module.exports = router;
