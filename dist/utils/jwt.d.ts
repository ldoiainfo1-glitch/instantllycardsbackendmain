export interface JwtPayload {
    userId: number;
    roles: string[];
}
export declare function signAccessToken(payload: JwtPayload): string;
export declare function signRefreshToken(payload: JwtPayload): string;
export declare function verifyAccessToken(token: string): JwtPayload;
export declare function verifyRefreshToken(token: string): JwtPayload;
export declare function hashToken(token: string): string;
/** Returns Date 7 days from now */
export declare function refreshTokenExpiry(): Date;
