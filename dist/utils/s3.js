"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToS3 = uploadToS3;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3 = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const BUCKET = process.env.S3_BUCKET || 'instantlly-media-prod';
const CLOUDFRONT_HOST = process.env.CLOUDFRONT_HOST;
async function uploadToS3(buffer, key, contentType) {
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    // Return CloudFront URL if configured, otherwise S3 URL
    if (CLOUDFRONT_HOST) {
        return `https://${CLOUDFRONT_HOST}/${key}`;
    }
    return `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${key}`;
}
//# sourceMappingURL=s3.js.map