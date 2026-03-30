/**
 * Role Assignment Script
 * Run ONCE to populate the UserRole table.
 *
 * Rules:
 *  - Default role = customer
 *  - User with any BusinessPromotion record → role = business
 *  - Legacy user with legacy_id = 68edfc0739b50dcdcacd3c5b → role = admin
 *
 * Usage: ts-node src/scripts/assignRoles.ts
 */
import 'dotenv/config';
