import { createHash } from 'node:crypto';
import type { Connector, HarnessData } from './sheets.js';

export interface SheetRoutePlan {
  fromScope: string | null;
  toScope: string | null;
  commonScope: string | null;
  crossedChildScopes: string[];
}

export function routeRequestToken(requestKey: string): string {
  return createHash('sha256').update(requestKey).digest('hex').slice(0, 12);
}

export function planSheetRoute(
  harness: Pick<HarnessData, 'enclosures'>,
  sheetIds: Set<string>,
  fromConnector: Pick<Connector, 'parent'>,
  toConnector: Pick<Connector, 'parent'>,
): SheetRoutePlan {
  const enclosureById = new Map(harness.enclosures.map((enclosure) => [enclosure.id, enclosure]));
  const ownerScope = (parentId: string | null): string | null => {
    let current = parentId;
    while (current) {
      if (sheetIds.has(current)) return current;
      current = enclosureById.get(current)?.parent ?? null;
    }
    return null;
  };
  const sheetParent = (scope: string | null): string | null | undefined => {
    if (scope === null) return undefined;
    return ownerScope(enclosureById.get(scope)?.parent ?? null);
  };
  const chain = (scope: string | null) => {
    const result: Array<string | null> = [];
    let current: string | null | undefined = scope;
    while (current !== undefined) {
      result.push(current);
      current = sheetParent(current);
    }
    return result;
  };

  const fromScope = ownerScope(fromConnector.parent);
  const toScope = ownerScope(toConnector.parent);
  const fromChain = chain(fromScope);
  const toChain = chain(toScope);
  const toSet = new Set(toChain);
  const commonScope = fromChain.find((scope) => toSet.has(scope)) ?? null;
  return {
    fromScope,
    toScope,
    commonScope,
    crossedChildScopes: [
      ...fromChain.slice(0, fromChain.indexOf(commonScope)),
      ...toChain.slice(0, toChain.indexOf(commonScope)).reverse(),
    ].filter((scope): scope is string => scope !== null),
  };
}
