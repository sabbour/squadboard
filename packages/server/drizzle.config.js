import { defineConfig } from 'drizzle-kit';
const DB_URL = process.env.DATABASE_URL ??
    'postgresql://squadboard:squadboard@localhost:54321/squadboard';
export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: DB_URL,
    },
});
//# sourceMappingURL=drizzle.config.js.map