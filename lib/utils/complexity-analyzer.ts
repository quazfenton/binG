/**
 * Task Complexity & Intent Analyzer
 * 
 * Provides unified logic for:
 * - Detecting task complexity (simple/moderate/complex)
 * - Identifying intent (code, file, analysis, etc.)
 * - Calculating capability requirements
 */

export interface ComplexityMetrics {
  complexity: 'simple' | 'moderate' | 'complex';
  score: number;
  intent: string;
  wordCount: number;
  sentenceCount: number;
  hasCode: boolean;
  hasFiles: boolean;
  hasMultiStep: boolean;
  isMultiModal: boolean;
}

export class ComplexityAnalyzer {
  private static readonly PATTERNS = {
    code: /\b(code|function|class|import|export|debug|test|refactor|algorithm|optimize|review|programming)\b/i,
    file: /\b(file|save|load|download|upload|directory|folder|path|csv|json|xml|pdf|data)\b/i,
    analysis: /\b(analyze|compare|evaluate|synthesize|integrate|comprehensive|detailed|thorough|study|research)\b/i,
    workflow: /\b(workflow|chain|sequence|pipeline|multi-step|orchestrate|coordinate|then|next|after|phase)\b/i,
    creative: /\b(write|create|generate|story|article|blog|poem|creative)\b/i,
    multimodal: /\b(image|video|audio|chart|graph|diagram|visualization|media)\b/i
  };

  /**
   * Analyze message content for complexity and intent
   */
  static analyze(content: string): ComplexityMetrics {
    const trimmed = content.trim();
    if (!trimmed) {
      return this.getEmptyMetrics();
    }

    const lower = trimmed.toLowerCase();
    const wordCount = trimmed.split(/\s+/).length;
    const sentenceCount = trimmed.split(/[.!?]+/).length;

    let score = 0;
    let detectedIntent = 'general';

    // Calculate pattern scores
    if (this.PATTERNS.code.test(lower)) { score += 2; detectedIntent = 'code'; }
    if (this.PATTERNS.file.test(lower)) { score += 1.5; if (detectedIntent === 'general') detectedIntent = 'file'; }
    if (this.PATTERNS.analysis.test(lower)) { score += 2; if (detectedIntent === 'general') detectedIntent = 'analysis'; }
    if (this.PATTERNS.workflow.test(lower)) { score += 1.5; if (detectedIntent === 'general') detectedIntent = 'workflow'; }
    if (this.PATTERNS.creative.test(lower)) { score += 1; if (detectedIntent === 'general') detectedIntent = 'creative'; }
    if (this.PATTERNS.multimodal.test(lower)) { score += 2; }

    // Weight counts
    if (wordCount > 100) score += 3;
    else if (wordCount > 30) score += 1.5;

    if (sentenceCount > 5) score += 1;

    // Detect multi-step explicitly
    const hasMultiStep = /\b(step|then|next|after|phase|first|second|finally)\b/i.test(lower);
    if (hasMultiStep) score += 1.5;

    // Determine complexity level
    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    if (score >= 6) complexity = 'complex';
    else if (score >= 3) complexity = 'moderate';

    return {
      complexity,
      score,
      intent: detectedIntent,
      wordCount,
      sentenceCount,
      hasCode: this.PATTERNS.code.test(lower),
      hasFiles: this.PATTERNS.file.test(lower),
      hasMultiStep,
      isMultiModal: this.PATTERNS.multimodal.test(lower),
    };
  }

  private static getEmptyMetrics(): ComplexityMetrics {
    return {
      complexity: 'simple',
      score: 0,
      intent: 'general',
      wordCount: 0,
      sentenceCount: 0,
      hasCode: false,
      hasFiles: false,
      hasMultiStep: false,
      isMultiModal: false,
    };
  }
}
