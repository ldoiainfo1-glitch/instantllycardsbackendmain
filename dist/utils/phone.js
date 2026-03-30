"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhone = normalizePhone;
exports.phoneVariants = phoneVariants;
function normalizePhone(raw) {
    const phone = raw.trim();
    if (phone.startsWith('+91'))
        return phone.slice(3);
    if (phone.startsWith('+'))
        return phone.slice(1);
    if (phone.startsWith('91') && phone.length > 10)
        return phone.slice(2);
    return phone;
}
function phoneVariants(raw) {
    const bare = normalizePhone(raw.trim());
    return [bare, `+91${bare}`, `91${bare}`];
}
//# sourceMappingURL=phone.js.map