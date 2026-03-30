"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
const jwt_1 = require("../utils/jwt");
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }
    const token = header.slice(7);
    try {
        req.user = (0, jwt_1.verifyAccessToken)(token);
        next();
    }
    catch {
        res.status(401).json({ error: 'Token expired or invalid' });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthenticated' });
            return;
        }
        const hasRole = roles.some((r) => req.user.roles.includes(r));
        if (!hasRole) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map