const ESCAPED_OPEN_BRACE = "__MLEX_ESCAPED_OPEN_BRACE__";
const MAX_OUTPUT_LENGTH = 12_000;

export interface RenderTagTemplateOptions {
  maxOutputLength?: number;
}

export function renderTagTemplate(
  template: string,
  vars: Record<string, string>,
  options: RenderTagTemplateOptions = {}
): string {
  const maxOutputLength = Math.max(1, options.maxOutputLength ?? MAX_OUTPUT_LENGTH);
  const escaped = template.replaceAll("\\{{", ESCAPED_OPEN_BRACE);
  const rendered = escaped.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    return vars[name] ?? "";
  });
  const restored = rendered.replaceAll(ESCAPED_OPEN_BRACE, "{{");
  return restored.length <= maxOutputLength
    ? restored
    : `${restored.slice(0, maxOutputLength)}\n...[truncated]`;
}
