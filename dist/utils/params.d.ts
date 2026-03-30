/** Safely convert Express route param (string | string[]) to number */
export declare function paramInt(val: string | string[] | undefined): number;
/** Safely convert Express query param to string */
export declare function queryStr(val: unknown): string | undefined;
/** Safely convert Express query param to int */
export declare function queryInt(val: unknown, def: number): number;
/** Safely convert Express query param to float */
export declare function queryFloat(val: unknown, def: number): number;
