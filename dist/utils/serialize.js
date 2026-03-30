"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonSafe = jsonSafe;
function jsonSafe(value) {
    return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)));
}
//# sourceMappingURL=serialize.js.map