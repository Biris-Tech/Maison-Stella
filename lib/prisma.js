const { PrismaClient } = require('@prisma/client');

// Fields stored as JSON strings in SQLite (would be native Json in MySQL)
const JSON_FIELDS = {
  Room: ['composition', 'amenities', 'images'],
  BlogPost: ['tags'],
  ActivityLog: ['details'],
  Setting: ['services'],
};

function serializeJsonFields(model, data) {
  if (!data || !JSON_FIELDS[model]) return data;
  const result = { ...data };
  for (const field of JSON_FIELDS[model]) {
    if (result[field] !== undefined && result[field] !== null && typeof result[field] !== 'string') {
      result[field] = JSON.stringify(result[field]);
    }
  }
  return result;
}

function deserializeJsonFields(model, data) {
  if (!data || typeof data !== 'object' || !JSON_FIELDS[model]) return data;
  const result = { ...data };
  for (const field of JSON_FIELDS[model]) {
    if (typeof result[field] === 'string') {
      try { result[field] = JSON.parse(result[field]); } catch { /* keep as string */ }
    }
  }
  return result;
}

const globalForPrisma = global;

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
