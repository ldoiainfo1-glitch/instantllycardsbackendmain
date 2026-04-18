"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
exports.requireRole = requireRole;
const jwt_1 = require("../utils/jwt");
const authenticate = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid Authorization header" });
        return;
    }
    const token = header.slice(7);
    try {
        req.user = (0, jwt_1.verifyAccessToken)(token);
        next();
    }
    catch {
        res.status(401).json({ error: "Token expired or invalid" });
    }
};
exports.authenticate = authenticate;
function requireRole(...roles) {
    return (req, res, next) => {
        const authReq = req;
        if (!authReq.user) {
            res.status(401).json({ error: "Unauthenticated" });
            return;
        }
        const hasRole = roles.some((r) => authReq.user.roles.includes(r));
        if (!hasRole) {
            res.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map