export const DEFAULT_MAX_SOURCE_LENGTH = 12_000;
export const MAX_ALLOWED_SOURCE_LENGTH = 100_000;

export interface SourceSanitizerOptions {
  maxLength?: number;
}

export interface SourceSanitizationResult {
  content: string;
  text: string;
  wasTruncated: boolean;
  originalLength: number;
  sanitizedLength: number;
}

const SCRIPT_BLOCK = /<(script|style|iframe|object|embed|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_ACTIVE_TAG = /<(script|style|iframe|object|embed|template|svg|math)\b[^>]*>[\s\S]*$/gi;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const EVENT_HANDLER = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const ACTIVE_ATTRIBUTE = /\s+(?:href|src|xlink:href|action|formaction|srcdoc)\s*=\s*(?:"\s*(?:(?:javascript|vbscript|file)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|javascript|ecmascript)))[^"]*"|'\s*(?:(?:javascript|vbscript|file)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|javascript|ecmascript)))[^']*'|(?:(?:javascript|vbscript|file)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|javascript|ecmascript)))[^\s>]*)/gi;
const INSTRUCTION_BOUNDARY = /<\|?\s*(?:im_start|im_end|system|assistant|user|endoftext|start_header_id)\s*\|?>/gi;
const ROLE_LINE = /^\s*(?:system|developer|assistant|user)\s*:\s*/gim;
const INSTRUCTION_OVERRIDE = /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|preceding|system|developer)\s+(?:instructions?|prompts?|rules?|directions?|messages?)\b/gi;
const ROLE_ASSIGNMENT = /\byou\s+are\s+(?:now\s+)?(?:a|an|the)?\s*(?:new\s+)?(?:system|developer|assistant|model|ai)\b/gi;
const SECRET_INSTRUCTION = /\b(?:reveal|show|print|repeat|output|disclose)\s+(?:me\s+)?(?:the\s+|your\s+|all\s+)?(?:system\s+prompt|system\s+message|developer\s+instructions?|hidden\s+instructions?|api\s+keys?)\b/gi;
const CODE_FENCE = /`{3,}/g;
const UNSAFE_PROTOCOL = /\b(?:(?:javascript|vbscript|file)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|javascript|ecmascript)))[^\s<]*/gi;
const CONTROL_CONTENT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function resolveMaxLength(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_SOURCE_LENGTH;
  if (!Number.isFinite(value)) return DEFAULT_MAX_SOURCE_LENGTH;
  return Math.max(1, Math.min(Math.trunc(value), MAX_ALLOWED_SOURCE_LENGTH));
}

function removeScriptsAndControls(value: string): string {
  return value
    .normalize("NFKC")
    .slice(0, MAX_ALLOWED_SOURCE_LENGTH)
    .replace(SCRIPT_BLOCK, " ")
    .replace(UNCLOSED_ACTIVE_TAG, " ")
    .replace(HTML_COMMENT, " ")
    .replace(EVENT_HANDLER, " ")
    .replace(ACTIVE_ATTRIBUTE, " ")
    .replace(INSTRUCTION_BOUNDARY, " ")
    .replace(ROLE_LINE, "role: ")
    .replace(INSTRUCTION_OVERRIDE, "[instruction removed]")
    .replace(ROLE_ASSIGNMENT, "[role instruction removed]")
    .replace(SECRET_INSTRUCTION, "[instruction removed]")
    .replace(CODE_FENCE, " ")
    .replace(UNSAFE_PROTOCOL, "[unsafe content removed]")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL_CONTENT, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sliceByCodePoint(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const points = Array.from(value);
  if (points.length <= maxLength) return value;
  return points.slice(0, maxLength).join("");
}

export function sanitizeSourceContent(
  input: unknown,
  options: SourceSanitizerOptions | number = {}
): SourceSanitizationResult {
  const maxLength = resolveMaxLength(typeof options === "number" ? options : options.maxLength);
  const originalLength = typeof input === "string" ? input.length : 0;
  const sanitized = removeScriptsAndControls(typeof input === "string" ? input : "");
  const wasTruncated = Array.from(sanitized).length > maxLength;
  const bounded = sliceByCodePoint(sanitized, maxLength);
  return {
    content: bounded,
    text: bounded,
    wasTruncated,
    originalLength,
    sanitizedLength: bounded.length,
  };
}

export function sanitizeSource(input: unknown, maxLength?: number): string {
  return sanitizeSourceContent(input, maxLength).content;
}

export const sanitizeUntrustedSource = sanitizeSource;
