import fs from 'node:fs/promises';
import crypto from 'node:crypto';
/**
 * Parse charter markdown content into structured metadata.
 *
 * Extraction rules:
 *   - name  → first `# Heading` in the file
 *   - role  → paragraph/line after `## Role` heading, or value in a markdown table row with "Role"
 *   - model → paragraph/line after `## Model` heading
 *   - expertise → bullet list items under `## Expertise` (or `## Skills`, `## Capabilities`)
 *   - style → first paragraph under `## Style`
 *   - reviewerAuthority → bullet list items under `## Reviewer authority` (or `## Review authority`)
 */
export function parseCharterContent(content) {
    const lines = content.split('\n');
    let name = '';
    let role = '';
    let model;
    const expertise = [];
    let style;
    const reviewerAuthority = [];
    let currentSection = 'none';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // First H1 = agent name
        if (!name && trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
            name = trimmed.replace(/^#\s+/, '').trim();
            currentSection = 'none';
            continue;
        }
        // Heading detection
        if (trimmed.startsWith('## ')) {
            const heading = trimmed.replace(/^##\s+/, '').toLowerCase();
            if (heading === 'identity' || heading === 'about') {
                currentSection = 'identity_table';
            }
            else if (heading === 'role') {
                currentSection = 'role';
            }
            else if (heading === 'model' || heading === 'preferred model') {
                currentSection = 'model';
            }
            else if (heading === 'expertise' ||
                heading === 'skills' ||
                heading === 'capabilities' ||
                heading === 'what i own') {
                currentSection = 'expertise';
            }
            else if (heading === 'style' || heading === 'how i work') {
                currentSection = 'style';
            }
            else if (heading === 'reviewer authority' ||
                heading === 'review authority' ||
                heading === 'reviewer authorities') {
                currentSection = 'reviewer_authority';
            }
            else {
                currentSection = 'none';
            }
            continue;
        }
        // Skip empty lines (but don't clear section)
        if (!trimmed)
            continue;
        switch (currentSection) {
            case 'identity_table': {
                // Markdown table rows: `| Role | Squad SDK Integrator |`
                if (trimmed.startsWith('|') && !trimmed.startsWith('| ---')) {
                    const cols = trimmed
                        .split('|')
                        .map((c) => c.trim())
                        .filter(Boolean);
                    if (cols.length >= 2) {
                        const key = cols[0].toLowerCase();
                        if (key === 'role' && !role)
                            role = cols[1];
                        if ((key === 'model' || key === 'preferred model') && !model)
                            model = cols[1];
                        if ((key === 'name') && !name)
                            name = cols[1];
                    }
                }
                // Markdown list: `- **Role:** Squad SDK Integrator`
                if (trimmed.startsWith('-')) {
                    const bold = trimmed.match(/^-\s+\*\*(.+?):\*\*\s*(.+)$/);
                    if (bold) {
                        const [, key, value] = bold;
                        if (key.toLowerCase() === 'role' && !role)
                            role = value.trim();
                        if (key.toLowerCase() === 'model' && !model)
                            model = value.trim();
                        if (key.toLowerCase() === 'name' && !name)
                            name = value.trim();
                    }
                }
                break;
            }
            case 'role': {
                if (!role && !trimmed.startsWith('#')) {
                    // Could be a table or plain text
                    if (trimmed.startsWith('|') && !trimmed.startsWith('| ---')) {
                        const cols = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
                        if (cols.length >= 2)
                            role = cols[1];
                    }
                    else {
                        role = trimmed;
                    }
                }
                break;
            }
            case 'model': {
                if (!model && !trimmed.startsWith('#')) {
                    model = trimmed.replace(/^-\s*/, '').trim();
                }
                break;
            }
            case 'expertise': {
                if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                    const bullet = trimmed.replace(/^[-*]\s+/, '').trim();
                    if (bullet)
                        expertise.push(bullet);
                }
                break;
            }
            case 'style': {
                if (!style && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
                    style = trimmed;
                }
                break;
            }
            case 'reviewer_authority': {
                if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                    const bullet = trimmed.replace(/^[-*]\s+/, '').trim();
                    if (bullet)
                        reviewerAuthority.push(bullet);
                }
                break;
            }
        }
    }
    // Fallback: role from Expertise line in identity block
    if (!role && expertise.length > 0) {
        role = expertise[0];
    }
    return {
        name: name || 'unknown',
        role: role || 'Agent',
        model: model || undefined,
        expertise,
        style: style || undefined,
        reviewerAuthority: reviewerAuthority.length > 0 ? reviewerAuthority : undefined,
    };
}
/**
 * Parse a charter.md file and extract structured metadata.
 * Reads the file at `charterPath` then delegates to `parseCharterContent`.
 */
export async function parseCharter(charterPath) {
    const content = await fs.readFile(charterPath, 'utf-8');
    return parseCharterContent(content);
}
/**
 * Compute an md5 hash of raw charter content for change detection.
 */
export function computeContentHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}
/**
 * Generate and write a charter.md from metadata.
 */
export async function writeCharter(charterPath, meta) {
    const expertiseBullets = meta.expertise.map((e) => `- ${e}`).join('\n');
    const reviewerSection = meta.reviewerAuthority && meta.reviewerAuthority.length > 0
        ? `\n## Reviewer authority\n\n${meta.reviewerAuthority.map((r) => `- ${r}`).join('\n')}\n`
        : '';
    const styleSection = meta.style ? `\n## Style\n\n${meta.style}\n` : '';
    const modelSection = meta.model ? `\n## Model\n\n${meta.model}\n` : '';
    const content = `# ${meta.name}

## Role

${meta.role}
${modelSection}
## Expertise

${expertiseBullets}
${styleSection}${reviewerSection}`;
    await fs.writeFile(charterPath, content, 'utf-8');
}
/**
 * Compute md5 hash of a charter file's content for change detection.
 * Reads from disk; use `computeContentHash` if you already have the content in memory.
 */
export async function computeCharterHash(charterPath) {
    const content = await fs.readFile(charterPath);
    return computeContentHash(content);
}
//# sourceMappingURL=charter-compiler.js.map