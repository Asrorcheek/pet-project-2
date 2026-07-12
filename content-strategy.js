'use strict';

const crypto = require('crypto');

const CONTENT_MODES = new Set(['shadow', 'approval', 'auto']);

function createContentStrategyState(mode = 'shadow') {
  return {
    version: 1,
    paused: false,
    ownerChatId: null,
    mode: CONTENT_MODES.has(mode) ? mode : 'shadow',
    approvedCompetitors: [],
    pendingCompetitors: [],
    observations: [],
    experiments: [],
    plans: [],
    strategyRevision: {
      updatedAt: null,
      summary: 'Growth test: 1 product, 2 education, 1 branding, 1 trend/engagement.',
      productShare: 20,
      educationShare: 40,
      brandingShare: 20,
      trendShare: 20,
      confidence: 'insufficient_data',
    },
  };
}

function normalizeContentStrategyState(value, defaultMode = 'shadow') {
  const base = createContentStrategyState(defaultMode);
  if (!value || typeof value !== 'object') {
    return base;
  }
  return {
    ...base,
    ...value,
    mode: CONTENT_MODES.has(value.mode) ? value.mode : base.mode,
    approvedCompetitors: uniqueHandles(value.approvedCompetitors),
    pendingCompetitors: uniqueHandles(value.pendingCompetitors),
    observations: Array.isArray(value.observations) ? value.observations : [],
    experiments: Array.isArray(value.experiments) ? value.experiments : [],
    plans: Array.isArray(value.plans) ? value.plans : [],
    strategyRevision: { ...base.strategyRevision, ...(value.strategyRevision || {}) },
  };
}

function parseCatalogCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, i) => [header, String(row[i] || '').trim()]));
    return normalizeCatalogProduct(record, index + 2);
  }).filter((product) => product.active && product.name);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function normalizeCatalogProduct(record, rowNumber) {
  const get = (...keys) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== '') || '';
  const activeValue = get('active', 'enabled', 'status').toLowerCase();
  const imageUrls = get('image_urls', 'images', 'image_url')
    .split(/[|;\n]/)
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value));
  return {
    rowNumber,
    sku: get('sku', 'id'),
    name: get('name', 'product', 'product_name', 'title'),
    price: get('price', 'narx'),
    specs: get('specs', 'specifications', 'description'),
    availability: get('availability', 'stock', 'mavjud'),
    active: !['false', '0', 'no', 'inactive', 'disabled', 'out_of_stock'].includes(activeValue),
    imageUrls,
    priority: Number(get('priority')) || 0,
    updatedAt: get('updated_at', 'updated'),
  };
}

function normalizeWeeklyPlan(raw, context = {}) {
  const items = Array.isArray(raw?.items) ? raw.items.slice(0, 5) : [];
  if (items.length !== 5) {
    throw new Error('Content plan must contain exactly five items.');
  }
  const normalized = items.map((item, index) => normalizePlanItem(item, index));
  const counts = countPillars(normalized);
  if (counts.product !== 1 || counts.education !== 2 || counts.branding !== 1 || counts.trend !== 1) {
    throw new Error('Content plan must contain 1 product, 2 education, 1 branding, and 1 trend item.');
  }
  return {
    id: crypto.randomUUID(),
    weekKey: context.weekKey,
    chatId: context.chatId,
    status: 'pending_approval',
    modeAtCreation: context.mode || 'shadow',
    createdAt: new Date().toISOString(),
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectionReason: '',
    researchSummary: String(raw.research_summary || raw.researchSummary || '').trim(),
    strategyChanges: Array.isArray(raw.strategy_changes) ? raw.strategy_changes.map(String) : [],
    items: normalized,
  };
}

function normalizePlanItem(item, index) {
  const requestedPillar = String(item.pillar || '').toLowerCase();
  const pillar = ['product', 'education', 'branding', 'trend'].includes(requestedPillar)
    ? requestedPillar
    : 'education';
  const format = String(item.format || '').toLowerCase() === 'carousel' ? 'carousel' : 'image';
  return {
    id: item.id || `item-${index + 1}`,
    status: 'planned',
    pillar,
    format,
    goal: String(item.goal || '').trim(),
    title: String(item.title || '').trim(),
    hook: String(item.hook || '').trim(),
    caption: String(item.caption || '').trim(),
    cta: String(item.cta || '').trim(),
    sku: String(item.sku || '').trim(),
    mediaUrls: (Array.isArray(item.media_urls) ? item.media_urls : item.mediaUrls || [])
      .map(String).filter((url) => /^https?:\/\//i.test(url)),
    mediaBrief: String(item.media_brief || item.mediaBrief || '').trim(),
    scheduledAt: String(item.scheduled_at || item.scheduledAt || '').trim(),
    expectedKpi: String(item.expected_kpi || item.expectedKpi || 'reach').trim(),
    experimentId: String(item.experiment_id || item.experimentId || '').trim(),
    evidence: (Array.isArray(item.evidence) ? item.evidence : []).slice(0, 10),
    publishResult: null,
    error: '',
  };
}

function countPillars(items) {
  return items.reduce((counts, item) => {
    counts[item.pillar] = (counts[item.pillar] || 0) + 1;
    return counts;
  }, { product: 0, education: 0, branding: 0, trend: 0 });
}

function uniqueHandles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value).trim().replace(/^@/, '').toLowerCase())
    .filter((value) => /^[a-z0-9._]{1,30}$/.test(value)))];
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

module.exports = {
  CONTENT_MODES,
  createContentStrategyState,
  normalizeContentStrategyState,
  normalizeWeeklyPlan,
  parseCatalogCsv,
  uniqueHandles,
};
