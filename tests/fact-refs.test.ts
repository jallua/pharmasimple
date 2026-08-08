import { describe, expect, test } from 'vitest';
import {
  assertionEvidenceMatches,
  atomicFactHash,
  atomicFactId,
  atomicFactRevisionMatches,
  contentCopyHash,
  evidenceDocumentId,
  evidenceLineageId,
  factBundleHash,
  factResolutionMatchesAssertions,
  requiredTrustedFactPaths,
  validateFactRef,
  type AtomicFact,
  type FactRef,
} from '../src/lib/trusted-content';

function makeFact(overrides: Partial<AtomicFact> = {}): AtomicFact {
  const fact: AtomicFact = {
    schemaVersion: 2,
    factId: '',
    factKey: 'drug:imatinib:approved-indication:test',
    predicate: 'product.approvedIndication',
    value: { label: '费城染色体阳性慢性髓性白血病' },
    scope: {
      jurisdiction: 'US',
      subjectType: 'medicinal-product',
      subjectId: 'imatinib',
      productId: '11111111-2222-3333-4444-555555555555',
    },
    status: 'verified',
    assertions: [{
      factKey: 'drug:imatinib:approved-indication:test',
      predicate: 'product.approvedIndication',
      value: { label: '费城染色体阳性慢性髓性白血病' },
      scope: {
        jurisdiction: 'US',
        subjectType: 'medicinal-product',
        subjectId: 'imatinib',
        productId: '11111111-2222-3333-4444-555555555555',
      },
      sourceId: 'us-fda',
      lineageId: 'spl-set:11111111-2222-3333-4444-555555555555',
      evidenceId: `evidence-${'b'.repeat(64)}`,
    }],
    resolutionHash: '',
    ...overrides,
  };
  if (!overrides.factId) fact.factId = atomicFactId(fact);
  fact.resolutionHash = atomicFactHash(fact);
  return fact;
}

function makeRef(root: unknown, fact: AtomicFact): FactRef {
  return {
    contentPath: '/indications/0/items/0',
    factIds: [fact.factId],
    relation: 'supports',
    boundFactHashes: { [fact.factId]: fact.resolutionHash },
    copyHash: contentCopyHash(root, '/indications/0/items/0')!,
    reviewStatus: 'reviewed',
  };
}

describe('v2 fact references', () => {
  const root = {
    indications: [{
      region: '美国',
      regulator: 'FDA',
      items: ['伊马替尼可用于部分费城染色体阳性的慢性髓性白血病。'],
    }],
  };

  test('public wording may differ from the atomic fact while a reviewed binding remains valid', () => {
    const fact = makeFact();
    const ref = makeRef(root, fact);
    expect(validateFactRef(root, ref, new Map([[fact.factId, fact]]), 'imatinib')).toEqual([]);
  });

  test('copy edits and fact revisions invalidate the binding without rewriting copy', () => {
    const fact = makeFact();
    const ref = makeRef(root, fact);
    const edited = {
      indications: [{ region: '美国', regulator: 'FDA', items: ['文案已改写。'] }],
    };
    expect(validateFactRef(edited, ref, new Map([[fact.factId, fact]]), 'imatinib'))
      .toContain('factRef copyHash does not match current copy');

    const revised = makeFact({ value: { label: '新版事实' } });
    expect(validateFactRef(root, ref, new Map([[fact.factId, revised]]), 'imatinib'))
      .toContain(`factRef binding for ${fact.factId} is stale`);
  });

  test('region-scoped indication facts cannot be attached to another jurisdiction', () => {
    const euFact = makeFact({
      scope: {
        jurisdiction: 'EU',
        subjectType: 'medicinal-product',
        subjectId: 'imatinib',
        productId: 'ema:example',
      },
    });
    const ref = makeRef(root, euFact);
    expect(validateFactRef(root, ref, new Map([[euFact.factId, euFact]]), 'imatinib'))
      .toContain(`fact ${euFact.factId} jurisdiction does not match /indications/0/items/0`);
  });

  test('cross-drug and predicate-to-field bindings are rejected', () => {
    const fact = makeFact();
    const ref = makeRef(root, fact);
    expect(validateFactRef(root, ref, new Map([[fact.factId, fact]]), 'nivolumab'))
      .toContain(`fact ${fact.factId} belongs to another active ingredient`);

    const otherRoot = { ...root, target: { name: 'BCR-ABL' } };
    const wrongFieldRef = {
      ...ref,
      contentPath: '/target/name',
      copyHash: contentCopyHash(otherRoot, '/target/name')!,
    };
    expect(validateFactRef(otherRoot, wrongFieldRef, new Map([[fact.factId, fact]]), 'imatinib'))
      .toContain('predicate product.approvedIndication cannot bind /target/name');
  });

  test('bundle hash is deterministic and includes only referenced fact revisions', () => {
    const first = makeFact();
    const second = makeFact({ factId: `fact-${'c'.repeat(64)}`, factKey: 'drug:imatinib:generic-name' });
    expect(factBundleHash([first, second])).toBe(factBundleHash([second, first]));
    expect(factBundleHash([first])).not.toBe(factBundleHash([first, second]));
  });

  test('ingredient-level facts remain blocked until two independent lineages support them', () => {
    const assertion = {
      factKey: 'drug:imatinib:generic-name',
      predicate: 'identity.genericName',
      value: 'imatinib',
      scope: { jurisdiction: 'GLOBAL' as const, subjectType: 'active-ingredient' as const, subjectId: 'imatinib' },
      sourceId: 'us-fda',
      lineageId: 'spl-set:one',
      evidenceId: `evidence-${'e'.repeat(64)}`,
    };
    const blocked = makeFact({
      factKey: assertion.factKey,
      predicate: assertion.predicate,
      value: assertion.value,
      scope: assertion.scope,
      status: 'blocked',
      assertions: [assertion],
    });
    expect(factResolutionMatchesAssertions(blocked)).toBe(true);
    expect(factResolutionMatchesAssertions({ ...blocked, status: 'verified' })).toBe(false);
  });

  test('canonical fact and evidence identities match Python v2 test vectors', () => {
    expect(makeFact().factId).toBe('fact-4872aa37d350b297f26c88cb3e989d1c77bf3370a4685e63a5238c87cfb79c45');
    const document = {
      evidenceId: '',
      sourceId: 'us-fda',
      sourceUrl: 'https://api.fda.gov/drug/label.json',
      documentId: '11111111-2222-3333-4444-555555555555',
      documentVersion: '20260808',
      lineageId: 'spl-set:11111111-2222-3333-4444-555555555555',
      jurisdiction: 'US' as const,
      activeIngredient: 'imatinib',
      productId: '11111111-2222-3333-4444-555555555555',
      documentType: 'label' as const,
      retrievedAt: '2026-08-08T00:00:00Z',
      mediaType: 'application/json',
      rawSha256: `sha256:${'d'.repeat(64)}`,
      rawObjectPath: `evidence/objects/${'d'.repeat(64)}.bin`,
      transformations: [],
    };
    expect(evidenceDocumentId(document))
      .toBe('evidence-0c475109b29120a9b5ba61c9eb00928501ef839d52b19d9d7fd87f8e9086c8b8');
    expect(evidenceLineageId(document)).toBe('spl-set:11111111-2222-3333-4444-555555555555');
    expect(evidenceDocumentId({ ...document, lineageId: 'us-fda:forged-independent-copy' }))
      .toBeUndefined();
    expect(evidenceDocumentId({ ...document, sourceUrl: 'https://example.com/forged' }))
      .not.toBe('evidence-0c475109b29120a9b5ba61c9eb00928501ef839d52b19d9d7fd87f8e9086c8b8');
  });

  test('assertions must match the exact evidence lineage and medicinal-product scope', () => {
    const assertion = makeFact().assertions[0];
    const document = {
      evidenceId: assertion.evidenceId,
      sourceId: assertion.sourceId,
      sourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=11111111-2222-3333-4444-555555555555',
      documentId: '11111111-2222-3333-4444-555555555555',
      documentVersion: '2026-08-08',
      lineageId: assertion.lineageId,
      jurisdiction: 'US' as const,
      activeIngredient: 'imatinib',
      productId: '11111111-2222-3333-4444-555555555555',
      documentType: 'label' as const,
      retrievedAt: '2026-08-08T00:00:00Z',
      mediaType: 'application/xml',
      rawSha256: `sha256:${'d'.repeat(64)}`,
      rawObjectPath: `evidence/objects/${'d'.repeat(64)}.bin`,
      transformations: [],
    };

    expect(assertionEvidenceMatches(assertion, document)).toBe(true);
    expect(assertionEvidenceMatches({ ...assertion, lineageId: 'spl-set:other' }, document)).toBe(false);
    expect(assertionEvidenceMatches({
      ...assertion,
      scope: { ...assertion.scope, jurisdiction: 'EU' },
    }, document)).toBe(false);
    expect(assertionEvidenceMatches({
      ...assertion,
      scope: { ...assertion.scope, productId: 'other-product' },
    }, document)).toBe(false);
    expect(assertionEvidenceMatches(assertion, { ...document, activeIngredient: 'nivolumab' })).toBe(false);
  });

  test('persisted facts must match the exact bundle revision', () => {
    const selected = makeFact();
    expect(atomicFactRevisionMatches(selected, structuredClone(selected))).toBe(true);
    const substituted = { ...selected, value: { label: '另一自洽版本' } };
    substituted.resolutionHash = atomicFactHash(substituted);
    expect(atomicFactRevisionMatches(substituted, selected)).toBe(false);
  });

  test('every required page-level v2 leaf has a satisfiable reviewed binding policy', () => {
    const page = {
      company: 'novartis',
      genericName: '伊马替尼',
      genericNameEn: 'imatinib',
      brandName: 'Glivec',
      drugClass: '酪氨酸激酶抑制剂',
      summary: '用于经编辑复核的科普摘要。',
      indications: [{ region: '美国', regulator: 'FDA', items: ['适应症科普表述。'] }],
      target: { name: 'BCR-ABL', type: 'enzyme', role: '参与异常增殖信号。' },
      mechanism: { analogy: '编辑类比。', simple: '通俗机制说明。', advanced: '进阶机制说明。' },
    };
    const policyFact = (predicate: AtomicFact['predicate'], productLevel: boolean): AtomicFact => {
      const scope = productLevel
        ? { jurisdiction: 'US' as const, subjectType: 'medicinal-product' as const, subjectId: 'imatinib', productId: '11111111-2222-3333-4444-555555555555' }
        : { jurisdiction: 'GLOBAL' as const, subjectType: 'active-ingredient' as const, subjectId: 'imatinib' };
      const factKey = `drug:imatinib:${predicate}`;
      const assertionValue = predicate === 'product.approvedIndication' ? { label: '适应症原子事实' } : `${predicate}-value`;
      const assertions = (productLevel ? ['spl-set:11111111-2222-3333-4444-555555555555'] : [
        'spl-set:11111111-2222-3333-4444-555555555555',
        'eu-ema:ema:imatinib',
      ]).map((lineageId, index) => ({
        factKey,
        predicate,
        value: assertionValue,
        scope,
        sourceId: index === 0 ? 'us-fda' : 'eu-ema',
        lineageId,
        evidenceId: `evidence-${String(index + 1).repeat(64)}`,
      }));
      const value = ['pharmacology.class', 'pharmacology.targetHint'].includes(predicate)
        ? [assertionValue]
        : assertionValue;
      const fact = {
        schemaVersion: 2 as const,
        factId: '',
        factKey,
        predicate,
        value,
        scope,
        status: 'verified' as const,
        assertions,
        resolutionHash: '',
      };
      fact.factId = atomicFactId(fact);
      fact.resolutionHash = atomicFactHash(fact);
      return fact;
    };
    const identity = policyFact('identity.genericName', false);
    const brand = policyFact('product.brandName', true);
    const holder = policyFact('product.authorizationHolder', true);
    const drugClass = policyFact('pharmacology.class', false);
    const target = policyFact('pharmacology.targetHint', false);
    const indication = policyFact('product.approvedIndication', true);
    const specs: Array<[string, AtomicFact, FactRef['relation']]> = [
      ['/company', holder, 'contextualizes'],
      ['/genericName', identity, 'derived-from'],
      ['/genericNameEn', identity, 'supports'],
      ['/brandName', brand, 'supports'],
      ['/drugClass', drugClass, 'supports'],
      ['/summary', drugClass, 'derived-from'],
      ['/indications/0/items/0', indication, 'supports'],
      ['/target/name', target, 'contextualizes'],
      ['/target/type', target, 'derived-from'],
      ['/target/role', target, 'derived-from'],
      ['/mechanism/analogy', target, 'derived-from'],
      ['/mechanism/simple', target, 'derived-from'],
      ['/mechanism/advanced', target, 'derived-from'],
    ];
    const covered = new Set<string>();
    for (const [contentPath, fact, relation] of specs) {
      const ref: FactRef = {
        contentPath,
        factIds: [fact.factId],
        relation,
        boundFactHashes: { [fact.factId]: fact.resolutionHash },
        copyHash: contentCopyHash(page, contentPath)!,
        reviewStatus: 'reviewed',
      };
      expect(validateFactRef(page, ref, new Map([[fact.factId, fact]]), 'imatinib')).toEqual([]);
      covered.add(contentPath);
    }
    expect(requiredTrustedFactPaths(page)).toEqual([...covered].sort());
  });
});
