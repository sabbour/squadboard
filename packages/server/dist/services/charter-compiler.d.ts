export interface CharterMetadata {
    name: string;
    role: string;
    model?: string;
    expertise: string[];
    style?: string;
    reviewerAuthority?: string[];
}
/**
 * Parse a charter.md file and extract structured metadata.
 *
 * Extraction rules:
 *   - name  → first `# Heading` in the file
 *   - role  → paragraph/line after `## Role` heading, or value in a markdown table row with "Role"
 *   - model → paragraph/line after `## Model` heading
 *   - expertise → bullet list items under `## Expertise` (or `## Skills`, `## Capabilities`)
 *   - style → first paragraph under `## Style`
 *   - reviewerAuthority → bullet list items under `## Reviewer authority` (or `## Review authority`)
 */
export declare function parseCharter(charterPath: string): Promise<CharterMetadata>;
/**
 * Generate and write a charter.md from metadata.
 */
export declare function writeCharter(charterPath: string, meta: CharterMetadata): Promise<void>;
/**
 * Compute md5 hash of a charter file's content for change detection.
 */
export declare function computeCharterHash(charterPath: string): Promise<string>;
//# sourceMappingURL=charter-compiler.d.ts.map