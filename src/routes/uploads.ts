import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { uploadToS3 } from '../utils/s3';

const router = Router();

// 5 MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

router.post(
  '/image',
  authenticate,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const userId = (req as any).userId;
      const ext = req.file.originalname?.split('.').pop() || 'jpg';
      const key = `business-logos/${userId}/${Date.now()}.${ext}`;

      const url = await uploadToS3(req.file.buffer, key, req.file.mimetype);
      res.json({ url });
    } catch (err: any) {
      console.error('[Upload] S3 upload failed:', err.message);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

export default router;
