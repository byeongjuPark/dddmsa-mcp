export interface AnalysisEvidence {
  file: string;
  line?: number;
  message?: string;
}

export interface ToolResult {
  ruleId: string;
  confidence: number; // 0.0 to 1.0 representing analysis confidence
  evidence: AnalysisEvidence[];
  errorCode?: string;
  recommendation?: string;
}
