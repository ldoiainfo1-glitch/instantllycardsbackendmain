"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paramInt = paramInt;
exports.queryStr = queryStr;
exports.queryInt = queryInt;
exports.queryFloat = queryFloat;
/** Safely convert Express route param (string | string[]) to number */
function paramInt(val) {
    return parseInt(Array.isArray(val) ? val[0] : val ?? '0', 10);
}
/** Safely convert Express query param to string */
function queryStr(val) {
    if (typeof val === 'string')
        return val;
    if (Array.isArray(val) && typeof val[0] === 'string')
        return val[0];
    return undefined;
}
/** Safely convert Express query param to int */
function queryInt(val, def) {
    const s = queryStr(val);
    if (!s)
        return def;
    const n = parseInt(s, 10);
    return isNaN(n) ? def : n;
}
/** Safely convert Express query param to float */
function queryFloat(val, def) {
    const s = queryStr(val);
    if (!s)
        return def;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : def;
}
//# sourceMappingURL=params.js.map