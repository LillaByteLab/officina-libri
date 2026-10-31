export type KdpFormat = {id:string;label:string;widthIn:number;heightIn:number};
export const PAPERBACK_FORMATS:KdpFormat[];
export const HARDCOVER_FORMATS:KdpFormat[];
export const JAPAN_FORMATS:KdpFormat[];
export const JAPAN_CHECKED_AT:string;
export const KDP_SOURCES:string[];
export type KdpInput={market?:'standard'|'jp';binding?:'paperback'|'hardcover';formatId?:string;customWidthIn?:number;customHeightIn?:number;ink?:'black'|'standard'|'premium';paper?:'white'|'cream'|'groundwood';bleed?:boolean;pageCount?:number};
export function planKdp(input?:KdpInput):{settingsErrors:string[];submissionErrors:string[];spineFactorIn:number|null;spineTextAllowed:boolean;safeFromTrimMm:{inside:number;outside:number;top:number;bottom:number};format:KdpFormat;market:string;binding:string;ink:string;paper:string;bleed:boolean;pageCount:number;countedPages:number;minimum:number;maximum:number|null;issues:string[];trimMm:number[];interiorMm:number[];spineMm:number|null;coverMm:number[]|null;minimumMarginsMm:{inside:number;outside:number};notes:string[]};

export const KDP_CHECKED_AT:string;
export const KDP_BLEED_MM:number;
export const KDP_OUTPUT_RULES:any;
export function defaultKdp(kind?:string):Required<Pick<KdpInput,"binding"|"formatId"|"ink"|"paper"|"bleed">>;
export function applyKdp<T>(project:T,settings:KdpInput):T;
export function configurationKey(project:any):string;
