"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.signRefreshToken = signRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.hashToken = hashToken;
exports.refreshTokenExpiry = refreshTokenExpiry;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}
function signRefreshToken(payload) {
    return jsonwebtoken_1.default.sign({ ...payload, jti: crypto_1.default.randomUUID() }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, ACCESS_SECRET);
}
function verifyRefreshToken(token) {
    return jsonwebtoken_1.default.verify(token, REFRESH_SECRET);
}
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/** Returns Date 7 days from now */
function refreshTokenExpiry() {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
//# sourceMappingURL=jwt.js.map