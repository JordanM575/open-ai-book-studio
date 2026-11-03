export declare const FAILING_IMPACTS: string[];
export interface AxeGateViolation {
  impact?: string;
  id: string;
  help: string;
  nodes?: Array<{ target?: string[] }>;
}
export declare function summarizeAxe(violations: AxeGateViolation[] | null | undefined): {
  failing: AxeGateViolation[];
  reported: AxeGateViolation[];
};
