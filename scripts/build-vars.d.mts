export interface BuildVars {
  version: string;
  commit: string;
}

export function buildVars(): BuildVars;
