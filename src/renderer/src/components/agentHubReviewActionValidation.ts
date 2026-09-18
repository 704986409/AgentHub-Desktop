import type {
  ReviewDecisionInputDto,
  ReviewFindingInputDto,
  ReviewFindingSeverityDto,
  ReviewVerdictDto
} from '@shared/agenthubTypes';

const FINDING_CODE_RE = /^[A-Za-z0-9._-]{1,128}$/;
const VALID_SEVERITIES: readonly ReviewFindingSeverityDto[] = ['info', 'warning', 'error', 'blocker'];

export function validateFindingCode(code: string): string | null {
  if (!code || !FINDING_CODE_RE.test(code)) {
    return 'Finding code must match ^[A-Za-z0-9._-]{1,128}$';
  }
  return null;
}

export function validateFindingSeverity(severity: string): string | null {
  if (!VALID_SEVERITIES.includes(severity as ReviewFindingSeverityDto)) {
    return "Severity must be one of: 'info', 'warning', 'error', 'blocker'";
  }
  return null;
}

export function validateFindingMessage(message: string): string | null {
  if (typeof message !== 'string') {
    return 'Message must be a string';
  }
  if (message.includes('\0')) {
    return 'Message cannot contain NUL bytes';
  }
  if (new TextEncoder().encode(message).length > 8192) {
    return 'Message exceeds maximum length of 8192 UTF-8 bytes';
  }
  return null;
}

export function validateFindingPath(path: string | undefined): string | null {
  if (path === undefined || path === '') {
    return null;
  }
  if (path.includes('\0')) {
    return 'Path cannot contain NUL bytes';
  }
  if (new TextEncoder().encode(path).length > 4096) {
    return 'Path exceeds maximum length of 4096 UTF-8 bytes';
  }
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
    return 'Path must be a relative metadata path';
  }
  const segments = path.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      return `Path contains invalid segment '${seg}'`;
    }
  }
  return null;
}

export function validateSummary(summary: string): string | null {
  if (typeof summary !== 'string') {
    return 'Summary must be a string';
  }
  if (summary.includes('\0')) {
    return 'Summary cannot contain NUL bytes';
  }
  if (new TextEncoder().encode(summary).length > 16384) {
    return 'Summary exceeds maximum length of 16384 UTF-8 bytes';
  }
  return null;
}

export function validateReviewDecisionInput(input: ReviewDecisionInputDto): string | null {
  const summaryErr = validateSummary(input.summary);
  if (summaryErr) return summaryErr;

  if (input.findings.length > 256) {
    return 'Findings cannot exceed 256 items';
  }

  for (let i = 0; i < input.findings.length; i++) {
    const f = input.findings[i];
    const codeErr = validateFindingCode(f.code);
    if (codeErr) return `Finding #${i + 1}: ${codeErr}`;

    const sevErr = validateFindingSeverity(f.severity);
    if (sevErr) return `Finding #${i + 1}: ${sevErr}`;

    const msgErr = validateFindingMessage(f.message);
    if (msgErr) return `Finding #${i + 1}: ${msgErr}`;

    const pathErr = validateFindingPath(f.path);
    if (pathErr) return `Finding #${i + 1}: ${pathErr}`;
  }

  if (input.verdict === 'ACCEPT') {
    const hasErrorOrBlocker = input.findings.some(
      (f) => f.severity === 'error' || f.severity === 'blocker'
    );
    if (hasErrorOrBlocker) {
      return "ACCEPT verdict cannot contain 'error' or 'blocker' findings";
    }
  } else if (input.verdict === 'BLOCK') {
    const hasBlocker = input.findings.some((f) => f.severity === 'blocker');
    if (!hasBlocker) {
      return "BLOCK verdict requires at least one finding with severity 'blocker'";
    }
  }

  return null;
}
