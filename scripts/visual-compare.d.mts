export interface PixelDiff {
  width: number;
  height: number;
  different: number;
}
export declare function diffPixels(expected: Uint8Array, actual: Uint8Array): PixelDiff;
export declare function exceedsThreshold(different: number, width: number, height: number): boolean;
