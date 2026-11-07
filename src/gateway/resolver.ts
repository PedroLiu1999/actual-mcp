import type {
  AccountSummary,
  CategoryGroupSummary,
  CategorySummary,
  PayeeSummary,
  ScheduleSummary,
} from './types.js';

export type ResolvableEntityType =
  | 'category'
  | 'category_group'
  | 'payee'
  | 'account'
  | 'schedule'
  | string;

export interface ResolvableCandidate {
  id: string;
  name?: string | null;
}

export interface ResolveEntityOptions {
  entityType?: ResolvableEntityType;
  resolved?: Record<string, string>;
  requireUuidMatch?: boolean;
}

export interface ResolvedEntity<T extends ResolvableCandidate = ResolvableCandidate> {
  id: string;
  name?: string;
  input: string;
  matchedBy: 'uuid' | 'id' | 'name';
  entity?: T;
}

export interface ResourceFacadeResult<T = unknown> {
  success: true;
  message: string;
  data: T;
  resolved?: Record<string, string>;
}

export interface ResourceFacadeErrorResult {
  success: false;
  message: string;
  error: string;
  entityType?: ResolvableEntityType;
  input?: string;
  suggestions?: string[];
}

export interface BudgetCacheSource {
  listCategories?(options?: { forceSync?: boolean }): Promise<CategoryGroupSummary[]>;
  listPayees?(options?: { forceSync?: boolean }): Promise<PayeeSummary[]>;
  listAccounts?(options?: { forceSync?: boolean }): Promise<AccountSummary[]>;
  listSchedules?(options?: { forceSync?: boolean }): Promise<ScheduleSummary[]>;
  getCategoryGroups?(): Promise<
    Array<{
      id: string;
      name: string;
      is_income?: boolean;
      hidden?: boolean;
      categories?: Array<{
        id: string;
        name: string;
        group_id: string;
        is_income?: boolean;
        hidden?: boolean;
      }>;
    }>
  >;
  getCategories?(): Promise<
    Array<{
      id: string;
      name: string;
      group_id: string;
      is_income?: boolean;
      hidden?: boolean;
    }>
  >;
  getPayees?(): Promise<
    Array<{
      id: string;
      name: string;
      transfer_acct?: string | null;
    }>
  >;
  getAccounts?(): Promise<
    Array<{
      id: string;
      name: string;
      offbudget?: boolean;
      closed?: boolean;
    }>
  >;
  getSchedules?(): Promise<
    Array<{
      id: string;
      name?: string | null;
    }>
  >;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j] ?? 0;
    }
  }

  return prev[b.length] ?? 0;
}

function computeCandidateSimilarity(queryLower: string, candidateLower: string): number {
  if (!queryLower || !candidateLower) return 0;
  if (queryLower === candidateLower) return 1;

  if (candidateLower.startsWith(queryLower)) {
    return 0.92 + (queryLower.length / candidateLower.length) * 0.07;
  }
  if (candidateLower.includes(queryLower)) {
    return 0.82 + (queryLower.length / candidateLower.length) * 0.09;
  }
  if (queryLower.includes(candidateLower) && candidateLower.length >= 3) {
    return 0.78 + (candidateLower.length / queryLower.length) * 0.08;
  }

  const maxLen = Math.max(queryLower.length, candidateLower.length);
  const fullDist = levenshteinDistance(queryLower, candidateLower);
  const fullSimilarity = 1 - fullDist / maxLen;

  const queryTokens = queryLower.split(/[^a-z0-9]+/).filter(Boolean);
  const candidateTokens = candidateLower.split(/[^a-z0-9]+/).filter(Boolean);
  let bestTokenSimilarity = 0;
  for (const qToken of queryTokens) {
    for (const cToken of candidateTokens) {
      const tokenMax = Math.max(qToken.length, cToken.length);
      if (tokenMax > 0) {
        const sim = 1 - levenshteinDistance(qToken, cToken) / tokenMax;
        if (sim > bestTokenSimilarity) {
          bestTokenSimilarity = sim;
        }
      }
    }
  }

  return Math.max(fullSimilarity, bestTokenSimilarity * 0.85);
}

export function findSuggestions(
  query: string,
  candidates: ReadonlyArray<ResolvableCandidate>,
  maxSuggestions = 5,
): string[] {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return [];

  const scored: Array<{ name: string; score: number }> = [];
  const seenNames = new Set<string>();

  for (const candidate of candidates) {
    const rawName = candidate.name?.trim();
    if (!rawName) continue;
    const lowerName = rawName.toLowerCase();
    if (seenNames.has(lowerName)) continue;
    seenNames.add(lowerName);

    const score = computeCandidateSimilarity(queryLower, lowerName);
    if (score >= 0.45) {
      scored.push({ name: rawName, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, maxSuggestions).map((item) => item.name);
}

function formatEntityLabel(entityType: ResolvableEntityType): string {
  switch (entityType) {
    case 'category':
      return 'Category';
    case 'category_group':
      return 'Category group';
    case 'payee':
      return 'Payee';
    case 'account':
      return 'Account';
    case 'schedule':
      return 'Schedule';
    default:
      return entityType
        ? entityType.charAt(0).toUpperCase() + entityType.slice(1).replace(/_/g, ' ')
        : 'Entity';
  }
}

export class EntityResolutionError extends Error {
  public readonly entityType: ResolvableEntityType;
  public readonly input: string;
  public readonly query: string;
  public readonly suggestions: string[];

  constructor(params: {
    entityType?: ResolvableEntityType;
    input: string;
    suggestions?: string[];
  }) {
    const entityType = params.entityType ?? 'entity';
    const suggestions = params.suggestions ?? [];
    const label = formatEntityLabel(entityType);
    const suggestionSuffix =
      suggestions.length > 0
        ? ` Did you mean: ${suggestions.map((s) => `"${s}"`).join(', ')}?`
        : '';

    super(`${label} "${params.input}" not found.${suggestionSuffix}`);
    this.name = 'EntityResolutionError';
    this.entityType = entityType;
    this.input = params.input;
    this.query = params.input;
    this.suggestions = suggestions;
    Object.setPrototypeOf(this, EntityResolutionError.prototype);
  }

  public toEnvelope(): ResourceFacadeErrorResult {
    return {
      success: false,
      message: this.message,
      error: this.message,
      entityType: this.entityType,
      input: this.input,
      suggestions: this.suggestions,
    };
  }
}

export function createResourceFacadeResponse<T>(params: {
  message: string;
  data: T;
  resolved?: Record<string, string>;
}): ResourceFacadeResult<T> {
  const hasResolved =
    params.resolved !== undefined && Object.keys(params.resolved).length > 0;

  return {
    success: true,
    message: params.message,
    data: params.data,
    ...(hasResolved ? { resolved: { ...params.resolved } } : {}),
  };
}

export function createResourceFacadeErrorResponse(
  error: unknown,
): ResourceFacadeErrorResult {
  if (error instanceof EntityResolutionError) {
    return error.toEnvelope();
  }
  const message = error instanceof Error ? error.message : String(error);
  const customSuggestions =
    error !== null &&
    typeof error === 'object' &&
    'suggestions' in error &&
    Array.isArray((error as { suggestions?: unknown }).suggestions)
      ? ((error as { suggestions: string[] }).suggestions)
      : undefined;
  return {
    success: false,
    message,
    error: message,
    ...(customSuggestions !== undefined ? { suggestions: customSuggestions } : {}),
  };
}

export function resolveEntityByNameOrId<
  T extends ResolvableCandidate = { id: string; name: string },
>(
  input: string,
  candidates: ReadonlyArray<T>,
  options?: ResolveEntityOptions,
): ResolvedEntity<T>;
export function resolveEntityByNameOrId<
  T extends ResolvableCandidate = { id: string; name: string },
>(
  input: string,
  loadCandidates: () => Promise<ReadonlyArray<T>> | ReadonlyArray<T>,
  options?: ResolveEntityOptions,
): Promise<ResolvedEntity<T>>;
export function resolveEntityByNameOrId<
  T extends ResolvableCandidate = { id: string; name: string },
>(
  input: string,
  candidatesOrLoader:
    | ReadonlyArray<T>
    | (() => Promise<ReadonlyArray<T>> | ReadonlyArray<T>),
  options?: ResolveEntityOptions,
): ResolvedEntity<T> | Promise<ResolvedEntity<T>> {
  const trimmed = input.trim();
  const requireUuidMatch = Boolean(options?.requireUuidMatch);

  if (typeof candidatesOrLoader === 'function') {
    if (isUuid(trimmed) && !requireUuidMatch) {
      return Promise.resolve({
        id: trimmed,
        input,
        matchedBy: 'uuid',
      });
    }
    return Promise.resolve(candidatesOrLoader()).then((candidates) =>
      resolveFromArray(input, trimmed, candidates, options),
    );
  }

  return resolveFromArray(input, trimmed, candidatesOrLoader, options);
}

function resolveFromArray<T extends ResolvableCandidate>(
  input: string,
  trimmed: string,
  candidates: ReadonlyArray<T>,
  options?: ResolveEntityOptions,
): ResolvedEntity<T> {
  const requireUuidMatch = Boolean(options?.requireUuidMatch);

  if (isUuid(trimmed)) {
    const lowerId = trimmed.toLowerCase();
    const idMatch = candidates.find((c) => c.id.toLowerCase() === lowerId);
    if (idMatch) {
      return {
        id: idMatch.id,
        ...(idMatch.name ? { name: idMatch.name } : {}),
        input,
        matchedBy: 'uuid',
        entity: idMatch,
      };
    }
    if (!requireUuidMatch) {
      return {
        id: trimmed,
        input,
        matchedBy: 'uuid',
      };
    }
  }

  const exactIdMatch = candidates.find((c) => c.id === trimmed);
  if (exactIdMatch) {
    return {
      id: exactIdMatch.id,
      ...(exactIdMatch.name ? { name: exactIdMatch.name } : {}),
      input,
      matchedBy: 'id',
      entity: exactIdMatch,
    };
  }

  const lowerTarget = trimmed.toLowerCase();
  const nameMatch = candidates.find(
    (c) => (c.name ?? '').trim().toLowerCase() === lowerTarget,
  );
  if (nameMatch) {
    if (options?.resolved) {
      options.resolved[input] = nameMatch.id;
    }
    return {
      id: nameMatch.id,
      ...(nameMatch.name ? { name: nameMatch.name } : {}),
      input,
      matchedBy: 'name',
      entity: nameMatch,
    };
  }

  const suggestions = findSuggestions(trimmed, candidates);
  throw new EntityResolutionError({
    entityType: options?.entityType ?? 'entity',
    input,
    suggestions,
  });
}

async function loadCategoryGroupsFromSource(
  source: BudgetCacheSource,
): Promise<CategoryGroupSummary[]> {
  if (source.listCategories) {
    return source.listCategories();
  }
  const rawGroups = (await source.getCategoryGroups?.()) ?? [];
  const needsFallback = rawGroups.some((g) => !Array.isArray(g.categories));
  const fallbackCats =
    needsFallback && source.getCategories ? await source.getCategories() : [];

  return rawGroups.map((group) => {
    const rawCats = Array.isArray(group.categories)
      ? group.categories
      : fallbackCats.filter((c) => c.group_id === group.id);
    return {
      id: group.id,
      name: group.name,
      is_income: Boolean(group.is_income),
      hidden: Boolean(group.hidden),
      categories: rawCats.map((cat) => ({
        id: cat.id,
        name: cat.name,
        group_id: cat.group_id ?? group.id,
        is_income: Boolean(cat.is_income ?? group.is_income),
        hidden: Boolean(cat.hidden),
      })),
    };
  });
}

export async function resolveCategory(
  input: string,
  source: BudgetCacheSource,
  resolved?: Record<string, string>,
): Promise<ResolvedEntity<CategorySummary>> {
  return resolveEntityByNameOrId(
    input,
    async () => {
      if (!source.listCategories && source.getCategories) {
        const rawCats = await source.getCategories();
        return rawCats.map((cat) => ({
          id: cat.id,
          name: cat.name,
          group_id: cat.group_id,
          is_income: Boolean(cat.is_income),
          hidden: Boolean(cat.hidden),
        }));
      }
      const groups = await loadCategoryGroupsFromSource(source);
      return groups.flatMap((g) => g.categories);
    },
    { entityType: 'category', ...(resolved ? { resolved } : {}) },
  );
}

export async function resolveCategoryGroup(
  input: string,
  source: BudgetCacheSource,
  resolved?: Record<string, string>,
): Promise<ResolvedEntity<CategoryGroupSummary>> {
  return resolveEntityByNameOrId(
    input,
    () => loadCategoryGroupsFromSource(source),
    { entityType: 'category_group', ...(resolved ? { resolved } : {}) },
  );
}

export async function resolvePayee(
  input: string,
  source: BudgetCacheSource,
  resolved?: Record<string, string>,
): Promise<ResolvedEntity<PayeeSummary>> {
  return resolveEntityByNameOrId(
    input,
    async () => {
      if (source.listPayees) {
        return source.listPayees();
      }
      const rawPayees = (await source.getPayees?.()) ?? [];
      return rawPayees.map((p) => ({
        id: p.id,
        name: p.name,
        transfer_acct: p.transfer_acct ?? null,
      }));
    },
    { entityType: 'payee', ...(resolved ? { resolved } : {}) },
  );
}

export async function resolveAccount(
  input: string,
  source: BudgetCacheSource,
  resolved?: Record<string, string>,
): Promise<ResolvedEntity<AccountSummary | { id: string; name: string }>> {
  return resolveEntityByNameOrId(
    input,
    async () => {
      if (source.listAccounts) {
        return source.listAccounts();
      }
      const rawAccounts = (await source.getAccounts?.()) ?? [];
      return rawAccounts.map((a) => ({
        id: a.id,
        name: a.name,
      }));
    },
    { entityType: 'account', ...(resolved ? { resolved } : {}) },
  );
}

export async function resolveSchedule(
  input: string,
  source: BudgetCacheSource,
  resolved?: Record<string, string>,
): Promise<ResolvedEntity<ScheduleSummary | { id: string; name: string | null }>> {
  return resolveEntityByNameOrId(
    input,
    async () => {
      if (source.listSchedules) {
        return source.listSchedules();
      }
      const rawSchedules = (await source.getSchedules?.()) ?? [];
      return rawSchedules.map((s) => ({
        id: s.id,
        name: s.name ?? null,
      }));
    },
    { entityType: 'schedule', ...(resolved ? { resolved } : {}) },
  );
}

