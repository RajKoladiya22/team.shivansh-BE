export interface TemplateRenderOptions {
  fallbackValue?: string;
  trimWhitespace?: boolean;
}

export class TemplateEngine {
  /**
   * Renders a message template by substituting {{variable_name}} tokens with provided values.
   */
  public static render(
    template: string,
    variables: Record<string, any>,
    options?: TemplateRenderOptions
  ): string {
    if (!template || typeof template !== "string") return "";

    const fallback = options?.fallbackValue ?? "";

    const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
      const value = variables[key];
      if (value !== undefined && value !== null) {
        return String(value);
      }
      return fallback;
    });

    return options?.trimWhitespace !== false ? rendered.trim() : rendered;
  }

  /**
   * Extracts all variable names required by a template string.
   */
  public static extractVariables(template: string): string[] {
    if (!template || typeof template !== "string") return [];
    const matches = template.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g);
    const vars = new Set<string>();
    for (const match of matches) {
      if (match[1]) vars.add(match[1]);
    }
    return Array.from(vars);
  }

  /**
   * Validates if all required variables are present in the data object.
   */
  public static validateVariables(
    template: string,
    variables: Record<string, any>,
    requiredKeys?: string[]
  ): { valid: boolean; missing: string[] } {
    const keysToCheck = requiredKeys || this.extractVariables(template);
    const missing = keysToCheck.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === "");
    return {
      valid: missing.length === 0,
      missing,
    };
  }
}
