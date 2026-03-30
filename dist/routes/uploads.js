"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const s3_1 = require("../utils/s3");
const router = (0, express_1.Router)();
// 5 MB limit, images only
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
router.post('/image', auth_1.authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file provided' });
            return;
        }
        const userId = req.userId;
        const ext = req.file.originalname?.split('.').pop() || 'jpg';
        const key = `business-logos/${userId}/${Date.now()}.${ext}`;
        const url = await (0, s3_1.uploadToS3)(req.file.buffer, key, req.file.mimetype);
        res.json({ url });
    }
    catch (err) {
        console.error('[Upload] S3 upload failed:', err.message);
        res.status(500).json({ error: 'Upload failed' });
    }
});
exports.default = router;
//# sourceMappingURL=uploads.js.map